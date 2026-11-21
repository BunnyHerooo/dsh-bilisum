/**
 * BiliSum pipeline: parse input, run the Python worker, and persist one
 * transcript file per video so the agent can summarize it with the read tool.
 *
 * Both callers — the agent tool and the settings-page job runner — go through
 * `fetchVideos`, so failures, logs and file layout stay identical.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseLinks } from './links.js';
import { OUTPUT_DIR, renderTranscript, resolveOutputRoot, timestamps } from './report.js';
import { detectPython, runWorker } from './worker.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The worker ships beside this module's parent directory. */
export const WORKER_PATH = path.resolve(here, '..', 'python', 'bilisum_worker.py');

/** Characters Windows refuses in a file name, plus control characters. */
const UNSAFE_NAME = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

/** Bracket pairs trimmed when a truncated name leaves one unclosed. */
const BRACKET_PAIRS = [['【', '】'], ['《', '》'], ['（', '）'], ['(', ')'], ['[', ']'], ['「', '」']];

/**
 * Drop a trailing fragment that would leave a bracket unbalanced.
 * @param {string} value
 */
function trimUnbalanced(value) {
  let text = value;
  for (const [open, close] of BRACKET_PAIRS) {
    let depth = 0;
    let lastOpen = -1;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === open) {
        depth += 1;
        lastOpen = index;
      } else if (text[index] === close && depth > 0) {
        depth -= 1;
      }
    }
    if (depth > 0 && lastOpen >= 0) text = text.slice(0, lastOpen);
  }
  return text.trim().replace(/[. ]+$/, '');
}

/**
 * Filesystem-safe stem, shared with the worker so one part's transcript folder
 * and its video folder carry exactly the same name.
 *
 * The limit keeps `<base>\<collection>\<part>\<part>.ext` inside the Windows
 * path budget, where the base already spends most of the 260 characters.
 *
 * @param {string} title
 * @param {number} [limit]
 */
export function safeFolderStem(title, limit = 56) {
  const cleaned = String(title ?? '')
    .replace(UNSAFE_NAME, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  let stem = trimmedSlice(cleaned, limit);
  if (stem) stem = trimUnbalanced(stem);
  return stem || '未命名视频';
}

/** Slice at a space when that keeps most of the budget, else hard-cut. */
function trimmedSlice(value, limit) {
  if (value.length <= limit) return value.trim();
  const hard = value.slice(0, limit);
  const cut = hard.lastIndexOf(' ');
  return (cut > limit * 0.6 ? hard.slice(0, cut) : hard).trim();
}

/**
 * Transcript file name: `视频名_YYYYMMDD_HHMMSS.md`.
 *
 * The stamp is the video's own publish instant, because the folder is an archive
 * of videos rather than of fetch runs; a missing publish instant falls back to
 * the batch stamp so a file always lands in the same run's folder.
 *
 * @param {string} title
 * @param {number | null | undefined} pubdateTs Unix seconds from the worker
 * @param {string} fallbackStamp Batch stamp such as `20261114_171250`
 */
export function transcriptFileName(title, pubdateTs, fallbackStamp) {
  const stem = safeFolderStem(title);
  const published = Number.isFinite(pubdateTs) && Number(pubdateTs) > 0
    ? timestamps(new Date(Number(pubdateTs) * 1000)).stamp
    : fallbackStamp;
  return `${stem}_${published}.md`;
}

async function fileExists(candidate) {
  return fs.access(candidate).then(() => true).catch(() => false);
}

/**
 * Normalize the download request into the worker's payload shape.
 *
 * Videos never share the transcript folder: the worker gives each part its own
 * `视频名_年月日_时间` folder under `<outputRoot>/videos/`, mirroring how
 * transcripts are organized, so deleting reports cannot orphan media.
 *
 * @param {boolean | { enabled?: boolean, quality?: string } | undefined} download
 * @param {string} outputRoot
 * @param {string} stamp
 * @returns {{ dir: string, stamp: string, quality: string } | undefined}
 */
export function normalizeDownload(download, outputRoot, stamp) {
  if (!download) return undefined;
  if (typeof download === 'object' && download.enabled === false) return undefined;
  const quality = typeof download === 'object' && download.quality ? String(download.quality) : '1080p';
  return { dir: outputRoot, stamp, quality };
}

/**
 * Metadata-only pass: resolve links and report every part of multi-P videos so
 * the page can offer a checkbox list of real titles.
 *
 * @param {{
 *   subprocess?: any,
 *   workingDirectory?: any,
 *   agent?: any,
 *   cwd?: string,
 *   text: string,
 *   pythonPath?: string,
 *   extraRoots?: string[],
 *   cookie?: string,
 *   signal?: AbortSignal,
 *   onEvent?: (event: any) => void,
 * }} options
 * @returns {Promise<{ probes: any[], failures: any[], summary: any, workdir: string }>}
 */
/** PGC (bangumi / movie) season endpoint. */
const BANGUMI_API = 'https://api.bilibili.com/pgc/view/web/season';

/**
 * Resolve a `ss<season>` / `ep<episode>` reference to the video id behind it.
 *
 * Paid content still needs the account's own cookie; this only translates the
 * page into the id the rest of the pipeline already understands.
 *
 * @param {{ kind: string, value: string }} ref
 * @param {string} cookie
 * @returns {Promise<{ ref?: { kind: string, value: string, page: null }, error?: string }>}
 */
async function resolveBangumi(ref, cookie) {
  const isEpisode = ref.value.startsWith('ep');
  const query = isEpisode
    ? `ep_id=${encodeURIComponent(ref.value.slice(2))}`
    : `season_id=${encodeURIComponent(ref.value.slice(2))}`;
  /** @type {Record<string, string>} */
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    referer: 'https://www.bilibili.com/',
  };
  if (cookie) headers.cookie = `SESSDATA=${cookie}`;
  try {
    const response = await fetch(`${BANGUMI_API}?${query}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json();
    const season = payload?.result;
    const episodes = Array.isArray(season?.episodes) ? season.episodes : [];
    if (episodes.length === 0) {
      return { error: payload?.message || '影视/番剧接口没有返回剧集' };
    }
    const target = isEpisode
      ? episodes[0]
      : (episodes.find((item) => item?.bvid) ?? episodes[0]);
    if (!target?.bvid) {
      return { error: '该剧集没有公开的 BV 号（可能未过审，或需要单独购买）' };
    }
    return {
      ref: { kind: 'bvid', value: String(target.bvid), page: null },
      title: season?.title ?? '',
      total: episodes.length,
      detail: `${target.title ?? ''}${target.long_title ? ` ${target.long_title}` : ''}`.trim(),
    };
  } catch (error) {
    return { error: error?.message ?? String(error) };
  }
}

/**
 * Expand bangumi references into plain video ids, logging what was chosen.
 * @param {any[]} refs
 * @param {string} cookie
 * @param {(event: any) => void} emit
 */
async function resolveBangumiRefs(refs, cookie, emit) {
  const expanded = [];
  for (const ref of refs) {
    if (ref.kind !== 'bangumi') {
      expanded.push(ref);
      continue;
    }
    const resolved = await resolveBangumi(ref, cookie);
    if (!resolved.ref) {
      emit({
        type: 'log',
        level: 'error',
        message: `影视链接 ${ref.value} 解析失败：${resolved.error}`,
      });
      continue;
    }
    emit({
      type: 'log',
      level: 'info',
      message: resolved.total > 1 && !ref.value.startsWith('ep')
        ? `《${resolved.title}》共 ${resolved.total} 集，本次解析第 1 集（${resolved.detail || resolved.ref.value}）；要抓其它集请粘贴对应的 ep 链接。`
        : `已解析影视《${resolved.title}》→ ${resolved.ref.value}${resolved.detail ? `（${resolved.detail}）` : ''}`,
    });
    expanded.push(resolved.ref);
  }
  return expanded;
}

export async function probeVideos(options) {
  const { subprocess, cwd, text, pythonPath, cookie, signal, onEvent } = options;
  const emit = (event) => {
    try {
      onEvent?.(event);
    } catch {
      // a logging consumer must never break the batch
    }
  };

  const parsed = parseLinks(text);
  if (parsed.videos.length === 0 && parsed.shorts.length === 0) {
    throw new BiliSumError('NO_LINK', '未检测到有效的B站视频链接（需包含 BV 号、AV 号或 b23.tv 短链）。');
  }

  // Resolve bangumi/movie pages to their BV id before anything else runs.
  const videos = await resolveBangumiRefs(parsed.videos, cookie, emit);

  const workdir = await resolveCwd({ workingDirectory: options.workingDirectory, agent: options.agent, cwd });
  const python = await detectPython({
    subprocess,
    configured: pythonPath,
    cwd: workdir,
    extraRoots: options.extraRoots,
  });
  if (!python.path) {
    throw new BiliSumError(
      'NO_PYTHON',
      '找不到可用的 Python 解释器（需要已安装 bilibili-api-python 与 aiohttp）。',
    );
  }

  const outcome = await runWorker({
    subprocess,
    pythonPath: python.path,
    workerPath: WORKER_PATH,
    cwd: workdir,
    mode: 'probe',
    payload: {
      videos: videos.map((ref) => ({
        kind: ref.kind,
        value: ref.value,
        page: ref.page ?? null,
      })),
      shorts: parsed.shorts.map((short) => short.raw),
    },
    cookie,
    signal,
    onEvent: emit,
  });

  if (outcome.fatal) throw new BiliSumError('WORKER_FAILED', outcome.fatal.trim());
  return {
    probes: outcome.probes,
    failures: outcome.failures,
    summary: outcome.probeSummary,
    workdir,
  };
}

/** Error with a stable code so callers can render it consistently. */
export class BiliSumError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BiliSumError';
    this.code = code;
  }
}

/**
 * Resolve the working directory to write into.
 * @param {{ workingDirectory?: any, agent?: any, cwd?: string }} options
 */
export async function resolveCwd({ workingDirectory, agent, cwd }) {
  if (cwd) return cwd;
  if (workingDirectory && agent) {
    try {
      return await workingDirectory.ensure(agent);
    } catch {
      // fall through to the default directory
    }
    try {
      return workingDirectory.defaultDirectory || process.cwd();
    } catch {
      // ignore
    }
  }
  return workingDirectory?.defaultDirectory || process.cwd();
}

/**
 * Download-only pass used by the per-item retry button: no subtitles, one part.
 *
 * @param {{ subprocess?: any, cwd: string, pythonPath?: string, extraRoots?: string[],
 *   cookie?: string, quality: string, baseDir: string, stamp: string,
 *   items: Array<{ bvid: string, page: number }>,
 *   onEvent?: (event: any) => void }} options
 */
export async function downloadItems(options) {
  const { subprocess, cwd, pythonPath, cookie, quality, baseDir, stamp, items, onEvent } = options;
  const python = await detectPython({
    subprocess,
    configured: pythonPath,
    cwd,
    extraRoots: options.extraRoots,
  });
  if (!python.path) {
    throw new BiliSumError('NO_PYTHON', '找不到可用的 Python 解释器。');
  }
  const outcome = await runWorker({
    subprocess,
    pythonPath: python.path,
    workerPath: WORKER_PATH,
    cwd,
    mode: 'fetch',
    payload: {
      videos: items.map((item) => ({ kind: 'bvid', value: item.bvid, pages: [item.page] })),
      shorts: [],
      subtitles: false,
      comments: false,
      download: { dir: baseDir, stamp, quality },
    },
    cookie,
    onEvent,
  });
  if (outcome.fatal) throw new BiliSumError('WORKER_FAILED', outcome.fatal.trim());
  return {
    downloads: outcome.downloads ?? [],
    failures: outcome.downloadFailures ?? [],
  };
}

/**
 * @typedef {Object} FetchOutcome
 * @property {Array<any>} videos Videos with `transcriptPath` filled in
 * @property {Array<any>} failures
 * @property {{ total: number, ok: number, failed: number } | null} summary
 * @property {string} runId Batch stamp, also the transcript folder name
 * @property {string} outputRoot Absolute `bilibili_summaries` directory
 */

/**
 * Fetch every video referenced by `text`.
 * @param {{
 *   subprocess?: any,
 *   workingDirectory?: any,
 *   agent?: any,
 *   cwd?: string,
 *   text?: string,
 *   items?: Array<{ kind: string, value: string, pages?: number[] }>,
 *   pythonPath?: string,
 *   extraRoots?: string[],
 *   configuredOutput?: string,
 *   subtitles?: boolean,
 *   comments?: boolean,
 *   download?: boolean | { enabled?: boolean, quality?: string },
 *   cookie?: string,
 *   signal?: AbortSignal,
 *   onEvent?: (event: any) => void,
 * }} options
 * @returns {Promise<FetchOutcome>}
 */
export async function fetchVideos(options) {
  const { subprocess, cwd, text, pythonPath, cookie, signal, onEvent, items } = options;
  const emit = (event) => {
    try {
      onEvent?.(event);
    } catch {
      // a logging consumer must never break the batch
    }
  };

  /** Selected work: either explicit items from the page or parsed from text. */
  let refs;
  let shorts = [];
  if (Array.isArray(items) && items.length > 0) {
    refs = items
      .filter((item) => item && item.value)
      .map((item) => ({
        kind: item.kind === 'avid' ? 'avid' : 'bvid',
        value: String(item.value),
        pages: Array.isArray(item.pages) && item.pages.length > 0
          ? item.pages.map(Number).filter(Number.isFinite)
          : null,
      }));
    emit({ type: 'log', level: 'info', message: `已确认 ${refs.length} 个视频（含分P选择），开始抓取。` });
  } else {
    const parsed = parseLinks(text);
    if (parsed.videos.length === 0 && parsed.shorts.length === 0) {
      throw new BiliSumError(
        'NO_LINK',
        '未检测到有效的B站视频链接（需包含 BV 号、AV 号或 b23.tv 短链）。',
      );
    }
    emit({
      type: 'log',
      level: 'info',
      message: `成功提取 ${parsed.videos.length} 个有效视频 ID${
        parsed.shorts.length > 0 ? `，另有 ${parsed.shorts.length} 个短链待解析` : ''
      }。`,
    });
    refs = await resolveBangumiRefs(parsed.videos, cookie, emit);
    refs = refs.map((ref) => ({
      kind: ref.kind,
      value: ref.value,
      // A `?p=3` link fetches that part; a bare link fetches the first part.
      pages: ref.page ? [ref.page] : null,
      page: ref.page ?? null,
    }));
    shorts = parsed.shorts.map((short) => short.raw);
  }

  const workdir = await resolveCwd({ workingDirectory: options.workingDirectory, agent: options.agent, cwd });
  const python = await detectPython({
    subprocess,
    configured: pythonPath,
    cwd: workdir,
    extraRoots: options.extraRoots,
  });
  if (!python.path) {
    const tried = python.checked
      .map((entry) => `${entry.path} → ${entry.detail}`)
      .slice(0, 8)
      .join('；');
    throw new BiliSumError(
      'NO_PYTHON',
      `找不到可用的 Python 解释器（需要已安装 bilibili-api-python 与 aiohttp）。已尝试：${tried}`,
    );
  }
  emit({ type: 'log', level: 'info', message: `使用 Python 解释器：${python.path}` });

  const stamps = timestamps();
  const outputRoot = resolveOutputRoot(options.configuredOutput);
  const downloadOptions = normalizeDownload(options.download, outputRoot, stamps.stamp);
  const subtitlesEnabled = options.subtitles !== false;
  const commentsEnabled = options.comments !== false;

  const outcome = await runWorker({
    subprocess,
    pythonPath: python.path,
    workerPath: WORKER_PATH,
    cwd: workdir,
    mode: 'fetch',
    payload: {
      videos: refs,
      shorts,
      subtitles: subtitlesEnabled,
      comments: commentsEnabled,
      ...(downloadOptions ? { download: downloadOptions } : {}),
    },
    cookie,
    signal,
    onEvent: emit,
  });

  if (outcome.fatal) {
    throw new BiliSumError('WORKER_FAILED', outcome.fatal.trim());
  }
  if (outcome.code !== 0 && outcome.videos.length === 0) {
    throw new BiliSumError(
      'WORKER_FAILED',
      `抓取进程异常退出（退出码 ${outcome.code}）。${outcome.stderr.trim().slice(-400)}`,
    );
  }

  // Persist one transcript per returned part into the shared layout:
  // `<group>/subtitles/<stem>.md`, where a standalone video is its own group.
  if (outcome.videos.length > 0) {
    for (const video of outcome.videos) {
      const stem = transcriptFileName(video.title, video.pubdateTs, stamps.stamp).replace(/\.md$/, '');
      const group = Number(video.pageCount) > 1
        ? safeFolderStem(video.seriesTitle || video.videoTitle || video.title, 48)
        : stem;
      const folder = path.join(outputRoot, group, 'subtitles');
      await fs.mkdir(folder, { recursive: true });
      let file = path.join(folder, `${stem}.md`);
      for (let attempt = 2; await fileExists(file); attempt += 1) {
        file = path.join(folder, `${stem}_${attempt}.md`);
      }
      await fs.writeFile(file, renderTranscript(video), 'utf8');
      video.transcriptPath = file;
      video.transcriptDir = folder;
      emit({
        type: 'log',
        level: 'success',
        message: `字幕已保存：${file}`,
      });
    }
  }

  return {
    videos: outcome.videos,
    failures: outcome.failures,
    summary: outcome.summary,
    downloads: outcome.downloads ?? [],
    downloadFailures: outcome.downloadFailures ?? [],
    downloadDir: downloadOptions?.dir ?? null,
    runId: stamps.stamp,
    outputRoot,
  };
}
