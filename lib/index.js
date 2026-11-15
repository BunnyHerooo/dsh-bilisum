/**
 * BiliSum Host half.
 *
 * Registers two agent tools (fetch subtitles, write the report) and the
 * settings-page HTTP endpoints. All real work lives in `lib/`, so the tool and
 * the settings page run exactly the same pipeline.
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { BiliSumError, downloadItems, fetchVideos, probeVideos, resolveCwd, WORKER_PATH } from './pipeline.js';
import { migrateLayout } from './layout.js';
import { renderReport, reportFileName, resolveOutputRoot } from './report.js';
import { detectPython, runWorker } from './worker.js';
import { venvPython } from './home.js';

/** Resolve Electron/OS helpers from this module rather than the caller's scope. */
const requireFromHere = createRequire(import.meta.url);

/** Environment bootstrap shipped beside the package manifest. */
const SETUP_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'setup-env.js');

/** Cordis injection: the tool registry is mandatory, everything else optional. */
export const inject = ['tools'];

/** Credential record key owned by this plugin. */
const RECORD_KEY = 'dsh-bilisum/sessdata';

const TOOL_FETCH = 'bilisum_fetch';
const TOOL_REPORT = 'bilisum_write_report';

/** How many finished UI jobs to keep for polling. */
const JOB_RETENTION_MS = 10 * 60 * 1000;
const JOB_LOG_LIMIT = 500;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

/**
 * @param {any} ctx Cordis plugin context
 * @param {Record<string, unknown>} config Row config from `cordis.patch.yml`
 */
export function apply(ctx, config = {}) {
  const tools = ctx.tools;
  const credentials = ctx.get('credentials');
  const subprocess = ctx.get('subprocess');
  const workingDirectory = ctx.get('workingDirectory');
  const workspaceRegistry = ctx.get('workspaceRegistry');

  /** Metadata of the last successful fetch, keyed by agent id. */
  const lastFetch = new Map();
  /** The last settings-page batch, so a report can reuse its metadata. */
  let lastJobOutcome = null;
  /** UI jobs, keyed by an opaque id. */
  const jobs = new Map();
  /** The batch a re-mounted page should reattach to. */
  let activeJobId = null;
  /** Layout migration runs once per activation. */
  let migrationStarted = false;
  /** Cached interpreter probe, valid for a minute. */
  let pythonCache = { at: 0, value: null };
  /** Cached cookie-validity probe, valid for a minute. */
  let cookieCache = { at: 0, value: null, key: '' };

  const configuredPython = typeof config.pythonPath === 'string' && config.pythonPath.trim()
    ? config.pythonPath.trim()
    : undefined;

  /**
   * Where reports and transcripts go.
   *
   * `config.outputDir` (absolute, or relative to the session working directory)
   * wins, so this plugin can keep its files in its own sub-workspace; without it
   * the historical `bilibili_summaries` beside the working directory applies.
   */
  const configuredOutput = typeof config.outputDir === 'string' && config.outputDir.trim()
    ? config.outputDir.trim()
    : (process.env.BILISUM_OUTPUT_DIR || '').trim();

  /**
   * Directory chosen from the panel. `undefined` means "follow the config",
   * an empty string forces the plugin default, anything else is the custom path.
   */
  let outputOverride;

  /** Absolute directory holding this plugin's reports, logs, and transcripts. */
  function outputRoot() {
    const selected = outputOverride === undefined ? configuredOutput : outputOverride;
    return resolveOutputRoot(selected);
  }

  /**
   * First run only: build the managed Python environment in the background so a
   * freshly installed plugin heals itself instead of failing the first fetch.
   */
  async function ensureEnvironment() {
    try {
      if (existsSync(venvPython())) return;
      if (!existsSync(SETUP_SCRIPT)) return;
      try {
        ctx.logger?.info?.('BiliSum：Python 环境尚未就绪，正在后台初始化（首次约 1–3 分钟）…');
      } catch {
        // A missing logger is not a reason to skip the bootstrap.
      }
      const child = spawn(process.execPath, [SETUP_SCRIPT], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
      });
      child.unref();
    } catch {
      // Bootstrap failures surface later as a clear "python missing" status.
    }
  }

  void ensureEnvironment();

  /** True when the panel or the config asks for something other than the default. */
  function hasCustomOutput() {
    const selected = outputOverride === undefined ? configuredOutput : outputOverride;
    return Boolean(typeof selected === 'string' && selected.trim());
  }

  // ----------------------------------------------------------------------
  // Credentials
  // ----------------------------------------------------------------------
  async function readCookie() {
    if (!credentials) return '';
    try {
      const record = await credentials.readRecord(RECORD_KEY);
      const value = record?.payload?.sessdata;
      return typeof value === 'string' ? value : '';
    } catch {
      return '';
    }
  }

  async function writeCookie(sessdata) {
    if (!credentials) {
      throw new BiliSumError('NO_CREDENTIALS', '当前 profile 没有凭据服务，无法保存 Cookie。');
    }
    if (!sessdata) {
      await credentials.deleteRecord(RECORD_KEY);
      return;
    }
    await credentials.modifyRecord(RECORD_KEY, async () => ({
      kind: 'grant',
      payload: { sessdata },
    }));
  }

  /**
   * Ask B站 whether the stored SESSDATA is still a logged-in session.
   * `true`/`false` are definitive; `null` means the probe itself did not answer.
   * Cached for a minute so opening panels does not hammer the endpoint.
   */
  async function probeCookie(sessdata) {
    if (!sessdata) return null;
    if (cookieCache.key === sessdata && Date.now() - cookieCache.at < 60_000) {
      return cookieCache.value;
    }
    let value = null;
    try {
      const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          referer: 'https://www.bilibili.com/',
          cookie: `SESSDATA=${sessdata}`,
        },
        signal: AbortSignal.timeout(8000),
      });
      const payload = await response.json();
      if (payload?.code === 0) value = Boolean(payload?.data?.isLogin);
      else if (payload?.code === -101) value = false;
    } catch {
      value = null;
    }
    cookieCache = { at: Date.now(), value, key: sessdata };
    return value;
  }

  // ----------------------------------------------------------------------
  // Shared operations
  // ----------------------------------------------------------------------
  /** Workspace directories, most recently used first. */
  function workspaceRoots() {
    try {
      const list = workspaceRegistry?.list?.() ?? [];
      return list.map((workspace) => workspace.path).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * The directory the settings page writes into. A root-scoped page has no
   * Session, so the active workspace is the closest honest answer.
   */
  function defaultWorkdir() {
    const roots = workspaceRoots();
    if (roots.length > 0) return roots[0];
    return workingDirectory?.defaultDirectory || process.cwd();
  }

  async function pythonStatus(workdir) {
    if (pythonCache.value && Date.now() - pythonCache.at < 60_000) return pythonCache.value;
    const result = await detectPython({
      subprocess,
      configured: configuredPython,
      cwd: workdir,
      extraRoots: workspaceRoots(),
    });
    pythonCache = { at: Date.now(), value: result };
    return result;
  }

  /** Cached download-dependency probe (yt-dlp + ffmpeg), valid for a minute. */
  let downloadCache = { at: 0, value: null };

  async function downloadStatus(workdir) {
    if (downloadCache.value && Date.now() - downloadCache.at < 60_000) return downloadCache.value;
    /** @type {{ ready: boolean, ytdlp: string | null, ffmpeg: string | null, reason: string }} */
    let value = { ready: false, ytdlp: null, ffmpeg: null, reason: '' };
    try {
      const python = await pythonStatus(workdir);
      if (!python.path) {
        value.reason = '未找到可用的 Python 解释器';
      } else {
        const outcome = await runWorker({
          subprocess,
          pythonPath: python.path,
          workerPath: WORKER_PATH,
          cwd: workdir,
          mode: 'check',
          payload: {},
          onEvent: () => {},
        });
        const info = outcome.check ?? {};
        value = {
          ready: Boolean(info.ytdlp && info.ffmpeg),
          ytdlp: info.ytdlp ?? null,
          ffmpeg: info.ffmpeg ?? null,
          reason: info.ffmpeg ? (info.ytdlp ? '' : '未安装 yt-dlp：pip install yt-dlp')
            : '未找到 ffmpeg：pip install imageio-ffmpeg 或把 ffmpeg 加入 PATH',
        };
      }
    } catch (error) {
      value.reason = error?.message ?? String(error);
    }
    downloadCache = { at: Date.now(), value };
    return value;
  }

  async function runFetch({ text, items, subtitles, download, agent, cwd, extraRoots, onEvent, signal }) {
    const cookie = await readCookie();
    if (!cookie) {
      onEvent?.({
        type: 'log',
        level: 'warning',
        message: '未配置 SESSDATA Cookie：B站 只允许登录用户获取字幕，本次抓取很可能全部失败。',
      });
    }
    const outcome = await fetchVideos({
      subprocess,
      workingDirectory,
      agent,
      cwd,
      text,
      items,
      subtitles,
      pythonPath: configuredPython,
      // Pass the already-resolved absolute root so the panel override and the
      // default both reach the pipeline unchanged.
      configuredOutput: outputRoot(),
      download,
      extraRoots: extraRoots ?? workspaceRoots(),
      cookie,
      signal,
      onEvent,
    });
    if (agent?.id) {
      lastFetch.set(agent.id, outcome);
      if (lastFetch.size > 50) {
        lastFetch.delete(lastFetch.keys().next().value);
      }
    }
    return outcome;
  }

  async function writeReport({ workdir, videos, failures, outputName }) {
    const dir = outputRoot(workdir);
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, outputName || reportFileName());
    const markdown = renderReport({ videos, failures });
    await fs.writeFile(target, markdown, 'utf8');
    return { path: target, bytes: Buffer.byteLength(markdown, 'utf8') };
  }

  /**
   * Reveal a path with the OS default handler.
   *
   * In a Desktop launch the Host runs inside Electron, so `shell` is the exact
   * behavior the rest of the app uses. A plain Node Host (dsh web) falls back to
   * the platform opener, which still selects the folder rather than opening it in
   * an application.
   */
  async function revealPath(target) {
    const isDirectory = await fs.stat(target).then((stat) => stat.isDirectory()).catch(() => false);

    if (process.versions.electron) {
      try {
        const electron = requireFromHere('electron');
        if (electron && typeof electron === 'object' && electron.shell) {
          if (!isDirectory && typeof electron.shell.showItemInFolder === 'function') {
            electron.shell.showItemInFolder(target);
            return 'show-item';
          }
          if (typeof electron.shell.openPath === 'function') {
            const failure = await electron.shell.openPath(target);
            if (!failure) return 'shell';
            throw new BiliSumError('OPEN_FAILED', `系统拒绝打开：${failure}`);
          }
        }
      } catch (error) {
        if (error instanceof BiliSumError) throw error;
        // ELECTRON_RUN_AS_NODE returns the executable path instead of the API; fall through.
      }
    }

    const { spawn } = await import('node:child_process');
    const command = process.platform === 'win32'
      ? 'explorer.exe'
      : process.platform === 'darwin' ? 'open' : 'xdg-open';
    await new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(command, [target], { detached: true, stdio: 'ignore' });
      } catch (error) {
        reject(new BiliSumError('OPEN_FAILED', `无法启动 ${command}：${error?.message ?? error}`));
        return;
      }
      child.once('error', (error) => reject(new BiliSumError('OPEN_FAILED', `无法启动 ${command}：${error?.message ?? error}`)));
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
    return command;
  }

  // ----------------------------------------------------------------------
  // Agent tools
  // ----------------------------------------------------------------------
  ctx.effect(() => tools.register({
    name: TOOL_FETCH,
    description: [
      '抓取 B站 视频的元数据与字幕。输入任意包含 BV号 / AV号 / b23.tv 短链的文本（分享文案也可以），',
      '自动去重、并发抓取，并把完整字幕写成 transcriptPath 指向的 Markdown 文件。',
      '返回值里每个视频都带 key；分P/合集视频会为每一P返回一条独立记录，key 形如 BV号#p3。',
      '不带分P选择时默认只抓第 1 P；要抓其他P，请让用户在 BiliSum 面板里勾选后再抓。',
      '返回每个视频的标题、UP主、发布时间、字幕来源（CC/AI）与字符数。',
      '拿到结果后必须用 read 工具读取 transcriptPath 的内容再总结：字符数超过 30000 时按 offset/limit 分段读取，',
      '先分段总结再合并（Map-Reduce）。全部总结完成后再调用 bilisum_write_report 生成报告文件。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '包含 B站 视频链接的原始文本，可以夹杂分享文案或表情。',
        },
        download: {
          type: 'boolean',
          description: '是否同时下载原视频（默认 false）。视频文件很大，只有用户明确要求时才开启。',
        },
        quality: {
          type: 'string',
          enum: ['4k', '1080p', '720p', '480p', 'audio'],
          description: '下载清晰度，默认 1080p；audio 表示只下载音频。',
        },
        subtitles: {
          type: 'boolean',
          description: '是否提取字幕文本（默认 true）。用户只要求下载视频时可设为 false。',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'object', additionalProperties: true },
          videos: { type: 'array', items: { type: 'object', additionalProperties: true } },
          failures: { type: 'array', items: { type: 'object', additionalProperties: true } },
          downloads: { type: 'array', items: { type: 'object', additionalProperties: true } },
          downloadDir: { type: 'string' },
          outputRoot: { type: 'string' },
          logs: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: true,
      },
      render(_args, value) {
        const summary = value?.summary ?? {};
        const lines = [
          `抓取完成：成功 ${summary.ok ?? 0} 个，失败 ${summary.failed ?? 0} 个。`,
          `字幕目录：${value?.outputRoot ?? ''}`,
        ];
        for (const video of value?.videos ?? []) {
          lines.push(`- ${video.bvid} ${video.title}（${video.up}，${video.chars} 字）→ ${video.transcriptPath}`);
        }
        for (const failure of value?.failures ?? []) {
          lines.push(`- 失败 ${failure.link}：${failure.message}`);
        }
        const logs = value?.logs ?? [];
        if (logs.length > 0) {
          lines.push('', '日志：', ...logs.slice(-12));
        }
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    async execute(args, exec) {
      const text = typeof args?.text === 'string' ? args.text : '';
      const subtitles = args?.subtitles !== false;
      const download = args?.download === true
        ? { enabled: true, quality: typeof args?.quality === 'string' ? args.quality : undefined }
        : undefined;
      if (!subtitles && !download) {
        throw new BiliSumError('NO_TASK', '请至少选择一项：提取字幕 或 下载原视频。');
      }
      /** @type {string[]} */
      const logs = [];
      const outcome = await runFetch({
        text,
        subtitles,
        download,
        agent: exec.agent,
        signal: exec.signal,
        onEvent: (event) => {
          if (event?.type === 'log' && typeof event.message === 'string') {
            logs.push(`[${event.level ?? 'info'}] ${event.message}`);
            if (logs.length > 200) logs.splice(0, logs.length - 200);
          }
        },
      });
      return {
        summary: outcome.summary,
        outputRoot: outcome.outputRoot,
        runId: outcome.runId,
        videos: outcome.videos.map((video) => ({
          key: video.key,
          bvid: video.bvid,
          page: video.page,
          pageCount: video.pageCount,
          title: video.title,
          up: video.up,
          pubdate: video.pubdate,
          url: video.url,
          duration: video.duration,
          subtitleKind: video.subtitle?.kind ?? null,
          subtitleLang: video.subtitle?.lang ?? null,
          chars: video.subtitle?.chars ?? 0,
          transcriptPath: video.transcriptPath,
          transcriptDir: video.transcriptDir,
        })),
        failures: outcome.failures,
        downloads: outcome.downloads ?? [],
        downloadDir: outcome.downloadDir ?? null,
        logs: logs.slice(-40),
        next: '对每个成功条目用 read 读取 transcriptPath，先分段总结再合并，然后调用 bilisum_write_report。',
      };
    },
  }), 'bilisum:tool:fetch');

  ctx.effect(() => tools.register({
    name: TOOL_REPORT,
    description: [
      '把视频总结写成 Markdown 报告，保存在BiliSum输出目录下的 B站总结_YYYYMMDD_HHMMSS.md（本机为 ~/.dsh/bilisum/bilibili_summaries/）。',
      '必须先调用 bilisum_fetch 获取字幕；videos[].bvid 取自 bilisum_fetch 的返回，',
      '分P视频还要同时传 key（形如 BV号#p3），否则同一个 BV 的多P会被当成同一条。',
      '标题、UP主、发布时间等元数据会自动用上次抓取结果补齐，只需要提供总结内容。',
      '输出模板固定：核心主旨（一句话）、详细观点（分点）、金句摘录；涉及代码或教程时补充核心步骤。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        videos: {
          type: 'array',
          description: '每个成功抓取视频的总结。',
          items: {
            type: 'object',
            properties: {
              bvid: { type: 'string', description: 'BV 号，必须来自 bilisum_fetch 的返回。' },
              key: { type: 'string', description: '可选：bilisum_fetch 返回的 key；分P视频必须带上，用于匹配具体那一P。' },
              title: { type: 'string' },
              up: { type: 'string' },
              pubdate: { type: 'string' },
              url: { type: 'string' },
              coreSummary: { type: 'string', description: '一句话核心主旨。' },
              points: {
                type: 'array',
                items: { type: 'string' },
                description: '详细观点，分点列出。',
              },
              quotes: {
                type: 'array',
                items: { type: 'string' },
                description: '字幕中的金句原文，不要改写。',
              },
              steps: {
                type: 'array',
                items: { type: 'string' },
                description: '可选：代码或教程视频的核心步骤。',
              },
            },
            required: ['bvid', 'coreSummary'],
            additionalProperties: false,
          },
        },
        failures: {
          type: 'array',
          description: '可选：解析失败列表；省略时沿用上次抓取的失败项。',
          items: {
            type: 'object',
            properties: {
              link: { type: 'string' },
              reason: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['link'],
            additionalProperties: false,
          },
        },
        outputName: { type: 'string', description: '可选：自定义文件名（不含路径）。' },
      },
      required: ['videos'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          bytes: { type: 'number' },
        },
        additionalProperties: true,
      },
      render(_args, value) {
        return [{ type: 'text', text: `报告已保存：${value.path}` }];
      },
    },
    async execute(args, exec) {
      const workdir = await resolveCwd({
        workingDirectory,
        agent: exec.agent,
      });
      const previous = (exec.agent?.id ? lastFetch.get(exec.agent.id) : undefined) ?? lastJobOutcome;
      const list = previous?.videos ?? [];
      const known = new Map(list.map((video) => [video.key ?? video.bvid, video]));
      const byBvid = new Map(list.map((video) => [video.bvid, video]));

      const videos = (Array.isArray(args?.videos) ? args.videos : []).map((entry) => {
        const base = known.get(entry.key ?? entry.bvid) ?? byBvid.get(entry.bvid) ?? {};
        const multi = Number(base.pageCount) > 1;
        return {
          bvid: entry.bvid,
          linkLabel: multi ? `${entry.bvid} P${base.page}` : entry.bvid,
          page: base.page ?? null,
          pageCount: base.pageCount ?? null,
          title: entry.title ?? base.title ?? entry.bvid,
          up: entry.up ?? base.up ?? '未知',
          pubdate: entry.pubdate ?? base.pubdate ?? '未知',
          url: entry.url ?? base.url ?? `https://www.bilibili.com/video/${entry.bvid}`,
          duration: base.duration ?? null,
          subtitle: base.subtitle ?? null,
          coreSummary: entry.coreSummary,
          points: entry.points,
          quotes: entry.quotes,
          steps: entry.steps,
        };
      });

      const failures = Array.isArray(args?.failures)
        ? args.failures.map((failure) => ({
          link: failure.link,
          reason: failure.reason ?? 'UNKNOWN',
          message: failure.message ?? failure.reason ?? '未知错误',
        }))
        : (previous?.failures ?? []);

      const written = await writeReport({
        workdir,
        videos,
        failures,
        outputName: args?.outputName,
      });
      return { path: written.path, bytes: written.bytes };
    },
  }), 'bilisum:tool:report');

  // ----------------------------------------------------------------------
  // Built-in B站 discovery (popular list + keyword search)
  // ----------------------------------------------------------------------
  /** Short-lived cache keyed by `kind:query:page`. */
  const discoverCache = new Map();

  function stripHtml(value) {
    return String(value ?? '').replace(/<[^>]+>/g, '').trim();
  }

  function coverUrl(value) {
    const text = String(value ?? '');
    if (!text) return '';
    return text.startsWith('//') ? `https:${text}` : text;
  }

  function secondsFromClock(value) {
    if (typeof value === 'number') return value;
    const parts = String(value ?? '').split(':').map(Number);
    if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  async function discover({ kind, q, page }) {
    const safePage = Math.min(20, Math.max(1, Number(page) || 1));
    const key = `${kind}:${q}:${safePage}`;
    const hit = discoverCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;

    const url = kind === 'search'
      ? `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(q)}&page=${safePage}`
      : `https://api.bilibili.com/x/web-interface/popular?ps=20&pn=${safePage}`;
    /** @type {Record<string, string>} */
    const headers = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      referer: 'https://www.bilibili.com/',
    };
    const cookie = await readCookie().catch(() => '');
    if (cookie) headers.cookie = `SESSDATA=${cookie}`;

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    const payload = await response.json();
    if (payload?.code !== 0) {
      return { ok: false, error: payload?.message || `B站 返回 ${payload?.code}` };
    }
    const data = payload.data ?? {};
    const list = kind === 'search' ? (data.result ?? []) : (data.list ?? []);
    const items = list.map((item) => ({
      bvid: String(item.bvid ?? ''),
      title: stripHtml(item.title),
      up: String(item.author ?? item.owner?.name ?? ''),
      duration: kind === 'search' ? secondsFromClock(item.duration) : Number(item.duration ?? 0),
      cover: coverUrl(item.pic),
      pubdate: Number(item.pubdate ?? 0),
    })).filter((item) => item.bvid);
    const value = { ok: true, items };
    discoverCache.set(key, { at: Date.now(), value });
    return value;
  }

  // ----------------------------------------------------------------------
  // Settings page endpoints
  //
  // Registered through `ctx.inject` so a Host that boots this plugin before the
  // Web carrier still answers the panel: on a fresh launch `webServer` may not
  // exist yet when `apply` first runs.
  // ----------------------------------------------------------------------
  ctx.inject(['webServer'], (webCtx) => {
    if (!webCtx.webServer) return;
    registerRoutes(webCtx.webServer, webCtx);
    // One-shot layout migration: move the old flat trees into the shared
    // `<video>/subtitles|videos/` structure before anything new lands there.
    if (!migrationStarted) {
      migrationStarted = true;
      void migrateLayout(outputRoot(defaultWorkdir()), (message) => console.log(message));
    }
  });

  function registerRoutes(web, routeCtx) {
    // Route effects belong to the injected context: when the Web carrier is
    // replaced the old routes are disposed instead of colliding with the new set.
    const ctx = routeCtx;

  const jobId = () => `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  /** Append one line to the job's log file; failures never disturb the job. */
  function appendLogFile(file, level, message, at) {
    if (!file) return;
    const date = new Date(at);
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
      + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    void fs.appendFile(file, `[${stamp}] [${level}] ${message}\n`, 'utf8').catch(() => {});
  }

  function pushLog(job, level, message) {
    const at = Date.now();
    job.logs.push({ level, message, at });
    if (job.logs.length > JOB_LOG_LIMIT) job.logs.splice(0, job.logs.length - JOB_LOG_LIMIT);
    appendLogFile(job.logPath, level, message, at);
  }

  async function startJob({ text, items, subtitles, download }) {
    // One batch at a time: a second click must reattach, not fork a twin job.
    const active = activeJobId ? jobs.get(activeJobId) : undefined;
    if (active && active.status === 'running') return active.id;

    const workdir = defaultWorkdir();
    const logDir = outputRoot(workdir);
    await fs.mkdir(logDir, { recursive: true });
    const logPath = path.join(logDir, 'bili_task.log');
    const size = await fs.stat(logPath).then((stat) => stat.size).catch(() => 0);
    // Keep the tail readable across days without unbounded growth.
    if (size > 1_000_000) await fs.writeFile(logPath, '', 'utf8').catch(() => {});

    const job = {
      id: jobId(),
      status: 'running',
      logs: [],
      result: null,
      error: null,
      startedAt: Date.now(),
      workdir,
      logPath,
    };
    jobs.set(job.id, job);
    activeJobId = job.id;
    // One selected part == one subtitle request == one download.
    const planned = Array.isArray(items) && items.length > 0
      ? items.reduce((sum, item) => sum
        + (Array.isArray(item.pages) && item.pages.length > 0 ? item.pages.length : 1), 0)
      : Math.max(1, (String(text ?? '').match(/BV[0-9A-Za-z]{10}/g) ?? []).length || 1);
    job.progress = { phase: 'subtitles', total: planned, done: 0, failed: 0, current: '' };
    pushLog(job, 'processing', '正在解析链接…');

    void (async () => {
      try {
        const outcome = await runFetch({
          text,
          items,
          subtitles,
          download,
          cwd: workdir,
          onEvent: (event) => {
            const progress = job.progress;
            if (event?.type === 'log') pushLog(job, event.level ?? 'info', event.message ?? '');
            if (event?.type === 'video') {
              progress.done += 1;
              progress.current = event.data?.title ?? '';
              pushLog(job, 'success', `已抓取【${event.data?.title ?? '视频'}】。`);
            }
            if (event?.type === 'failure') {
              progress.failed += 1;
              pushLog(job, 'error', `失败：${event.data?.link} — ${event.data?.message ?? ''}`);
            }
            if (event?.type === 'download-start' && progress.phase !== 'downloads') {
              // Downloads reuse the same part count as the subtitle pass.
              progress.phase = 'downloads';
              progress.done = 0;
              progress.failed = 0;
              progress.current = event.data?.title ?? '';
            }
            if (event?.type === 'download-done') {
              progress.done += 1;
              progress.current = event.data?.title ?? progress.current;
            }
            if (event?.type === 'download-failed') {
              progress.failed += 1;
              progress.current = event.data?.title ?? progress.current;
            }
            if (event?.type === 'fatal') pushLog(job, 'error', event.message ?? '抓取失败');
          },
        });
        lastJobOutcome = outcome;
        job.result = {
          runId: outcome.runId,
          outputRoot: outcome.outputRoot,
          summary: outcome.summary,
          failures: outcome.failures,
          videos: outcome.videos.map((video) => ({
            key: video.key,
            bvid: video.bvid,
            page: video.page,
            pageCount: video.pageCount,
            title: video.title,
            up: video.up,
            pubdate: video.pubdate,
            url: video.url,
            chars: video.subtitle?.chars ?? 0,
            subtitleKind: video.subtitle?.kind ?? null,
            transcriptPath: video.transcriptPath,
            transcriptDir: video.transcriptDir,
          })),
          downloads: outcome.downloads ?? [],
          downloadFailures: outcome.downloadFailures ?? [],
          downloadDir: outcome.downloadDir ?? null,
          downloadRequested: Boolean(download?.enabled),
        };
        job.downloadBase = outcome.downloadDir ?? null;
        job.downloadQuality = download?.quality ?? '1080p';
        job.runId = outcome.runId;
        job.status = 'done';
        job.progress.phase = 'done';
        job.progress.current = '';
        pushLog(job, 'success', `抓取完成：成功 ${outcome.videos.length} 个，失败 ${outcome.failures.length} 个。`);
        if (outcome.downloads?.length) {
          pushLog(job, 'success', `下载完成：${outcome.downloads.length} 个文件 → ${outcome.downloadDir}`);
        }
        if (outcome.videos.length > 0) {
          pushLog(
            job,
            'info',
            '字幕已缓存。回到对话里说“总结这些视频”，Agent 会读取字幕并生成报告文件。',
          );
        } else if (subtitles !== false) {
          pushLog(job, 'warning', '没有任何视频拿到字幕，先检查上面的失败原因（通常是缺少或过期的 SESSDATA）。');
        } else if (!(outcome.downloads?.length)) {
          pushLog(job, 'warning', '本次没有产出：既没有提取字幕，也没有下载到视频。');
        }
      } catch (error) {
        job.status = 'error';
        job.error = error?.message ?? String(error);
        job.progress.phase = 'done';
        pushLog(job, 'error', job.error);
      } finally {
        job.finishedAt = Date.now();
        if (activeJobId === job.id) activeJobId = null;
      }
    })();

    return job.id;
  }

  /**
   * Re-download failed items one by one and fold the outcome back into the
   * finished job, so the page can update just those rows.
   */
  async function retryDownloads(job, targets) {
    job.retrying = [...new Set([...(job.retrying ?? []), ...targets.map((item) => item.key)])];
    let cookie = '';
    try {
      cookie = await readCookie();
    } catch {
      cookie = '';
    }
    for (const target of targets) {
      const quality = target.quality || job.downloadQuality || '1080p';
      pushLog(job, 'processing', `正在重试【${target.title ?? target.key}】…`);
      try {
        const outcome = await downloadItems({
          subprocess,
          cwd: job.workdir,
          pythonPath: configuredPython,
          extraRoots: workspaceRoots(),
          cookie,
          quality,
          baseDir: job.downloadBase,
          stamp: job.runId ?? '00000000_000000',
          items: [{ bvid: target.bvid, page: target.page }],
          onEvent: () => {},
        });
        const done = outcome.downloads?.[0];
        if (done) {
          job.result.downloads = [...(job.result.downloads ?? []), done];
          job.result.downloadFailures = (job.result.downloadFailures ?? [])
            .filter((item) => item.key !== target.key);
          if (job.progress) {
            job.progress.done += 1;
            job.progress.failed = Math.max(0, job.progress.failed - 1);
          }
          pushLog(job, 'success', `重试成功【${done.title}】→ ${done.path}`);
        } else {
          const failure = outcome.failures?.[0];
          const message = failure?.message ?? '仍未成功';
          job.result.downloadFailures = (job.result.downloadFailures ?? []).map((item) => (
            item.key === target.key ? { ...item, message } : item
          ));
          pushLog(job, 'warning', `重试仍失败【${target.title ?? target.key}】：${message}`);
        }
      } catch (error) {
        pushLog(job, 'warning', `重试失败【${target.title ?? target.key}】：${error?.message ?? error}`);
      } finally {
        job.retrying = (job.retrying ?? []).filter((key) => key !== target.key);
      }
      if (targets.length > 1) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  function sweepJobs() {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (job.finishedAt && now - job.finishedAt > JOB_RETENTION_MS) jobs.delete(id);
    }
  }

  function guard(req) {
    try {
      const origin = web.getOrigin?.();
      const requestOrigin = req.headers.origin;
      if (origin && requestOrigin && requestOrigin !== origin) return false;
    } catch {
      // getOrigin throws before the listener binds; requests cannot arrive then.
    }
    return true;
  }

  function send(res, status, payload) {
    res.writeHead(status, JSON_HEADERS);
    res.end(JSON.stringify(payload));
  }

  async function readJson(req, limit = 512 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new BiliSumError('TOO_LARGE', '请求体过大。');
      chunks.push(chunk);
    }
    if (chunks.length === 0) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new BiliSumError('BAD_JSON', '请求体不是合法 JSON。');
    }
  }

  ctx.effect(() => web.register({
    kind: 'exact',
    path: '/bilisum/status',
    async handler(req, res) {
      if (!guard(req)) return send(res, 403, { error: 'origin rejected' });
      const workdir = defaultWorkdir();
      const [cookie, python] = await Promise.all([readCookie(), pythonStatus(workdir)]);
      const cookieValid = await probeCookie(cookie);
      const download = await downloadStatus(workdir);
      send(res, 200, {
        cookieConfigured: Boolean(cookie),
        cookieValid,
        cwd: workdir,
        outputDir: outputRoot(),
        isCustomOutput: hasCustomOutput(),
        download,
        python: {
          path: python.path,
          ok: Boolean(python.path),
          checked: python.checked.slice(0, 6),
        },
      });
    },
  }), 'bilisum:route:status');

  ctx.effect(() => web.register({
    kind: 'exact',
    path: '/bilisum/probe',
    async handler(req, res) {
      if (!guard(req)) return send(res, 403, { error: 'origin rejected' });
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      try {
        const body = await readJson(req);
        const text = typeof body?.text === 'string' ? body.text : '';
        const cookie = await readCookie();
        const workdir = defaultWorkdir();
        const outcome = await probeVideos({
          subprocess,
          cwd: workdir,
          text,
          pythonPath: configuredPython,
          extraRoots: workspaceRoots(),
          cookie,
        });
        send(res, 200, {
          ok: true,
          videos: outcome.probes.map((probe) => ({
            bvid: probe.bvid,
            title: probe.title,
            seriesTitle: probe.seriesTitle,
            up: probe.up,
            pubdate: probe.pubdate,
            duration: probe.duration,
            multi: probe.multi,
            defaultPage: Number(probe.defaultPage) > 0 ? Number(probe.defaultPage) : 1,
            pages: probe.pages.map((page) => ({
              page: page.page,
              cid: page.cid,
              part: page.part,
              duration: page.duration,
            })),
          })),
          failures: outcome.failures,
          summary: outcome.summary,
        });
      } catch (error) {
        send(res, 400, { ok: false, error: error?.message ?? String(error) });
      }
    },
  }), 'bilisum:route:probe');

  ctx.effect(() => web.register({
    kind: 'exact',
    path: '/bilisum/cookie',
    async handler(req, res) {
      if (!guard(req)) return send(res, 403, { error: 'origin rejected' });
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      try {
        const body = await readJson(req);
        const sessdata = typeof body.sessdata === 'string' ? body.sessdata.trim() : '';
        await writeCookie(sessdata);
        pythonCache = { at: 0, value: null };
        cookieCache = { at: 0, value: null, key: '' };
        const cookieValid = sessdata ? await probeCookie(sessdata) : null;
        send(res, 200, { ok: true, cookieConfigured: Boolean(sessdata), cookieValid });
      } catch (error) {
        send(res, 500, { ok: false, error: error?.message ?? String(error) });
      }
    },
  }), 'bilisum:route:cookie');

  ctx.effect(() => web.register({
    kind: 'exact',
    path: '/bilisum/start',
    async handler(req, res) {
      if (!guard(req)) return send(res, 403, { error: 'origin rejected' });
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      try {
        sweepJobs();
        const body = await readJson(req);
        const text = typeof body.text === 'string' ? body.text : '';
        const items = Array.isArray(body.items) ? body.items : undefined;
        const subtitles = body.subtitles !== false;
        const download = body.download && typeof body.download === 'object'
          ? { enabled: body.download.enabled !== false, quality: body.download.quality }
          : undefined;
        if (!subtitles && !download?.enabled) {
          return send(res, 400, { ok: false, error: '请至少勾选一项：提取字幕 或 下载原视频。' });
        }
        const id = await startJob({ text, items, subtitles, download });
        send(res, 200, { ok: true, jobId: id });
      } catch (error) {
        send(res, 400, { ok: false, error: error?.message ?? String(error) });
      }
    },
  }), 'bilisum:route:start');

  ctx.effect(() => web.register({
    kind: 'exact',
    path: '/bilisum/poll',
    async handler(req, res) {
      if (!guard(req)) return send(res, 403, { error: 'origin rejected' });
      sweepJobs();
      const url = new URL(req.url ?? '/bilisum/poll', 'http://localhost');
      const id = url.searchParams.get('jobId') ?? '';
      const from = Number(url.searchParams.get('from') ?? '0') || 0;
      const job = jobs.get(id);
      if (!job) return send(res, 404, { error: 'job not found' });
      send(res, 200, {
        status: job.status,
        logs: job.logs.slice(from),
        nextOffset: job.logs.length,
        error: job.error,
        result: job.result,
        progress: job.progress ?? null,
        retrying: job.retrying ?? [],
      });
    },
  }), 'bilisum:route:poll');

  ctx.effect(() => web.register({
    kind: 'exact',
    path: '/bilisum/current',
    async handler(req, res) {
      if (!guard(req)) return send(res, 403, { error: 'origin rejected' });
      sweepJobs();
      const job = (activeJobId ? jobs.get(activeJobId) : undefined)
        ?? [...jobs.values()].sort((left, right) => right.startedAt - left.startedAt)[0];
      if (!job) return send(res, 200, { ok: true, job: null });
      // A finished batch stays adoptable for a while so a remounted page can
      // show its result instead of an empty console.
      if (job.status !== 'running' && job.finishedAt && Date.now() - job.finishedAt > 30 * 60_000) {
        return send(res, 200, { ok: true, job: null });
      }
      send(res, 200, {
        ok: true,
        job: {
          jobId: job.id,
          status: job.status,
          logs: job.logs,
          nextOffset: job.logs.length,
          error: job.error,
          result: job.result,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt ?? null,
          workdir: job.workdir,
          logFile: job.logPath ?? null,
          retrying: job.retrying ?? [],
          progress: job.progress ?? null,
        },
      });
    },
  }), 'bilisum:route:current');

  ctx.effect(() => web.register({
    kind: 'exact',
    path: '/bilisum/discover',
    async handler(req, res) {
      if (!guard(req)) return send(res, 403, { error: 'origin rejected' });
      const url = new URL(req.url ?? '/bilisum/discover', 'http://localhost');
      const kind = url.searchParams.get('kind') === 'search' ? 'search' : 'popular';
      const q = (url.searchParams.get('q') ?? '').trim();
      const page = Number(url.searchParams.get('page') ?? '1') || 1;
      if (kind === 'search' && !q) {
        return send(res, 400, { ok: false, error: '请输入搜索关键词' });
      }
      try {
        const result = await discover({ kind, q, page });
        send(res, result.ok ? 200 : 502, result);
      } catch (error) {
        send(res, 502, { ok: false, error: error?.message ?? String(error) });
      }
    },
  }), 'bilisum:route:discover');

  /** Best-effort persistence of the panel choice into the profile config. */
  async function persistOutputDir(value) {
    const editor = ctx.get('configEditor');
    if (!editor) return false;
    try {
      if (typeof editor.updateConfig === 'function') {
        await editor.updateConfig('bilisum', { outputDir: value });
        return true;
      }
      if (typeof editor.setConfig === 'function') {
        await editor.setConfig('bilisum', { outputDir: value });
        return true;
      }
      if (typeof editor.update === 'function') {
        await editor.update('bilisum', { outputDir: value });
        return true;
      }
    } catch {
      // Fall through: the runtime override still applies for this session.
    }
    return false;
  }

  ctx.effect(() => web.register({
    kind: 'exact',
    path: '/bilisum/config',
    async handler(req, res) {
      if (!guard(req)) return send(res, 403, { error: 'origin rejected' });
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      try {
        const body = await readJson(req);
        const next = typeof body.outputDir === 'string' ? body.outputDir.trim() : '';
        outputOverride = next;
        const root = outputRoot();
        await fs.mkdir(root, { recursive: true }).catch(() => {});
        const persisted = await persistOutputDir(next);
        send(res, 200, {
          ok: true,
          outputDir: root,
          isCustomOutput: hasCustomOutput(),
          persisted,
        });
      } catch (error) {
        send(res, 400, { ok: false, error: error?.message ?? String(error) });
      }
    },
  }), 'bilisum:route:config');

  ctx.effect(() => web.register({
    kind: 'exact',
    path: '/bilisum/reset',
    async handler(req, res) {
      if (!guard(req)) return send(res, 403, { error: 'origin rejected' });
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      // Drop every finished batch so a remounted page starts clean. A batch
      // that is still downloading is kept: forgetting it would hide work the
      // Host is actively doing.
      let kept = null;
      for (const [id, job] of jobs) {
        if (job.status === 'running') {
          kept = id;
          continue;
        }
        jobs.delete(id);
      }
      activeJobId = kept;
      pythonCache = { at: 0, value: null };
      cookieCache = { at: 0, value: null, key: '' };
      downloadCache = { at: 0, value: null };
      send(res, 200, { ok: true, running: Boolean(kept) });
    },
  }), 'bilisum:route:reset');

  ctx.effect(() => web.register({
    kind: 'exact',
    path: '/bilisum/retry',
    async handler(req, res) {
      if (!guard(req)) return send(res, 403, { error: 'origin rejected' });
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      sweepJobs();
      try {
        const body = await readJson(req);
        const jobId = typeof body?.jobId === 'string' ? body.jobId : '';
        const job = (jobId ? jobs.get(jobId) : undefined)
          ?? (activeJobId ? jobs.get(activeJobId) : undefined)
          ?? [...jobs.values()].sort((left, right) => right.startedAt - left.startedAt)[0];
        if (!job || !job.result) {
          return send(res, 404, { ok: false, error: '没有可重试的任务' });
        }
        const keys = Array.isArray(body?.keys) ? body.keys.map(String) : [];
        if (keys.length === 0) {
          return send(res, 400, { ok: false, error: '未指定要重试的项' });
        }
        const failures = job.result.downloadFailures ?? [];
        const targets = failures.filter((item) => keys.includes(item.key));
        if (targets.length === 0) {
          return send(res, 400, { ok: false, error: '这些项目不在失败列表里' });
        }
        void retryDownloads(job, targets);
        send(res, 200, { ok: true, retrying: targets.map((item) => item.key) });
      } catch (error) {
        send(res, 500, { ok: false, error: error?.message ?? String(error) });
      }
    },
  }), 'bilisum:route:retry');

  ctx.effect(() => web.register({
    kind: 'exact',
    path: '/bilisum/open',
    async handler(req, res) {
      if (!guard(req)) return send(res, 403, { error: 'origin rejected' });
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      const root = path.resolve(outputRoot(defaultWorkdir()));
      try {
        const body = await readJson(req);
        const requested = typeof body?.path === 'string' && body.path.trim()
          ? path.resolve(body.path)
          : root;
        // Stay inside the plugin's own output folder: this route must never
        // become a generic "open any path" primitive for the page.
        if (requested !== root && !requested.startsWith(root + path.sep)) {
          return send(res, 400, { ok: false, error: '只能打开 bilibili_summaries 目录里的内容' });
        }
        await fs.mkdir(root, { recursive: true });
        if (requested !== root) {
          const exists = await fs.access(requested).then(() => true).catch(() => false);
          if (!exists) return send(res, 404, { ok: false, error: '路径不存在（可能已被删除）' });
        }
        const how = await revealPath(requested);
        send(res, 200, { ok: true, opened: requested, via: how });
      } catch (error) {
        send(res, 500, { ok: false, error: error?.message ?? String(error) });
      }
    },
  }), 'bilisum:route:open');
  }
}
