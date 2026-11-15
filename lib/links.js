/**
 * BiliSum link extraction: pulls every BV/AV identifier and every b23.tv short
 * link out of arbitrary pasted text, then de-duplicates them in first-seen order.
 *
 * The module is pure: no I/O, no network. Short links are returned unresolved so
 * the Python worker can follow their redirects with a real HTTP client.
 */

/** A canonical BV id: `BV` plus ten base58 characters. */
const BV_PATTERN = /BV[0-9A-Za-z]{10}/g;
/** A canonical AV id, guarded so `bv1av2` style noise does not match. */
const AV_PATTERN = /(?<![0-9A-Za-z])[aA][vV](\d{1,12})(?![0-9A-Za-z])/g;
/** A b23.tv / bili2233.cn share-code URL, including the optional query. */
const SHORT_PATTERN = /https?:\/\/(?:b23\.tv|bili2233\.cn)\/[0-9A-Za-z]+(?:\?[^\s\u4e00-\u9fff"'<>]*)?/g;
/** A bangumi / movie page: `bangumi/play/ss<season>` or `bangumi/play/ep<episode>`. */
const BANGUMI_PATTERN = /https?:\/\/(?:www\.|m\.)?bilibili\.com\/bangumi\/play\/(ss|ep)(\d+)/g;

/**
 * @typedef {{ kind: 'bvid' | 'avid' | 'bangumi', value: string, url: string,
 *   page: number | null }} VideoRef
 * @typedef {{ raw: string }} ShortRef
 * @typedef {{ videos: VideoRef[], shorts: ShortRef[] }} ParsedLinks
 */

/** Any absolute URL, used only to read the `?p=` part of a video link. */
const URL_PATTERN = /https?:\/\/[^\s"'<>()（）【】，。；、]+/g;

/**
 * Read the part number a Bilibili video URL points at.
 * @param {string} url
 * @returns {number | null}
 */
function pageFromUrl(url) {
  const match = /[?&]p=(\d+)/.exec(url);
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isFinite(page) && page > 0 ? page : null;
}

/**
 * Extract video references from free-form text.
 * @param {string} text User input, possibly a whole share message.
 * @returns {ParsedLinks}
 */
export function parseLinks(text) {
  const source = typeof text === 'string' ? text : '';
  /** @type {VideoRef[]} */
  const videos = [];
  /** @type {ShortRef[]} */
  const shorts = [];
  const seenVideos = new Set();
  const seenShorts = new Set();

  // A pasted URL may point at a specific part; remember which one so the
  // selection list can default to that part instead of every part.
  /** @type {Map<string, number>} */
  const urlPages = new Map();
  for (const match of source.matchAll(URL_PATTERN)) {
    const url = match[0];
    const page = pageFromUrl(url);
    if (page === null) continue;
    const bv = /BV[0-9A-Za-z]{10}/.exec(url);
    if (bv) urlPages.set(bv[0], page);
    const av = /\/video\/av(\d{1,12})/i.exec(url);
    if (av) urlPages.set(`av${av[1]}`, page);
  }

  for (const match of source.matchAll(BV_PATTERN)) {
    const bvid = match[0];
    if (seenVideos.has(bvid)) continue;
    seenVideos.add(bvid);
    videos.push({
      kind: 'bvid',
      value: bvid,
      url: `https://www.bilibili.com/video/${bvid}`,
      page: urlPages.get(bvid) ?? null,
    });
  }

  for (const match of source.matchAll(AV_PATTERN)) {
    const avid = match[1];
    if (seenVideos.has(`av${avid}`)) continue;
    seenVideos.add(`av${avid}`);
    videos.push({
      kind: 'avid',
      value: avid,
      url: `https://www.bilibili.com/video/av${avid}`,
      page: urlPages.get(`av${avid}`) ?? null,
    });
  }

  for (const match of source.matchAll(SHORT_PATTERN)) {
    const raw = match[0];
    if (seenShorts.has(raw)) continue;
    seenShorts.add(raw);
    shorts.push({ raw });
  }

  // Bangumi / movie pages: the URL carries no BV id, so keep the season or
  // episode marker and let the pipeline resolve it to a video id.
  for (const match of source.matchAll(BANGUMI_PATTERN)) {
    const key = `${match[1]}${match[2]}`;
    if (seenVideos.has(key)) continue;
    seenVideos.add(key);
    videos.push({ kind: 'bangumi', value: key, url: match[0], page: null });
  }

  return { videos, shorts };
}

/**
 * Merge worker-resolved short links into the canonical list, preserving order
 * and dropping duplicates that resolve to an id already present.
 * @param {ParsedLinks} parsed
 * @param {Iterable<VideoRef>} resolved
 * @returns {VideoRef[]}
 */
export function mergeResolved(parsed, resolved) {
  /** @type {VideoRef[]} */
  const merged = [];
  const seen = new Set();
  for (const ref of [...parsed.videos, ...resolved]) {
    const key = ref.kind === 'avid' ? `av${ref.value}` : ref.value;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ref);
  }
  return merged;
}

/** Human-readable identity for logs and the failure list. */
export function describeRef(ref) {
  return ref.kind === 'avid' ? `av${ref.value}` : ref.value;
}
