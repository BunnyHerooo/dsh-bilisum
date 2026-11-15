/**
 * Portable locations for BiliSum's runtime state.
 *
 * The package itself may live in a read-only package store, so the Python
 * environment and the default output must live outside it: `~/.dsh/bilisum`
 * on every platform, overridable with `BILISUM_HOME`.
 */

import os from 'node:os';
import path from 'node:path';

/** Root of BiliSum's runtime state (`~/.dsh/bilisum`). */
export function bilisumHome() {
  const override = (process.env.BILISUM_HOME || '').trim();
  return override || path.join(os.homedir(), '.dsh', 'bilisum');
}

/** The interpreter inside the managed virtual environment. */
export function venvPython(home = bilisumHome()) {
  return process.platform === 'win32'
    ? path.join(home, 'venv', 'Scripts', 'python.exe')
    : path.join(home, 'venv', 'bin', 'python');
}
