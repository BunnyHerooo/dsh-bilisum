/**
 * One-time migration from the older flat trees to the shared layout.
 *
 * Old shapes handled:
 *   subtitles/<stem>.md                (loose file)
 *   subtitles/<stem>/<stem>.md         (per-video folder)
 *   subtitles/<group>/<part>.md        (collection folder)
 *   videos/...                         (all of the above)
 *
 * New shape:
 *   <group>/subtitles/<stem>.md
 *   <group>/videos/<stem>.mp4
 *
 * The function never throws: a failed move is recorded and the rest continues.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const TREES = ['subtitles', 'videos'];
const LOG_NAME = 'migration.log';

async function exists(candidate) {
  return fs.access(candidate).then(() => true).catch(() => false);
}

/** Every file below `dir`, recursively. */
async function collectFiles(dir, depth = 0) {
  if (depth > 4) return [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  /** @type {string[]} */
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(full, depth + 1));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/**
 * Move one file to `target`, suffixing the name when it already exists.
 * @returns {Promise<string>} the final path
 */
async function moveFile(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  let final = target;
  const ext = path.extname(target);
  const base = target.slice(0, -ext.length || undefined);
  for (let attempt = 2; await exists(final); attempt += 1) {
    final = `${base}_${attempt}${ext}`;
  }
  await fs.rename(source, final);
  return final;
}

/**
 * Remove half-written downloads left behind by an interrupted batch.
 *
 * A `.part` / `.ytdl` file, or a bare `name.f30280.mp4` fragment, is never a
 * finished download, so sweeping the output root on startup is safe.
 *
 * @param {string} outputRoot
 * @returns {Promise<{ removed: number }>}
 */
export async function sweepPartials(outputRoot) {
  let removed = 0;
  /** @type {string[]} */
  const pending = [outputRoot];
  while (pending.length > 0) {
    const dir = pending.pop();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (/\.(part|ytdl|temp|tmp)$/i.test(name) || /\.f\d+\.[a-z0-9]{2,4}\.part$/i.test(name)) {
        try {
          await fs.rm(full, { force: true });
          removed += 1;
        } catch {
          // locked file: the next start will retry
        }
      }
    }
  }
  return { removed };
}

/**
 * @param {string} outputRoot absolute `bilibili_summaries` directory
 * @param {(message: string) => void} [log]
 * @returns {Promise<{ moved: number, failed: number, logFile: string | null }>}
 */
export async function migrateLayout(outputRoot, log = () => {}) {
  /** @type {string[]} */
  const entries = [];
  /** @type {string[]} */
  const problems = [];
  let moved = 0;

  for (const tree of TREES) {
    const root = path.join(outputRoot, tree);
    if (!await exists(root)) continue;

    let top;
    try {
      top = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      problems.push(`读取 ${root} 失败：${error?.message ?? error}`);
      continue;
    }

    for (const entry of top) {
      const full = path.join(root, entry.name);
      try {
        if (entry.isFile()) {
          // Loose file: `<stem>.ext` belongs to a video of the same name.
          const stem = path.basename(entry.name, path.extname(entry.name));
          const target = path.join(outputRoot, stem, tree, entry.name);
          const final = await moveFile(full, target);
          entries.push(`${full} -> ${final}`);
          moved += 1;
          continue;
        }
        if (!entry.isDirectory()) continue;

        // A folder that already holds the new sub-trees is not a source.
        const inner = await fs.readdir(full, { withFileTypes: true }).catch(() => []);
        if (inner.some((item) => item.isDirectory() && TREES.includes(item.name))) continue;

        for (const source of await collectFiles(full)) {
          const target = path.join(outputRoot, entry.name, tree, path.basename(source));
          const final = await moveFile(source, target);
          entries.push(`${source} -> ${final}`);
          moved += 1;
        }
        // Remove the now-empty old folder.
        await fs.rm(full, { recursive: true, force: true }).catch(() => {});
      } catch (error) {
        problems.push(`${full} 迁移失败：${error?.message ?? error}`);
        log(`[migrate] ${full} 迁移失败：${error?.message ?? error}`);
      }
    }

    // Drop the emptied tree root.
    const rest = await fs.readdir(root).catch(() => ['x']);
    if (rest.length === 0) await fs.rmdir(root).catch(() => {});
  }

  if (moved === 0 && problems.length === 0) {
    return { moved: 0, failed: 0, logFile: null };
  }

  const logFile = path.join(outputRoot, LOG_NAME);
  const stamp = new Date().toISOString();
  const body = [
    `# BiliSum 目录结构迁移 ${stamp}`,
    `moved=${moved} failed=${problems.length}`,
    ...entries.map((line) => `MOVE ${line}`),
    ...problems.map((line) => `WARN ${line}`),
    '',
  ].join('\n');
  await fs.appendFile(logFile, body, 'utf8').catch(() => {});
  log(`[migrate] 迁移 ${moved} 个文件，失败 ${problems.length} 个，日志：${logFile}`);
  return { moved, failed: problems.length, logFile };
}
