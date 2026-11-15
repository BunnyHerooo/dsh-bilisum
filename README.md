# dsh-bilisum

A DeepSeek Harness (DSH) plugin that turns Bilibili videos into readable Markdown:
paste links or pick videos from the built-in Bilibili list, fetch subtitles (and
optionally the video itself), then let the agent summarize everything into one
report.

## Features

- **Two ways to pick videos** — paste any text containing `BV…` / `b23.tv`
  links, or search Bilibili and add results from the built-in list.
- **Subtitles** — CC and AI subtitles, saved as Markdown transcripts.
- **Multi-part videos** — real part titles in the picker; only the parts you tick
  are fetched. A link with `?p=5` preselects P5.
- **Optional video download** — yt-dlp with a codec preference (H.264 first) and
  audio-only mode; per-item status with one-click retry for failures.
- **Agent tools** — `bilisum_fetch` and `bilisum_write_report` let the chat model
  fetch and summarize without touching the panel.
- **Portable state** — the Python environment and the default output live in
  `~/.dsh/bilisum`, never inside the package.

## Install

**一键安装**：在 DSH 的「添加插件」弹窗中，直接粘贴 GitHub 地址
`https://github.com/BunnyHerooo/dsh-bilisum` 并点击「安装」即可。

其他方式：

```bash
# 命令行安装
dsh plugin --profile <profile> add github:BunnyHerooo/dsh-bilisum

# 锁定版本
dsh plugin --profile <profile> add github:BunnyHerooo/dsh-bilisum#v1.0.0
```

本地开发版：**Plugins → Add plugin** 指向本地目录，或用 `plugin_manager` 传入
绝对路径（链接安装，改动实时生效）。

On first activation the plugin checks its Python environment and, if missing,
builds it in the background:

```text
~/.dsh/bilisum/venv        managed virtualenv (bilibili-api-python, yt-dlp, ffmpeg)
~/.dsh/bilisum/bilibili_summaries   default output
```

Set `BILISUM_HOME` to relocate both, or override the interpreter with the
`pythonPath` config field.

> `prepare` only reports readiness; it never downloads anything during install.
> The environment itself is built from `apply()` on first use, in the background
> and without a console window. If your package manager blocks the script, the
> plugin still heals on first load.

## Usage

1. Open **BiliSum** in the sidebar.
2. Save your Bilibili `SESSDATA` (needed for AI subtitles; without it public
   videos still work).
3. Either paste links and press **开始解析**, or open **搜索视频**, add videos, and
   press **开始抓取**.
4. Ask the agent to “总结这些视频”; it reads the transcripts and writes
   `B站总结_YYYYMMDD_HHMMSS.md`.

### Output layout

```text
<output>/
  B站总结_YYYYMMDD_HHMMSS.md
  bili_task.log
  <series or video name>/
    subtitles/<part>_<timestamp>.md
    videos/<part>_<timestamp>.mp4
```

## Configuration

| Option | Meaning |
|---|---|
| `outputDir` | Output directory; empty means `~/.dsh/bilisum/bilibili_summaries`. |
| `pythonPath` | Interpreter to use instead of the managed venv. |

`SESSDATA` is stored in the DSH credential store, not in configuration files.

## Troubleshooting

- **“Python 环境不可用”** — run `node scripts/setup-env.js` in the package
  directory, or install Python 3.10+ and let the plugin retry.
- **Subtitles fail with “需要登录态”** — the cookie expired; paste a fresh
  `SESSDATA`.
- **Search returns `-412`** — Bilibili rate limits the search endpoint; wait a
  minute, or configure the cookie and retry.

## Development

```bash
node --check lib/index.js
node --check client.js
node scripts/setup-env.js
```

Host code lives in `lib/`, the panel in `client.js`, and the Python worker in
`python/bilisum_worker.py`. The worker speaks JSONL over stdout, so the panel and
the agent tools share one pipeline.

## License

MIT
