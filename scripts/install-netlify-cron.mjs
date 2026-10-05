/**
 * After vite build on Netlify, Nitro writes the SSR function into
 * .netlify/functions-internal, and that directory is what deploys.
 * A file that lives only under netlify/functions is not in it.
 * Copy the flatten cron beside the SSR function. Local and Vercel builds
 * have no such directory; this is a no-op there.
 */
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const destDir = join(root, ".netlify", "functions-internal");
if (!existsSync(destDir)) {
  console.log("install-netlify-cron: no .netlify/functions-internal — skip");
  process.exit(0);
}
copyFileSync(join(root, "netlify", "functions", "exec-flatten.mjs"), join(destDir, "exec-flatten.mjs"));
console.log("install-netlify-cron: copied exec-flatten.mjs");
