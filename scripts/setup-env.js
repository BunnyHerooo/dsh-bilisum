#!/usr/bin/env node
/**
 * BiliSum environment bootstrap.
 *
 * Creates the managed virtual environment in `~/.dsh/bilisum/venv` and installs
 * `vendor/requirements.txt` into it. Runs from `apply()` on first use and from
 * `npm run prepare`, so it must be quick and idempotent when the venv exists.
 *
 * Order: existing venv → system Python 3.10+ → uv (existing or downloaded).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const isWindows = process.platform === 'win32';

const home = (process.env.BILISUM_HOME || '').trim() || path.join(homedir(), '.dsh', 'bilisum');
const venvDir = path.join(home, 'venv');
const pythonExe = isWindows
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');
const requirements = path.join(packageRoot, 'vendor', 'requirements.txt');
const stampFile = path.join(venvDir, '.requirements-hash');

const log = (message) => console.log(`[bilisum-setup] ${message}`);

/** Windows: never flash a console window for the helper processes. */
const HIDE = { windowsHide: true };

function run(command, args, options = {}) {
  log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', ...HIDE, ...options });
  return result.status === 0;
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...HIDE });
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

function pythonWorks(exe) {
  const probe = capture(exe, ['-c', 'import bilibili_api, aiohttp, yt_dlp, imageio_ffmpeg']);
  return probe.ok;
}

function findSystemPython() {
  /** @type {Array<[string, string[]]>} */
  const candidates = isWindows
    ? [['py', ['-3.12']], ['py', ['-3.11']], ['py', ['-3']], ['python', []], ['python3', []]]
    : [['python3.12', []], ['python3.11', []], ['python3', []], ['python', []]];
  for (const [command, prefix] of candidates) {
    const version = capture(command, [...prefix, '--version']);
    if (!version.ok) continue;
    const match = version.out.match(/Python (\d+)\.(\d+)/);
    if (!match) continue;
    const [major, minor] = [Number(match[1]), Number(match[2])];
    if (major === 3 && minor >= 10) return { command, prefix };
  }
  return null;
}

function requirementsHash() {
  try {
    // Normalize line endings so a CRLF/LF flip never forces a reinstall.
    const text = readFileSync(requirements, 'utf8').replace(/\r\n/g, '\n');
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
  } catch {
    return 'missing';
  }
}

function installRequirements(pip) {
  const args = (extra) => [...extra, 'install', '-r', requirements];
  if (pip === 'uv') return false;
  if (run(pythonExe, ['-m', 'pip', 'install', '--upgrade', 'pip'])) {
    if (run(pythonExe, args(['-m', 'pip']))) return true;
  }
  // The default index is not reachable everywhere; retry through a mirror.
  log('默认源安装失败，改用镜像源重试…');
  return run(pythonExe, [
    '-m', 'pip', 'install', '-r', requirements,
    '-i', 'https://mirrors.aliyun.com/pypi/simple/',
    '--trusted-host', 'mirrors.aliyun.com',
  ]);
}

function downloadUv() {
  const target = path.join(home, isWindows ? 'uv.exe' : 'uv');
  if (existsSync(target)) return target;
  const url = isWindows
    ? 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip'
    : process.arch === 'arm64'
      ? 'https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-unknown-linux-gnu.tar.gz'
      : 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz';
  const archive = path.join(home, isWindows ? 'uv.zip' : 'uv.tar.gz');
  log(`下载 uv：${url}`);
  if (!run(isWindows ? 'curl.exe' : 'curl', ['-L', '--fail', url, '-o', archive])) return null;
  const extracted = isWindows
    ? run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -Force -Path '${archive}' -DestinationPath '${home}'`])
    : run('tar', ['-xzf', archive, '-C', home]);
  rmSync(archive, { force: true });
  if (!extracted || !existsSync(target)) return null;
  if (!isWindows) run('chmod', ['+x', target]);
  return target;
}

function findUv() {
  const probe = capture(isWindows ? 'uv.exe' : 'uv', ['--version']);
  if (probe.ok) return isWindows ? 'uv.exe' : 'uv';
  return downloadUv();
}

function setupWithUv() {
  const uv = findUv();
  if (!uv) return false;
  if (!run(uv, ['venv', '--python', '3.12', venvDir])) return false;
  return run(uv, ['pip', 'install', '--python', pythonExe, '-r', requirements]);
}

function main() {
  mkdirSync(home, { recursive: true });
  const wanted = requirementsHash();
  const checkOnly = process.argv.includes('--check');

  if (checkOnly) {
    // `prepare` runs during installs; never download or install there.
    const ready = existsSync(pythonExe)
      && existsSync(stampFile)
      && readFileSync(stampFile, 'utf8').trim() === wanted
      && pythonWorks(pythonExe);
    log(ready
      ? `环境已就绪：${pythonExe}`
      : '环境尚未就绪，将在插件首次加载时自动安装');
    return 0;
  }

  if (existsSync(pythonExe) && pythonWorks(pythonExe)) {
    if (existsSync(stampFile) && readFileSync(stampFile, 'utf8').trim() === wanted) {
      log(`环境已就绪：${pythonExe}`);
      return 0;
    }
    log('依赖清单有变化，正在补充安装…');
    if (installRequirements('pip')) {
      writeFileSync(stampFile, wanted, 'utf8');
      return 0;
    }
    return 1;
  }

  if (existsSync(venvDir)) {
    log('现有虚拟环境不可用，重新创建…');
    rmSync(venvDir, { recursive: true, force: true });
  }

  const python = findSystemPython();
  if (python) {
    log(`使用系统 Python：${python.command} ${python.prefix.join(' ')}`.trim());
    if (run(python.command, [...python.prefix, '-m', 'venv', venvDir]) && installRequirements('pip')) {
      writeFileSync(stampFile, wanted, 'utf8');
      log('环境初始化完成。');
      return 0;
    }
  }

  log('未找到可用的系统 Python，改用 uv…');
  if (setupWithUv() && pythonWorks(pythonExe)) {
    writeFileSync(stampFile, wanted, 'utf8');
    log('环境初始化完成（uv）。');
    return 0;
  }

  log('环境初始化失败：请安装 Python 3.10+ 后重试，或手动执行：');
  log(`  pip install -r "${requirements}"`);
  return 1;
}

process.exit(main());
