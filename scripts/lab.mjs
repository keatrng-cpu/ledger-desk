/**
 * One command for the Python lab, on any OS (npm scripts run under cmd on Windows, where `brainlab/.venv/Scripts/python` does not resolve).
 *
 *   npm run lab:setup       create brainlab/.venv and install requirements.txt + requirements-dev.txt (downloads from PyPI)
 *   npm run lab:check       run brainlab/selfcheck.py (no order call, the gate, fills, legs, intake, memory, bars)
 *   npm run lab:security    Bandit over brainlab and gateway (fails on Medium and above)
 *   npm run lab:crosscheck  the desk's fair value gaps against the independent smartmoneyconcepts library, MNQ and ES
 *
 * Nothing here reads a credential or places an order. `lab:setup` is the only step that uses the network.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const venv = join(root, "brainlab", ".venv");
const win = process.platform === "win32";
const py = join(venv, win ? "Scripts" : "bin", win ? "python.exe" : "python");
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: root, env: { ...process.env, PYTHONUTF8: "1" }, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const task = process.argv[2];
if (task === "setup") {
  if (!existsSync(py)) run(win ? "python" : "python3", ["-m", "venv", venv]);
  run(py, ["-m", "pip", "install", "--upgrade", "pip", "-q"]);
  run(py, ["-m", "pip", "install", "-r", join(root, "brainlab", "requirements.txt"), "-r", join(root, "brainlab", "requirements-dev.txt")]);
} else if (!existsSync(py)) {
  console.error("The lab is not set up. Run `npm run lab:setup` first.");
  process.exit(2);
} else if (task === "check") {
  run(py, [join(root, "brainlab", "selfcheck.py")]);
} else if (task === "security") {
  run(py, ["-m", "bandit", "-r", "brainlab", "gateway", "-x", "brainlab/.venv", "-ll", "-q"]);
  console.log("bandit: no Medium or High findings in brainlab and gateway.");
} else if (task === "crosscheck") {
  mkdirSync(join(root, ".cache"), { recursive: true });
  for (const sym of ["MNQ", "ES"]) {
    const out = join(root, ".cache", `desk-fvgs-${sym}.json`);
    // npx finds tsx the way the verifiers do; on Windows it is npx.cmd, which needs a shell.
    const dump = spawnSync(win ? "npx.cmd" : "npx", ["tsx", join(root, "scripts", "dump-desk-fvgs.mjs"), sym, "2000"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28, shell: win });
    if (dump.status !== 0) {
      console.error(dump.stderr);
      process.exit(dump.status ?? 1);
    }
    writeFileSync(out, dump.stdout);
    console.log(`== ${sym}`);
    run(py, [join(root, "brainlab", "smc_ref.py"), out]);
  }
} else {
  console.error("usage: node scripts/lab.mjs setup | check | security | crosscheck");
  process.exit(2);
}
