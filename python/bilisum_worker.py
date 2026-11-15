#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BiliSum worker.

Two modes, selected with ``--mode``:

* ``probe`` — resolve links and fetch metadata only. Multi-part videos report
  every part (page number, title, duration, cid) so the page can offer a real
  checkbox list instead of abstract P1/P2 numbers.
* ``fetch`` — fetch subtitles for the requested pages (or the whole video when
  no page list is given), one page at a time per video with a short pause
  between requests.

``bilibili-api-python`` owns WBI signing, cookie handling, and the subtitle
endpoint. One JSON object per line goes to stdout; the Node half of the plugin
turns those lines into UI logs, transcript folders, and the report.

Protocol (stdout, newline-delimited JSON):
  {"type": "log", "level": "info"|"processing"|"success"|"warning"|"error",
   "message": "..."}
  {"type": "probe", "data": {...}}
  {"type": "probe-summary", "data": {"total": n, "ok": n, "failed": n}}
  {"type": "video", "data": {...}}
  {"type": "failure", "data": {"link": "...", "reason": "CODE",
                               "message": "..."}}
  {"type": "summary", "data": {"total": n, "ok": n, "failed": n}}
  {"type": "fatal", "message": "..."}

Input: one JSON document on stdin:
  {"videos": [{"kind": "bvid"|"avid", "value": "...", "pages": [1, 3]}],
   "shorts": ["url", ...]}
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import sys
import traceback

BV_RE = re.compile(r"BV[0-9A-Za-z]{10}")
AV_RE = re.compile(r"(?<![0-9A-Za-z])[aA][vV](\d{1,12})(?![0-9A-Za-z])")
SHORT_RE = re.compile(r"^https?://(?:b23\.tv|bili2233\.cn)/")

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.bilibili.com/",
}
SUBTITLE_TIMEOUT = 25
SEMAPHORE_LIMIT = 3
RETRIES = 2
# B站 rate-limits bursts of subtitle reads; a pause between pages of one video
# keeps a long collection from tripping the 412 guard.
PAGE_SLEEP_SECONDS = 2.0
# Downloads run after the subtitle pass, one at a time, with the same courtesy.
DOWNLOAD_SLEEP_SECONDS = 2.0
# Codec preference: H.264 first for maximum compatibility, but never at the
# cost of resolution — if the requested height has no AVC stream (common at
# 4K/8K, where B站 serves HEVC/AV1 only), fall back to any codec at that height.
DOWNLOAD_PREFERRED_CODEC = "avc1"
DOWNLOAD_QUALITY_DEFAULT = "1080p"


def format_selector(max_height, codec=DOWNLOAD_PREFERRED_CODEC):
    """Resolution is a hard cap; the codec is only a preference."""
    cap = f"[height<={max_height}]"
    return (
        f"bestvideo{cap}[vcodec^={codec}]+bestaudio/"
        f"bestvideo{cap}+bestaudio/"
        f"best{cap}"
    )


# A format selector per quality; `audio` keeps only the audio stream (AAC first).
DOWNLOAD_QUALITY_FORMATS = {
    "4k": format_selector(2160),
    "1080p": format_selector(1080),
    "720p": format_selector(720),
    "480p": format_selector(480),
    "audio": "bestaudio[acodec^=mp4a]/bestaudio/best",
}
# Emit one progress line per this many percent, so the log stays readable.
PROGRESS_STEP = 10.0
# Long videos are still downloaded (the user asked), but the log says so.
LONG_VIDEO_SECONDS = 3 * 3600
# File extensions yt-dlp may produce, used to detect an already-taken name.
MEDIA_EXTENSIONS = (".mp4", ".m4a", ".mkv", ".webm", ".flv")
# A transient network blip should not cost a whole part: try once more.
DOWNLOAD_ATTEMPTS = 2


# --------------------------------------------------------------------------
# Protocol helpers
# --------------------------------------------------------------------------
def emit(payload):
    """Write one protocol line and flush, so the parent sees it immediately."""
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(level, message):
    emit({"type": "log", "level": level, "message": message})


def fail(link, reason, message):
    emit({"type": "failure", "data": {"link": link, "reason": reason, "message": message}})


def classify(exc):
    """Map a library exception to a stable code plus a user-facing sentence."""
    text = str(exc)
    code = getattr(exc, "code", None)
    try:
        code_int = int(code) if code is not None else None
    except (TypeError, ValueError):
        code_int = None

    if code_int == -412 or "412" in text or "请求被拦截" in text:
        return "FREQ_LIMIT", "B站风控返回 412（请求过于频繁），请稍后重试或配置 SESSDATA Cookie。"
    if code_int == -404:
        return "NOT_FOUND", "视频不存在、已删除或不可访问。"
    if code_int in (62002, 62004):
        return "NOT_AVAILABLE", "视频不可见（可能已下架、分区受限或需要登录）。"
    if code_int == -101 or "未登录" in text or "not login" in text.lower():
        return "LOGIN_REQUIRED", "需要登录态（SESSDATA）才能获取该视频的信息或字幕。"
    if "尚未安装第三方请求库" in text:
        return "MISSING_HTTP_LIB", "缺少 HTTP 请求库：请在插件使用的 Python 里执行 pip install aiohttp。"
    if "sessdata" in text.lower():
        return (
            "LOGIN_REQUIRED",
            "该视频的字幕需要登录态（SESSDATA）。请在「BiliSum」面板里粘贴 B站 Cookie 后重试。",
        )
    if code_int == -400:
        return "BAD_REQUEST", "B站接口拒绝了该请求（参数或签名错误）。"
    if "timed out" in text.lower() or "timeout" in text.lower():
        return "TIMEOUT", "请求 B站接口超时，已重试仍失败。"
    return "UNKNOWN", f"抓取失败：{text.strip()[:200] or type(exc).__name__}"


# --------------------------------------------------------------------------
# Short link resolution
# --------------------------------------------------------------------------
async def resolve_short(session, url):
    """Follow a b23.tv redirect chain and return a canonical VideoRef or None."""
    current = url
    for _ in range(5):
        try:
            async with session.get(
                current, allow_redirects=False, headers=REQUEST_HEADERS, timeout=15
            ) as response:
                location = response.headers.get("Location")
                if not location:
                    body = await response.text(errors="ignore")
                    return ref_from_text(body)
                if location.startswith("/"):
                    location = "https://b23.tv" + location
                current = location
        except Exception as exc:  # noqa: BLE001 - reported to the caller
            log("warning", f"短链解析失败 {url}：{exc}")
            return None
        ref = ref_from_text(current)
        if ref is not None:
            return ref
    return None


def ref_from_text(text):
    """Find the first BV/AV id inside a URL or redirect body."""
    if not text:
        return None
    match = BV_RE.search(text)
    if match:
        return {"kind": "bvid", "value": match.group(0)}
    match = AV_RE.search(text)
    if match:
        return {"kind": "avid", "value": match.group(1)}
    return None


# --------------------------------------------------------------------------
# Subtitle helpers
# --------------------------------------------------------------------------
LANGUAGE_PRIORITY = ["zh-CN", "zh-Hans", "zh-Hant", "ai-zh", "zh", "ai-en", "en-US", "en"]


def pick_subtitle(subtitles):
    """Choose the best subtitle track: Chinese first, CC before AI on a tie."""
    if not subtitles:
        return None

    def score(item):
        lang = str(item.get("lan") or "")
        ai = 1 if is_ai(item) else 0
        try:
            rank = LANGUAGE_PRIORITY.index(lang)
        except ValueError:
            rank = len(LANGUAGE_PRIORITY)
        return (ai, rank)

    return sorted(subtitles, key=score)[0]


def is_ai(item):
    """AI tracks carry ai_type >= 1, or an `ai-` language prefix."""
    lang = str(item.get("lan") or "")
    if lang.startswith("ai-"):
        return True
    try:
        return int(item.get("ai_type") or 0) >= 1
    except (TypeError, ValueError):
        return False


def body_to_text(body):
    """Flatten subtitle segments into paragraphs, dropping repeated AI lines."""
    lines = []
    for segment in body or []:
        if not isinstance(segment, dict):
            continue
        content = str(segment.get("content") or "").strip()
        if not content:
            continue
        if lines and lines[-1] == content:
            continue
        lines.append(content)
    return "\n".join(lines)


async def download_subtitle(session, url):
    """Fetch one subtitle JSON document and return its plain text."""
    if url.startswith("//"):
        url = "https:" + url
    async with session.get(url, headers=REQUEST_HEADERS, timeout=SUBTITLE_TIMEOUT) as response:
        payload = await response.json(content_type=None)
    return body_to_text(payload.get("body") if isinstance(payload, dict) else None)


# --------------------------------------------------------------------------
# Video downloads (yt-dlp + ffmpeg)
# --------------------------------------------------------------------------
def resolve_ffmpeg():
    """Locate an ffmpeg binary: env override, PATH, then the bundled wheel."""
    override = os.environ.get("BILISUM_FFMPEG", "").strip()
    if override and os.path.isfile(override):
        return override
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        # `imageio-ffmpeg` ships a static build inside the interpreter's env,
        # so the plugin works without touching the system PATH.
        import imageio_ffmpeg

        candidate = imageio_ffmpeg.get_ffmpeg_exe()
        if candidate and os.path.isfile(candidate):
            return candidate
    except Exception:  # noqa: BLE001 - optional dependency
        pass
    return None


def ytdlp_version():
    """Installed yt-dlp version, or None when the package is missing."""
    try:
        import yt_dlp

        return getattr(yt_dlp.version, "__version__", "ok")
    except Exception:  # noqa: BLE001
        return None


def human_bytes(value):
    """Bytes to a short human string."""
    size = float(value or 0)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if size < 1024 or unit == "TiB":
            return f"{int(size)} B" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TiB"


BRACKET_PAIRS = [("【", "】"), ("《", "》"), ("（", "）"), ("(", ")"), ("[", "]"), ("「", "」")]


def trim_unbalanced(value):
    """Drop a trailing fragment that would leave a bracket unbalanced."""
    text = value
    for open_char, close_char in BRACKET_PAIRS:
        depth = 0
        last_open = -1
        for index, char in enumerate(text):
            if char == open_char:
                depth += 1
                last_open = index
            elif char == close_char and depth > 0:
                depth -= 1
        if depth > 0 and last_open >= 0:
            text = text[:last_open]
    return text.strip().rstrip(". ")


def trimmed_slice(value, limit):
    """Slice at a space when that keeps most of the budget, else hard-cut."""
    if len(value) <= limit:
        return value.strip()
    hard = value[:limit]
    cut = hard.rfind(" ")
    if cut > int(limit * 0.6):
        hard = hard[:cut]
    return hard.strip()


def safe_stem(title, limit=56):
    """Windows-safe folder/file stem, matching the transcript naming rule.

    The limit keeps `<base>/<collection>/<part>/<part>.<ext>` inside the Windows
    path budget, where the base already spends most of the 260 characters.
    """
    cleaned = re.sub(r'[\x00-\x1f\x7f<>:"/\\|?*]', " ", str(title or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip().rstrip(". ")
    stem = trimmed_slice(cleaned, limit)
    if stem:
        stem = trim_unbalanced(stem)
    return stem or "未命名视频"


def folder_name(video, fallback_stamp):
    """`视频名_年月日_时分秒`, using the video's own publish instant."""
    from datetime import datetime

    stamp = ""
    try:
        published = int(video.get("pubdateTs") or 0)
        if published > 0:
            stamp = datetime.fromtimestamp(published).strftime("%Y%m%d_%H%M%S")
    except (TypeError, ValueError, OSError):
        stamp = ""
    return f"{safe_stem(video.get('title'))}_{stamp or fallback_stamp}"


def codec_label(value):
    """Human label for a yt-dlp codec id."""
    text = str(value or "")
    if text.startswith(("avc1", "h264")):
        return "H.264"
    if text.startswith(("hev1", "hvc1", "hevc", "h265")):
        return "HEVC"
    if text.startswith("av01"):
        return "AV1"
    return text or "未知"


def download_one(video, out_dir, stem, quality, cookie, ffmpeg):
    """Download one video/part into `out_dir` as `<stem>.<ext>`.

    Returns (path, bytes, codec label).
    """
    import yt_dlp

    selector = DOWNLOAD_QUALITY_FORMATS.get(quality) or DOWNLOAD_QUALITY_FORMATS[DOWNLOAD_QUALITY_DEFAULT]
    audio_only = quality == "audio"
    merging = "+" in selector
    template = os.path.join(out_dir, stem + ".%(ext)s")

    state = {"step": -1, "vcodec": ""}

    def progress_hook(data):
        status = data.get("status")
        if status == "downloading":
            info_dict = data.get("info_dict") or {}
            codec = str(info_dict.get("vcodec") or "")
            if codec and codec != "none":
                state["vcodec"] = codec
            total = data.get("total_bytes") or data.get("total_bytes_estimate") or 0
            done = data.get("downloaded_bytes") or 0
            percent = round(done / total * 100, 1) if total else 0.0
            step = int(percent // PROGRESS_STEP)
            if step != state["step"]:
                state["step"] = step
                speed = str(data.get("_speed_str") or "").strip()
                eta = str(data.get("_eta_str") or "").strip()
                # A merged download reports progress twice (video, then audio);
                # naming the stream keeps the log understandable.
                stream = ""
                if merging:
                    info_dict = data.get("info_dict") or {}
                    stream = "音频 " if info_dict.get("vcodec") == "none" else "视频 "
                log(
                    "processing",
                    f"下载中【{video.get('title')}】{stream}{percent:.0f}%  {speed}  ETA {eta}".rstrip(),
                )

    options = {
        "format": selector,
        "merge_output_format": "m4a" if audio_only else "mp4",
        "outtmpl": template,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [progress_hook],
        "http_headers": dict(REQUEST_HEADERS),
    }
    if ffmpeg:
        options["ffmpeg_location"] = ffmpeg
    if cookie:
        # Inject the cookie instead of writing a cookiefile to disk.
        options["http_headers"]["Cookie"] = f"SESSDATA={cookie}"

    existing = set(os.listdir(out_dir)) if os.path.isdir(out_dir) else set()
    with yt_dlp.YoutubeDL(options) as ydl:
        ydl.download([video["url"]])

    # The progress hook fires once per stream, so its `filename` is the last
    # fragment, not the merged result. Pick the finished artifact instead.
    produced = []
    for name in os.listdir(out_dir):
        if name in existing:
            continue
        if name.endswith((".part", ".ytdl")) or name.endswith(".temp"):
            continue
        if not name.lower().endswith(MEDIA_EXTENSIONS):
            continue
        full = os.path.join(out_dir, name)
        try:
            produced.append((os.path.getsize(full), full))
        except OSError:
            continue
    if not produced:
        return None, 0, ""
    size, path = max(produced)
    return path, size, codec_label(state["vcodec"])


def cleanup_partials(directory):
    """Remove interrupted-download leftovers so a retry starts clean."""
    try:
        names = os.listdir(directory)
    except OSError:
        return
    for name in names:
        if name.endswith((".part", ".ytdl", ".temp")):
            try:
                os.remove(os.path.join(directory, name))
            except OSError:
                pass


async def run_downloads(targets, base_dir, stamp, quality, cookie):
    """Serial downloads after the subtitle pass; never raises for one item."""
    if not targets:
        return
    version = ytdlp_version()
    ffmpeg = resolve_ffmpeg()
    if not version or not ffmpeg:
        missing = []
        if not version:
            missing.append("yt-dlp（pip install yt-dlp）")
        if not ffmpeg:
            missing.append("ffmpeg（pip install imageio-ffmpeg，或把 ffmpeg 加入 PATH）")
        log("error", "跳过下载：" + "、".join(missing))
        return

    try:
        os.makedirs(base_dir, exist_ok=True)
    except OSError as exc:
        log("error", f"无法创建下载目录 {base_dir}：{exc}")
        return

    try:
        free = shutil.disk_usage(base_dir).free
    except OSError:
        # A restricted folder can refuse the stat call; that is not fatal.
        free = None
    if free is not None and free < 300 * 1024 * 1024:
        log("warning", f"磁盘剩余空间仅 {human_bytes(free)}，下载可能失败。")

    log("processing", f"开始下载 {len(targets)} 个视频（清晰度 {quality}，串行，间隔 {DOWNLOAD_SLEEP_SECONDS:.0f} 秒）…")
    for index, video in enumerate(targets):
        if index > 0 and DOWNLOAD_SLEEP_SECONDS > 0:
            await asyncio.sleep(DOWNLOAD_SLEEP_SECONDS)
        title = video.get("title") or video.get("bvid")
        label = f"【{title}】"
        duration = int(video.get("duration") or 0)
        if duration > LONG_VIDEO_SECONDS:
            log("warning", f"{label}时长较长（约 {duration // 3600} 小时），文件可能很大。")

        # Mirror the transcript tree: a collection folder holds the part files
        # directly, while a standalone video keeps its own same-named folder.
        # Every video/part gets one top-level folder holding `subtitles/` and
        # `videos/`; a collection groups its parts under the series title.
        folder = folder_name(video, stamp)
        if int(video.get("pageCount") or 1) > 1:
            group = safe_stem(video.get("seriesTitle") or title, limit=48)
        else:
            group = folder
        item_dir = os.path.join(base_dir, group, "videos")
        stem = folder
        attempt = 2
        while any(os.path.exists(os.path.join(item_dir, f"{stem}{ext}")) for ext in MEDIA_EXTENSIONS):
            stem = f"{folder}_{attempt}"
            attempt += 1
        key = (f"{video.get('bvid')}#p{video.get('page')}"
               if int(video.get("pageCount") or 1) > 1 else str(video.get("bvid")))
        plan = {
            "key": key,
            "bvid": video.get("bvid"),
            "page": video.get("page"),
            "pageCount": video.get("pageCount"),
            "title": title,
            "url": video.get("url"),
            "duration": duration,
            "pubdateTs": video.get("pubdateTs"),
            "seriesTitle": video.get("seriesTitle"),
            "quality": quality,
            "dir": item_dir,
        }

        try:
            os.makedirs(item_dir, exist_ok=True)
        except OSError as exc:
            emit({"type": "download-failed", "data": {**plan, "message": f"无法创建目录：{exc}"}})
            log("warning", f"无法创建目录 {item_dir}：{exc}")
            continue

        emit({"type": "download-start", "data": dict(plan)})
        path = size = codec = None
        error = ""
        for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
            try:
                path, size, codec = await asyncio.to_thread(
                    download_one, video, item_dir, stem, quality, cookie, ffmpeg,
                )
                error = "" if path and size else "没有产出文件"
            except Exception as exc:  # noqa: BLE001 - one item must not stop the batch
                path, size, codec, error = None, 0, "", str(exc)
            if path and size and os.path.isfile(path):
                break
            if attempt < DOWNLOAD_ATTEMPTS:
                log("warning", f"下载失败{label}（第 {attempt} 次）：{error}，3 秒后自动重试…")
                cleanup_partials(item_dir)
                await asyncio.sleep(3)
        if not path or not size or not os.path.isfile(path):
            # Drop the empty per-item folders so a manual retry reuses the name.
            try:
                if os.path.isdir(item_dir) and not os.listdir(item_dir):
                    os.rmdir(item_dir)
                    parent = os.path.dirname(item_dir)
                    if os.path.isdir(parent) and not os.listdir(parent):
                        os.rmdir(parent)
            except OSError:
                pass
            emit({"type": "download-failed", "data": {**plan, "message": error or "下载失败"}})
            log("warning", f"下载失败{label}：{error or '未知错误'}")
            continue
        emit({
            "type": "download-done",
            "data": {
                **plan,
                "path": path,
                "bytes": size,
                "vcodec": codec,
            },
        })
        log("success", f"已下载{label} → {path}（{human_bytes(size)}，{codec or '未知编码'}）")


def format_pubdate(value):
    """Unix seconds to `YYYY-MM-DD` in the local time zone."""
    if not value:
        return "未知"
    try:
        from datetime import datetime

        return datetime.fromtimestamp(int(value)).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OSError):
        return "未知"


def format_duration(seconds):
    """Seconds to `1:02:03` / `12:30` for the selection list."""
    try:
        total = int(seconds or 0)
    except (TypeError, ValueError):
        return ""
    if total <= 0:
        return ""
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


# --------------------------------------------------------------------------
# Video access
# --------------------------------------------------------------------------
class Fetcher:
    def __init__(self, credential, login_ok=None):
        from bilibili_api import video  # imported here so import errors are fatal, not per-video

        self._video_module = video
        self._credential = credential
        self.login_ok = login_ok

    def target(self, ref):
        """Build the library handle plus the link label for one reference."""
        kwargs = {"credential": self._credential}
        if ref["kind"] == "avid":
            return self._video_module.Video(aid=int(ref["value"]), **kwargs), f"av{ref['value']}"
        return self._video_module.Video(bvid=ref["value"], **kwargs), ref["value"]

    async def info(self, ref):
        """Fetch raw metadata once per video."""
        target, link = self.target(ref)
        raw = await self._with_retry(target.get_info)
        return target, link, raw

    def describe(self, link, info):
        """Normalize metadata, including every part of a multi-P video."""
        bvid = str(info.get("bvid") or link)
        pages = []
        for index, page in enumerate(info.get("pages") or []):
            pages.append({
                "page": int(page.get("page") or index + 1),
                "cid": page.get("cid"),
                "part": str(page.get("part") or ""),
                "duration": page.get("duration"),
            })
        if not pages:
            pages.append({"page": 1, "cid": info.get("cid"), "part": "", "duration": info.get("duration")})

        season = info.get("ugc_season") or {}
        multi = len(pages) > 1
        return {
            "bvid": bvid,
            "aid": info.get("aid"),
            "title": str(info.get("title") or "（无标题）"),
            "up": str((info.get("owner") or {}).get("name") or "未知"),
            "pubdate": format_pubdate(info.get("pubdate")),
            "pubdateTs": int(info.get("pubdate") or 0),
            "duration": info.get("duration"),
            "url": f"https://www.bilibili.com/video/{bvid}",
            "multi": multi,
            "seriesTitle": str(season.get("title") or info.get("title") or ""),
            "pages": pages,
        }

    def describe_page(self, meta, page):
        """Build the per-part result record, before any subtitle request."""
        selection = page["page"]
        multi = meta["multi"]
        title = page["part"] if multi and page["part"] else meta["title"]
        return {
            "key": f"{meta['bvid']}#p{selection}" if multi else meta["bvid"],
            "bvid": meta["bvid"],
            "aid": meta["aid"],
            "page": selection,
            "pageCount": len(meta["pages"]),
            "title": title,
            "videoTitle": meta["title"],
            "seriesTitle": meta.get("seriesTitle") or meta["title"],
            "up": meta["up"],
            "pubdate": meta["pubdate"],
            "pubdateTs": meta["pubdateTs"],
            "url": f"{meta['url']}?p={selection}" if multi else meta["url"],
            "duration": page.get("duration") or meta["duration"],
            "subtitle": None,
        }

    async def page_result(self, target, meta, page):
        """Fetch one part's subtitle; returns (result, code, message)."""
        selection = page["page"]
        result = self.describe_page(meta, page)
        multi = meta["multi"]
        title = result["title"]

        cid = page.get("cid")
        if not cid:
            return result, "NO_SUBTITLE", "该视频无任何字幕（CC 或 AI），无法总结。"

        label = f"P{selection} · {title}" if multi else title
        log("processing", f"正在获取【{label}】的字幕…")
        try:
            subtitle_data = await self._with_retry(target.get_subtitle, cid)
        except Exception as exc:  # noqa: BLE001
            code, message = classify(exc)
            log("warning", f"【{label}】字幕接口异常：{message}")
            return result, code, message

        subtitles = []
        if isinstance(subtitle_data, dict):
            subtitles = subtitle_data.get("subtitles") or []
        chosen = pick_subtitle(subtitles)
        if chosen is None:
            if self.login_ok is False:
                return (
                    result,
                    "LOGIN_REQUIRED",
                    "Cookie 已失效：B站 返回未登录，请重新登录后把新的 SESSDATA 存进 BiliSum。",
                )
            if self.login_ok is True:
                return (
                    result,
                    "NO_SUBTITLE",
                    "该视频确实没有 CC / AI 字幕轨道（B站 接口返回空），无法总结。",
                )
            hint = "" if os.environ.get("BILISUM_SESSDATA", "").strip() else "（当前未配置 SESSDATA）"
            return (
                result,
                "NO_SUBTITLE",
                f"该视频没有返回任何字幕轨道（CC 或 AI）{hint}；"
                "若确认该视频本身有字幕，多半是 Cookie 失效或未登录。",
            )

        url = chosen.get("subtitle_url") or ""
        if not url:
            return result, "NO_SUBTITLE", "该视频的字幕地址为空（可能需要 SESSDATA 登录态）。"

        async with aiohttp_session() as session:
            text = await self._with_retry(download_subtitle, session, url)

        if not text.strip():
            return result, "EMPTY_SUBTITLE", "字幕内容为空（可能需要 SESSDATA 登录态）。"

        result["subtitle"] = {
            "kind": "ai" if is_ai(chosen) else "cc",
            "langCode": str(chosen.get("lan") or ""),
            "lang": str(chosen.get("lan_doc") or chosen.get("lan") or "未知语言"),
            "text": text,
            "chars": len(text),
        }
        return result, None, None

    async def _with_retry(self, fn, *args):
        """Run one library call with a small exponential backoff."""
        last = None
        for attempt in range(RETRIES + 1):
            try:
                return await fn(*args)
            except Exception as exc:  # noqa: BLE001 - retried then classified
                last = exc
                if attempt < RETRIES:
                    await asyncio.sleep(1.0 + attempt * 1.5)
        raise last


# --------------------------------------------------------------------------
# Session
# --------------------------------------------------------------------------
def aiohttp_session():
    """Build an aiohttp session with sane limits; imported lazily."""
    import aiohttp

    return aiohttp.ClientSession(
        headers=REQUEST_HEADERS,
        timeout=aiohttp.ClientTimeout(total=SUBTITLE_TIMEOUT),
        connector=aiohttp.TCPConnector(limit=SEMAPHORE_LIMIT + 2),
    )


async def check_login(session, sessdata):
    """Ask B站 whether this SESSDATA is a logged-in session.

    Returns True/False, or None when the check itself could not complete, so a
    missing subtitle can be reported as "no subtitles" or "cookie expired"
    instead of a guess.
    """
    try:
        async with session.get(
            "https://api.bilibili.com/x/web-interface/nav",
            cookies={"SESSDATA": sessdata},
            timeout=15,
        ) as response:
            payload = await response.json(content_type=None)
    except Exception as exc:  # noqa: BLE001 - the check is advisory
        log("warning", f"Cookie 校验请求失败：{exc}")
        return None
    if payload.get("code") == -101:
        # B站 answers -101 "账号未登录" for a session it no longer accepts.
        return False
    if payload.get("code") != 0:
        return None
    return bool((payload.get("data") or {}).get("isLogin"))


async def prepare(payload):
    """Shared preamble: credential, login check, and resolved references."""
    from bilibili_api import Credential

    sessdata = os.environ.get("BILISUM_SESSDATA", "").strip()
    credential = Credential(sessdata=sessdata) if sessdata else Credential()
    login_ok = None
    if not sessdata:
        log("warning", "未配置 SESSDATA，只能访问公开视频，AI 字幕可能拿不到。")
    else:
        async with aiohttp_session() as session:
            login_ok = await check_login(session, sessdata)
        if login_ok is True:
            log("info", "Cookie 校验通过：B站 已登录。")
        elif login_ok is False:
            log("warning", "Cookie 校验失败：B站 返回未登录，请重新获取 SESSDATA 后保存。")
        else:
            log("warning", "Cookie 校验请求未成功，继续尝试抓取。")

    videos = [ref for ref in (payload.get("videos") or []) if ref.get("value")]
    shorts = [url for url in (payload.get("shorts") or []) if url]
    unresolved_shorts = 0

    if shorts:
        log("processing", f"正在解析 {len(shorts)} 个短链…")
        async with aiohttp_session() as session:
            resolved = await asyncio.gather(*(resolve_short(session, url) for url in shorts))
        for url, ref in zip(shorts, resolved):
            if ref is None:
                unresolved_shorts += 1
                fail(
                    url,
                    "SHORT_LINK_FAILED",
                    "短链解析失败：跳转结果里没有可识别的 BV/AV 号（短链可能已失效）。",
                )
                continue
            videos.append(ref)

    return credential, login_ok, videos, unresolved_shorts


# --------------------------------------------------------------------------
# Modes
# --------------------------------------------------------------------------
async def run_probe(payload):
    """Metadata only: report every part so the UI can offer a checkbox list."""
    credential, login_ok, videos, unresolved_shorts = await prepare(payload)
    if not videos:
        emit({"type": "probe-summary", "data": {"total": unresolved_shorts, "ok": 0, "failed": unresolved_shorts}})
        return

    fetcher = Fetcher(credential, login_ok=login_ok)
    log("processing", f"正在解析 {len(videos)} 个视频的信息…")
    counters = {"ok": 0, "failed": 0}

    for ref in videos:
        link = ref["value"] if ref.get("kind") == "bvid" else f"av{ref.get('value')}"
        try:
            _, _, info = await fetcher.info(ref)
        except Exception as exc:  # noqa: BLE001 - one video must not stop the batch
            code, message = classify(exc)
            fail(link, code, message)
            counters["failed"] += 1
            continue
        meta = fetcher.describe(link, info)
        # The part the pasted link itself pointed at, so the selection list can
        # default to that one instead of every part.
        meta["defaultPage"] = int(ref.get("page") or 1)
        emit({"type": "probe", "data": meta})
        counters["ok"] += 1

    emit({
        "type": "probe-summary",
        "data": {"total": len(videos) + unresolved_shorts, "ok": counters["ok"], "failed": counters["failed"] + unresolved_shorts},
    })


async def run_fetch(payload):
    """Subtitles for the requested pages, one page at a time per video."""
    credential, login_ok, videos, unresolved_shorts = await prepare(payload)
    if not videos:
        emit({
            "type": "summary",
            "data": {"total": unresolved_shorts, "ok": 0, "failed": unresolved_shorts},
        })
        return

    fetcher = Fetcher(credential, login_ok=login_ok)
    log("processing", f"正在获取 {len(videos)} 个视频的字幕…")
    semaphore = asyncio.Semaphore(SEMAPHORE_LIMIT)
    counters = {"ok": 0, "failed": 0}

    download_cfg = payload.get("download") or {}
    download_dir = str(download_cfg.get("dir") or "").strip()
    # The Host always resolves the absolute output root; never guess one here.
    if download_dir:
        download_dir = os.path.abspath(download_dir)
    download_stamp = str(download_cfg.get("stamp") or "").strip() or "00000000_000000"
    quality = str(download_cfg.get("quality") or DOWNLOAD_QUALITY_DEFAULT).strip()
    if quality not in DOWNLOAD_QUALITY_FORMATS:
        quality = DOWNLOAD_QUALITY_DEFAULT
    # Subtitles and downloads are independent tasks: either may be off.
    subtitles_enabled = payload.get("subtitles", True) is not False
    if not subtitles_enabled and not download_dir:
        log("warning", "既没有勾选字幕提取，也没有开启下载，本次不做任何事。")
        emit({"type": "summary", "data": {"total": 0, "ok": 0, "failed": 0}})
        return
    if not subtitles_enabled:
        log("info", "已关闭字幕提取，本次只下载视频。")
    # Collected while subtitles run, executed afterwards: downloads must not
    # delay the text work, and two B站 request streams invite 412.
    download_targets = []

    async def one(ref):
        link = ref["value"] if ref.get("kind") == "bvid" else f"av{ref.get('value')}"
        async with semaphore:
            try:
                target, _, info = await fetcher.info(ref)
            except Exception as exc:  # noqa: BLE001 - one video must not stop the batch
                code, message = classify(exc)
                fail(link, code, message)
                counters["failed"] += 1
                return

            meta = fetcher.describe(link, info)
            available = {page["page"]: page for page in meta["pages"]}
            requested = ref.get("pages")
            if not requested:
                # The part named by the pasted link, else the first part.
                # Whole-collection fetches belong to the page, where the user
                # ticks exactly the parts they want.
                requested = [int(ref.get("page") or meta["pages"][0]["page"])]
            selected = [int(number) for number in requested if int(number) in available]
            if not selected:
                fail(meta["bvid"], "NO_PAGE", "没有匹配到要抓取的分P。")
                counters["failed"] += 1
                return

            for index, number in enumerate(selected):
                page = available[number]
                if download_dir:
                    planned = fetcher.describe_page(meta, page)
                    download_targets.append({
                        "bvid": planned["bvid"],
                        "page": planned["page"],
                        "pageCount": planned["pageCount"],
                        "title": planned["title"],
                        "seriesTitle": planned["seriesTitle"],
                        "url": planned["url"],
                        "duration": planned["duration"],
                        "pubdateTs": planned["pubdateTs"],
                    })
                if not subtitles_enabled:
                    continue
                if index > 0 and PAGE_SLEEP_SECONDS > 0:
                    await asyncio.sleep(PAGE_SLEEP_SECONDS)
                try:
                    result, code, message = await fetcher.page_result(target, meta, page)
                except Exception as exc:  # noqa: BLE001
                    code, message = classify(exc)
                    fail(f"{meta['bvid']}#p{number}", code, message)
                    counters["failed"] += 1
                    continue
                if code is None:
                    subtitle = result["subtitle"]
                    source = "AI 字幕" if subtitle["kind"] == "ai" else "CC 字幕"
                    log(
                        "success",
                        f"成功获取【{result['title']}】的字幕（{source}），长度：{subtitle['chars']} 字符。",
                    )
                    emit({"type": "video", "data": result})
                    counters["ok"] += 1
                else:
                    log("warning", f"【{result['title']}】跳过：{message}")
                    fail(result["key"], code, message)
                    counters["failed"] += 1

    await asyncio.gather(*(one(ref) for ref in videos))

    emit({
        "type": "summary",
        "data": {
            "total": len(videos) + unresolved_shorts,
            "ok": counters["ok"],
            "failed": counters["failed"] + unresolved_shorts,
        },
    })

    if download_dir:
        try:
            await run_downloads(
                download_targets,
                download_dir,
                download_stamp,
                quality,
                os.environ.get("BILISUM_SESSDATA", "").strip(),
            )
        except Exception as exc:  # noqa: BLE001 - never fail the whole batch here
            log("error", f"下载阶段异常中止：{exc}")


async def run_check(payload):
    """Report whether the download dependencies are usable."""
    emit({
        "type": "check",
        "data": {
            "ytdlp": ytdlp_version(),
            "ffmpeg": resolve_ffmpeg(),
            "qualities": list(DOWNLOAD_QUALITY_FORMATS.keys()),
        },
    })


def main():
    parser = argparse.ArgumentParser(description="BiliSum Bilibili worker")
    parser.add_argument("--mode", choices=["probe", "fetch", "check"], default="fetch")
    parser.add_argument("--version", action="store_true", help="print the worker protocol version")
    args = parser.parse_args()

    if args.version:
        emit({"type": "worker", "version": 2})
        return 0

    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except Exception as exc:  # noqa: BLE001
        emit({"type": "fatal", "message": f"无法读取输入：{exc}"})
        return 2

    try:
        if args.mode == "probe":
            asyncio.run(run_probe(payload))
        elif args.mode == "check":
            asyncio.run(run_check(payload))
        else:
            asyncio.run(run_fetch(payload))
    except ImportError as exc:
        emit({
            "type": "fatal",
            "message": (
                "未安装 bilibili-api-python。请运行：pip install bilibili-api-python "
                f"（{exc}）"
            ),
        })
        return 3
    except Exception as exc:  # noqa: BLE001 - top-level guard
        emit({"type": "fatal", "message": f"{exc}\n{traceback.format_exc(limit=4)}"})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
