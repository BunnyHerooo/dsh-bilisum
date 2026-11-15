/**
 * BiliSum worker bridge: locate a usable Python interpreter, run the Python
 * worker, and turn its newline-delimited JSON into events for the caller.
 *
 * Two spawn paths exist because a profile may lack the subprocess service:
 * the Harness `subprocess` service when present (managed, sandbox-aware) and
 * `node:child_process` otherwise.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { venvPython } from './home.js';

/** Candidates are probed once and cached per resolved path. */
const probeCache = new Map();

/** Sub-workspace folder names that may hold the Python environment. */
const SUBWORKSPACE_DIRS = ['BiliSum'];

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Interpreters to try, most specific first.
 * @param {{ configured?: string, cwd?: string, extraRoots?: string[] }} options
 * @returns {string[]}
 */
export function pythonCandidates({ configured, cwd, extraRoots } = {}) {
  const list = [];
  if (configured) list.push(configured);
  // The managed environment lives outside the (possibly read-only) package.
  list.push(venvPython());
  if (process.env.BILISUM_PYTHON) list.push(process.env.BILISUM_PYTHON);
  const roots = [...new Set([cwd, ...(extraRoots ?? []), process.cwd(), os.homedir()].filter(Boolean))];
  for (const root of roots) {
    list.push(
      path.join(root, '.bilisum-venv', 'Scripts', 'python.exe'),
      path.join(root, '.bilisum-venv', 'bin', 'python3'),
      path.join(root, '.venv', 'Scripts', 'python.exe'),
      path.join(root, '.venv', 'bin', 'python3'),
      // A sub-workspace such as `BiliSum/` may own the venv.
      ...SUBWORKSPACE_DIRS.flatMap((dir) => [
        path.join(root, dir, '.bilisum-venv', 'Scripts', 'python.exe'),
        path.join(root, dir, '.bilisum-venv', 'bin', 'python3'),
        path.join(root, dir, '.venv', 'Scripts', 'python.exe'),
        path.join(root, dir, '.venv', 'bin', 'python3'),
      ]),
    );
  }
  if (process.platform === 'win32') {
    list.push('python.exe', 'python3.exe', 'python');
  } else {
    list.push('python3', 'python');
  }
  return [...new Set(list)];
}

/**
 * Run one short command and collect its output.
 * @param {{ subprocess?: any, argv: string[], cwd: string, timeoutMs?: number, env?: Record<string, string> }} options
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
async function runOnce({ subprocess, argv, cwd, timeoutMs = 20000, env }) {
  if (subprocess) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const handle = subprocess.spawn({
        argv,
        cwd,
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
        graceMs: 2000,
        signal: controller.signal,
        env: { ...process.env, ...env },
      });
      const [stdout, stderr, outcome] = await Promise.all([
        readStream(handle.stdout),
        readStream(handle.stderr),
        handle.done,
      ]);
      return { code: outcome?.exitCode ?? null, stdout, stderr };
    } catch (error) {
      return { code: null, stdout: '', stderr: error?.message ?? String(error) };
    } finally {
      clearTimeout(timer);
    }
  }
  return await new Promise((resolve) => {
    let child;
    try {
      child = nodeSpawn(argv[0], argv.slice(1), {
        cwd,
        env: { ...process.env, ...env },
        windowsHide: true,
      });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: error?.message ?? String(error) });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function readStream(stream) {
  if (!stream) return Promise.resolve('');
  return new Promise((resolve) => {
    let text = '';
    stream.on('data', (chunk) => { text += Buffer.from(chunk).toString('utf8'); });
    stream.on('end', () => resolve(text));
    stream.on('close', () => resolve(text));
    stream.on('error', () => resolve(text));
  });
}

/**
 * Find the first interpreter that can import `bilibili_api`.
 * @param {{ subprocess?: any, configured?: string, cwd?: string, extraRoots?: string[] }} options
 * @returns {Promise<{ path: string | null, checked: Array<{ path: string, detail: string }> }>}
 */
export async function detectPython({ subprocess, configured, cwd, extraRoots }) {
  const checked = [];
  for (const candidate of pythonCandidates({ configured, cwd, extraRoots })) {
    if (candidate.includes(path.sep) && !isFile(candidate)) {
      checked.push({ path: candidate, detail: '不存在' });
      continue;
    }
    const cached = probeCache.get(candidate);
    if (cached) {
      checked.push(cached);
      if (cached.ok) return { path: candidate, checked };
      continue;
    }
    const probe = await runOnce({
      subprocess,
      argv: [candidate, '-c', 'import bilibili_api; print(bilibili_api.__version__ if hasattr(bilibili_api, "__version__") else "ok")'],
      cwd: cwd ?? process.cwd(),
      timeoutMs: 25000,
    });
    const ok = probe.code === 0;
    const entry = {
      path: candidate,
      ok,
      detail: ok
        ? `可用（bilibili-api-python ${probe.stdout.trim() || 'ok'}）`
        : (probe.stderr || probe.stdout || '无法导入 bilibili_api').trim().split('\n').slice(-1)[0],
    };
    probeCache.set(candidate, entry);
    checked.push(entry);
    if (ok) return { path: candidate, checked };
  }
  return { path: null, checked };
}

/**
 * Run the worker for one batch.
 * @param {{
 *   subprocess?: any,
 *   pythonPath: string,
 *   workerPath: string,
 *   cwd: string,
 *   payload: unknown,
 *   mode?: 'probe' | 'fetch',
 *   cookie?: string,
 *   signal?: AbortSignal,
 *   onEvent: (event: any) => void,
 * }} options
 * @returns {Promise<{ code: number | null, stderr: string, fatal?: string,
 *   videos: any[], failures: any[], summary: any, probes: any[],
 *   probeSummary: any }>}
 */
export async function runWorker(options) {
  const {
    subprocess, pythonPath, workerPath, cwd, payload, cookie, signal, onEvent,
    mode = 'fetch',
  } = options;
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
  if (cookie) env.BILISUM_SESSDATA = cookie;
  else delete env.BILISUM_SESSDATA;

  const videos = [];
  const failures = [];
  const probes = [];
  const downloads = [];
  const downloadFailures = [];
  let check = null;
  let summary = null;
  let probeSummary = null;
  let fatal = null;
  let stderr = '';

  const handleEvent = (event) => {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'video') videos.push(event.data);
    else if (event.type === 'probe') probes.push(event.data);
    else if (event.type === 'failure') failures.push(event.data);
    else if (event.type === 'download-done') downloads.push(event.data);
    else if (event.type === 'download-failed') downloadFailures.push(event.data);
    else if (event.type === 'check') check = event.data;
    else if (event.type === 'summary') summary = event.data;
    else if (event.type === 'probe-summary') probeSummary = event.data;
    else if (event.type === 'fatal') fatal = event.message;
    onEvent?.(event);
  };

  const consume = (chunk) => {
    for (const line of String(chunk).split('\n')) {
      const text = line.trim();
      if (!text) continue;
      try {
        handleEvent(JSON.parse(text));
      } catch {
        // A library that printed to stdout instead of stderr: keep it as a log.
        onEvent?.({ type: 'log', level: 'info', message: text });
      }
    }
  };

  if (subprocess) {
    let buffer = '';
    let handle;
    try {
      handle = subprocess.spawn({
        argv: [pythonPath, workerPath, '--mode', mode],
        cwd,
        stdio: {
          stdin: { data: JSON.stringify(payload ?? {}) },
          stdout: 'pipe',
          stderr: 'pipe',
        },
        graceMs: 4000,
        signal,
        env,
      });
    } catch (error) {
      return {
        code: null,
        stderr: error?.message ?? String(error),
        fatal: `无法启动 Python 进程：${error?.message ?? error}`,
        videos,
        failures,
        summary,
        probes,
        probeSummary,
        downloads,
        downloadFailures,
        check,
      };
    }
    handle.stdout?.on('data', (chunk) => {
      buffer += Buffer.from(chunk).toString('utf8');
      const index = buffer.lastIndexOf('\n');
      if (index < 0) return;
      const ready = buffer.slice(0, index + 1);
      buffer = buffer.slice(index + 1);
      consume(ready);
    });
    handle.stderr?.on('data', (chunk) => { stderr += Buffer.from(chunk).toString('utf8'); });
    const outcome = await handle.done.catch((error) => {
      stderr += `\n${error?.message ?? error}`;
      return { exitCode: null };
    });
    if (buffer.trim()) consume(buffer);
    return { code: outcome?.exitCode ?? null, stderr, fatal, videos, failures, summary, probes, probeSummary, downloads, downloadFailures, check };
  }

  return await new Promise((resolve) => {
    let child;
    try {
      child = nodeSpawn(pythonPath, [workerPath, '--mode', mode], {
        cwd,
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({
        code: null,
        stderr: error?.message ?? String(error),
        fatal: `无法启动 Python 进程：${error?.message ?? error}`,
        videos,
        failures,
        summary,
        probes,
        probeSummary,
        downloads,
        downloadFailures,
        check,
      });
      return;
    }
    let buffer = '';
    child.stdout?.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const index = buffer.lastIndexOf('\n');
      if (index < 0) return;
      const ready = buffer.slice(0, index + 1);
      buffer = buffer.slice(index + 1);
      consume(ready);
    });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      resolve({
        code: null,
        stderr: `${stderr}${error.message}`,
        fatal: error.message,
        videos,
        failures,
        summary,
        probes,
        probeSummary,
        downloads,
        downloadFailures,
        check,
      });
    });
    child.on('close', (code) => {
      if (buffer.trim()) consume(buffer);
      resolve({ code, stderr, fatal, videos, failures, summary, probes, probeSummary, downloads, downloadFailures, check });
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify(payload ?? {}));
  });
}
