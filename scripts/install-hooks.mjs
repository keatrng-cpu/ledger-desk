/**
 * Copy the repo's git hooks into .git/hooks.
 *
 * .git/hooks is not version controlled, so a hook that only lives there
 * protects exactly one clone and silently protects nothing after the next
 * fresh checkout. The hooks live in scripts/hooks/ and this installs them.
 *
 *   npm run hooks:install
 */
import { copyFileSync, chmodSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "scripts", "hooks");
const DST = join(ROOT, ".git", "hooks");

if (!existsSync(DST)) mkdirSync(DST, { recursive: true });

let n = 0;
for (const f of readdirSync(SRC)) {
  const to = join(DST, f);
  copyFileSync(join(SRC, f), to);
  try {
    chmodSync(to, 0o755);
  } catch {
    // Windows ignores the mode; git for windows runs the hook through sh anyway.
  }
  console.log("installed", f);
  n++;
}
console.log(`${n} hook(s) installed into .git/hooks`);
