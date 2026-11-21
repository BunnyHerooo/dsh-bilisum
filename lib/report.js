/**
 * BiliSum rendering: timestamped report paths, the PRD-mandated Markdown
 * report, and per-video transcript files the agent reads before summarizing.
 *
 * Pure string building plus one small file-writing helper; nothing here calls
 * the network or a model.
 */

import path from 'node:path';

import { bilisumHome } from './home.js';

/** Output folder name inside BiliSum's runtime home by default. */
export const OUTPUT_DIR = 'bilibili_summaries';

/**
 * Resolve where reports and transcripts live.
 *
 * Without a configured directory the folder sits in BiliSum's runtime home
 * (`~/.dsh/bilisum/bilibili_summaries`), never inside the package itself: an
 * installed package may be read-only.
 *
 * @param {string} configured Configured directory (absolute, or relative to the home)
 */
export function resolveOutputRoot(configured) {
  const value = typeof configured === 'string' ? configured.trim() : '';
  if (!value) return path.join(bilisumHome(), OUTPUT_DIR);
  return path.isAbsolute(value) ? value : path.join(bilisumHome(), value);
}

/**
 * @typedef {Object} Subtitle
 * @property {'cc' | 'ai'} kind
 * @property {string} lang Human-readable language label from Bilibili
 * @property {string} langCode Bilibili language code, such as `zh-CN`
 * @property {string} text Plain-text transcript
 * @property {number} chars Character count of `text`
 */

/**
 * @typedef {Object} HotComment
 * @property {string} user Commenter display name
 * @property {number} like Like count
 * @property {number} replies Reply count under the comment
 * @property {string} text Single-line comment body
 */

/**
 * @typedef {Object} VideoResult
 * @property {string} bvid
 * @property {number | null} aid
 * @property {string} title
 * @property {string} up
 * @property {string} pubdate `YYYY-MM-DD`
 * @property {string} url
 * @property {number | null} duration Seconds
 * @property {Subtitle | null} subtitle
 * @property {HotComment[]} [comments] Top-liked comments, video-wide
 * @property {string} [transcriptPath]
 */

/**
 * @typedef {Object} Failure
 * @property {string} link Identifier or URL that failed
 * @property {string} reason Short machine-readable code
 * @property {string} message User-facing explanation
 */

function pad(value) {
  return String(value).padStart(2, '0');
}

/**
 * Both timestamp forms used by the report: the compact file stamp and the
 * human-readable generation time.
 * @param {Date} [date]
 */
export function timestamps(date = new Date()) {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return {
    stamp: `${y}${m}${d}_${hh}${mm}${ss}`,
    display: `${y}-${m}-${d} ${hh}:${mm}:${ss}`,
    date: `${y}-${m}-${d}`,
  };
}

/** `B站总结_YYYYMMDD_HHMMSS.md` */
export function reportFileName(date = new Date()) {
  return `B站总结_${timestamps(date).stamp}.md`;
}

/**
 * Format a duration in seconds as `1小时02分` style text.
 * @param {number | null | undefined} seconds
 */
export function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '未知';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}小时${pad(m)}分`;
  if (m > 0) return `${m}分${pad(s)}秒`;
  return `${s}秒`;
}

/**
 * Normalize a bullet list: accept strings, objects, or a single string blob and
 * return clean `- ` lines. Models sometimes echo the bullet marker.
 * @param {unknown} value
 * @returns {string[]}
 */
export function bulletList(value) {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : [value];
  /** @type {string[]} */
  const out = [];
  for (const item of raw) {
    const text = typeof item === 'string'
      ? item
      : item && typeof item === 'object' && typeof item.text === 'string'
        ? item.text
        : String(item ?? '');
    for (const line of text.split(/\r?\n/)) {
      // Strip a real list marker only: `-`, `*`, `•`, or `1.` followed by space.
      // A line such as `**bold**` must keep both asterisks.
      const cleaned = line.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, '').trim();
      if (cleaned.length > 0) out.push(cleaned);
    }
  }
  return out;
}

function section(title, body) {
  return [`### ${title}`, '', body, ''].join('\n');
}

/**
 * Render a hot-comment list as `- **@user**（👍 123）：text` lines.
 * @param {unknown} comments
 * @returns {string[]}
 */
export function commentLines(comments) {
  if (!Array.isArray(comments)) return [];
  /** @type {string[]} */
  const out = [];
  for (const item of comments) {
    if (!item || typeof item !== 'object') continue;
    const user = String(item.user ?? '').trim() || '未知';
    const like = Number(item.like) || 0;
    const text = String(item.text ?? '').trim();
    if (!text) continue;
    out.push(`- **@${user}**（👍 ${like}）：${text}`);
  }
  return out;
}

/**
 * Render the final Markdown report.
 * @param {{ videos: Array<VideoResult & {
 *   coreSummary?: string,
 *   points?: string[],
 *   quotes?: string[],
 *   steps?: string[],
 * }>, failures: Failure[], generatedAt?: Date }} input
 * @returns {string}
 */
export function renderReport(input) {
  const { videos = [], failures = [] } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const { display } = timestamps(generatedAt);
  const okCount = videos.length;
  const failCount = failures.length;
  const total = okCount + failCount;

  const lines = [
    '# B站视频批量总结报告',
    `生成时间：${display}`,
    `视频总数：${total}个（成功解析：${okCount}个，失败：${failCount}个）`,
    '',
    '---',
    '',
  ];

  // The comment thread is video-wide: a multi-P video carries the same list on
  // every part's record, so render it only once, under the first part.
  const commentSeen = new Set();

  videos.forEach((video, index) => {
    const label = video.linkLabel || video.bvid;
    lines.push(`## ${index + 1}. ${video.title || '（无标题）'}`);
    lines.push(`- **链接**：[${label}](${video.url})`);
    lines.push(`- **UP主**：${video.up || '未知'}`);
    lines.push(`- **发布时间**：${video.pubdate || '未知'}`);
    if (video.subtitle) {
      const source = video.subtitle.kind === 'ai' ? 'AI 字幕' : 'CC 字幕';
      lines.push(`- **字幕**：${video.subtitle.lang || '未知语言'}（${source}，${video.subtitle.chars} 字）`);
    }
    lines.push('');
    lines.push(section('📌 核心总结', video.coreSummary?.trim() || '（模型未返回核心总结）'));

    const points = bulletList(video.points);
    lines.push(section('💡 详细观点', points.length > 0
      ? points.map((point) => `- ${point}`).join('\n')
      : '（模型未返回详细观点）'));

    const quotes = bulletList(video.quotes);
    lines.push(section('✨ 金句/高光时刻', quotes.length > 0
      ? quotes.map((quote) => `> “${quote.replace(/^["“]|["”]$/g, '')}”`).join('\n>\n')
      : '（无金句摘录）'));

    const comments = commentLines(video.comments);
    if (comments.length > 0 && !commentSeen.has(video.bvid)) {
      commentSeen.add(video.bvid);
      lines.push(section('🔥 热门评论（高赞）', comments.join('\n')));
    }

    const steps = bulletList(video.steps);
    if (steps.length > 0) {
      lines.push(section('🛠 核心步骤', steps.map((step, i) => `${i + 1}. ${step}`).join('\n')));
    }

    lines.push('---');
    lines.push('');
  });

  if (failCount > 0) {
    lines.push('## ❌ 解析失败列表');
    for (const failure of failures) {
      lines.push(`- 链接：${failure.link}`);
      lines.push(`- 原因：${failure.message || failure.reason || '未知错误'}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render one transcript file. The agent reads this before summarizing, so the
 * header keeps every fact the report needs without re-fetching metadata.
 * @param {VideoResult} video
 */
export function renderTranscript(video) {
  const meta = [
    `- BV号：${video.bvid}`,
    `- 标题：${video.title}`,
    `- UP主：${video.up}`,
    `- 发布时间：${video.pubdate}`,
    `- 时长：${formatDuration(video.duration)}`,
    `- 链接：${video.url}`,
  ];
  if (video.subtitle) {
    const source = video.subtitle.kind === 'ai' ? 'AI 字幕' : 'CC 字幕';
    meta.push(`- 字幕：${video.subtitle.lang || '未知语言'}（${source}，${video.subtitle.chars} 字）`);
  }
  const comments = commentLines(video.comments);
  if (comments.length > 0) {
    meta.push(`- 高赞评论：${comments.length} 条`);
  }
  const parts = [
    `# 字幕：${video.title}`,
    '',
    ...meta,
    '',
    '---',
    '',
    video.subtitle?.text ?? '（无字幕）',
    '',
  ];
  if (comments.length > 0) {
    parts.push('---', '', '## 🔥 热门评论（高赞）', '', ...comments, '');
  }
  return parts.join('\n');
}
