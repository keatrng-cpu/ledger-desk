// Shared by the watcher twin tests: resolve the desk-watcher checkout from
// [process.env.WATCHER_DIR, "/workspace/desk-watcher"] only. No other dirs.
// Returns null only when neither dir exists (watcher not on this box).
// Throws if the chosen dir lacks an expected file or function (no silent fallthrough).
import { existsSync, readFileSync } from "node:fs";

export const DEFAULT_WATCHER_DIR = "/workspace/desk-watcher";

export function resolveWatcherDir({ files = [], contains = {} } = {}) {
  const env = process.env.WATCHER_DIR;
  if (env && !existsSync(env)) throw new Error(`WATCHER_DIR=${env} does not exist`);
  const dir = env || (existsSync(DEFAULT_WATCHER_DIR) ? DEFAULT_WATCHER_DIR : null);
  if (!dir) return null;
  for (const f of files) if (!existsSync(`${dir}/${f}`)) throw new Error(`watcher dir ${dir} is missing ${f} (set WATCHER_DIR to a checkout that has it)`);
  for (const [f, needles] of Object.entries(contains)) {
    const p = `${dir}/${f}`;
    if (!existsSync(p)) throw new Error(`watcher dir ${dir} is missing ${f}`);
    const src = readFileSync(p, "utf8");
    for (const n of [].concat(needles)) if (!src.includes(n)) throw new Error(`watcher dir ${dir}: ${f} has no "${n}" (set WATCHER_DIR to a checkout that has it)`);
  }
  return dir;
}
