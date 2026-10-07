/**
 * The repo is public. The review bots, the workflows and the secret scanner are the front door; this pins that they stay locked.
 *
 *   npx tsx scripts/verify-tooling-guards.mjs
 *
 * Found 2026-10-07: pr-agent.yml let ANY GitHub user comment /review and spend the OPENAI_KEY, ran a third-party action from a moving branch with
 * the repo's token, interpolated a dispatch input into a script, and gave PR-Agent no refusals (CodeRabbit had them). brain-intake.yml posted a
 * comment from any stranger's issue. The arm switch failed OPEN on a word it did not recognize ("disabled"). The history scan had never been run.
 */
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/**
 * The hardened workflows live in docs/pending-workflows/ until someone installs them: pushing a file under .github/workflows needs a token
 * with the `workflow` scope, and the one on the machine that wrote them has none (GitHub refused the push on 2026-10-07). The pinned copy is what
 * this reads while it exists, so the content stays locked; the live file is compared below and the gap is printed, never hidden.
 */
const pendingWf = (name) => existsSync(new URL(`../docs/pending-workflows/${name}.yml`, import.meta.url));
const wf = (name) => read(pendingWf(name) ? `docs/pending-workflows/${name}.yml` : `.github/workflows/${name}.yml`);
const liveWf = (name) => (existsSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url)) ? read(`.github/workflows/${name}.yml`) : null);
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

console.log("PR-Agent");
{
  const y = wf("pr-agent");
  check("only an owner, member or collaborator can trigger it from a comment", /contains\(fromJSON\('\["OWNER","MEMBER","COLLABORATOR"\]'\), github\.event\.comment\.author_association\)/.test(y));
  check("the third-party action is pinned to a full commit SHA, not a branch", /uses: qodo-ai\/pr-agent@[0-9a-f]{40}\b/.test(y) && !/qodo-ai\/pr-agent@(main|master|v\d)/.test(y));
  check("a dispatch input is passed through env, never interpolated into the script", /PR_INPUT: \$\{\{ github\.event\.inputs\.pr \}\}/.test(y) && !/"\$\{\{ github\.event\.inputs\.pr \}\}"/.test(y) && /process\.env\.PR_INPUT/.test(y));
  check("it has a timeout and a concurrency group", /timeout-minutes: \d+/.test(y) && /concurrency:/.test(y));
  check("its token is least-privilege (contents read only)", /contents: read/.test(y) && !/contents: write/.test(y));
  check("the key is read only from a secret", /OPENAI_KEY: \$\{\{ secrets\.OPENAI_KEY \}\}/.test(y) && !/sk-[A-Za-z0-9]{20}/.test(y));
}

console.log("brain intake");
{
  const y = wf("brain-intake");
  check("only an owner, member or collaborator's issue is read", /contains\(fromJSON\('\["OWNER","MEMBER","COLLABORATOR"\]'\), github\.event\.issue\.author_association\)/.test(y));
  check("the issue text reaches the parser through a file, never a shell or script interpolation", /fs\.writeFileSync\("\/tmp\/issue\.json"/.test(y) && !/\$\{\{ github\.event\.issue\.(title|body) \}\}/.test(y));
  check("it can comment and nothing else", /issues: write/.test(y) && /contents: read/.test(y) && !/contents: write|pull-requests: write/.test(y));
  check("timeout and concurrency set", /timeout-minutes: \d+/.test(y) && /concurrency:/.test(y));
  const probot = read("brainlab/probot/app.js");
  check("the Probot variant passes arguments as --title=… so a body starting with '-' is not an option, and uses execFileSync (no shell)", /`--title=\$\{title\}`/.test(probot) && /execFileSync/.test(probot) && !/\bexec\(|execSync\(/.test(probot));
}

console.log("standing refusals for every review bot");
{
  const toml = read(".pr_agent.toml");
  const cr = read(".coderabbit.yaml");
  for (const [name, src] of [["PR-Agent (.pr_agent.toml)", toml], ["CodeRabbit (.coderabbit.yaml)", cr]]) {
    check(`${name}: never lower the floor`, /confluenceFloor|aPlusThreshold/.test(src) && /Do not suggest lowering|Do not propose an edit that lowers|never suggest an edit/i.test(src));
    check(`${name}: no model in the poll or scoring path`, /language model|LLM|model call/i.test(src) && /poll|scoring/i.test(src));
    check(`${name}: no order path, no skipping review_option_order`, /review_option_order/.test(src) && /order/i.test(src));
  }
  check("PR-Agent and CodeRabbit both keep the school reads, the ledger and the heartbeat narration-only", /narration and readiness only/i.test(toml) && /Narration and readiness only/i.test(cr));
  check("CodeRabbit knows this repo is public and what a workflow must do", /author_association/.test(cr) && /pin third-party actions to a commit/.test(cr));
  check("the generated Graphify notes are not reviewed as source", /graphify-out/.test(cr));
}

console.log("secrets");
{
  const s = wf("security");
  check("Gitleaks is checked against a pinned SHA-256 before it runs", /GL_SHA256: "[0-9a-f]{64}"/.test(s) && /sha256sum -c -/.test(s));
  check("Gitleaks scans the whole history with the repo config, and redacts", /fetch-depth: 0/.test(s) && /-c \.gitleaks\.toml --redact/.test(s));
  check("Bandit is pinned and fails on Medium and above", /bandit==\d+\.\d+\.\d+/.test(s) && /-ll/.test(s));
  check("the security job is read-only and uses no secret", /contents: read/.test(s) && !/secrets\./.test(s));
  const g = read(".gitleaks.toml");
  check("the Gitleaks config keeps the default rules ON and allowlists only the generic rule", /useDefault = true/.test(g) && (g.match(/targetRules = \["generic-api-key"\]/g) ?? []).length === (g.match(/\[\[allowlists\]\]/g) ?? []).length);
  check("every allowlist says why", (g.match(/description = /g) ?? []).length === (g.match(/\[\[allowlists\]\]/g) ?? []).length);
  const ign = read(".gitignore");
  check(".env files and the lab's venv, database and Chroma store are git-ignored", /^\.env$/m.test(ign) && /^\.env\.\*$/m.test(ign) && /brainlab\/\.venv\//.test(ign) && /brainlab\/\.chroma\//.test(ign) && /brainlab\/out\//.test(ign));
  check("no .env file is tracked, only the example", !existsSync(new URL("../.env", import.meta.url)) || /^\.env$/m.test(ign));
}

console.log("the kill switch fails closed");
{
  const rh = await import("../src/lib/execution/rh-autofire.ts");
  const off = ["false", "0", "off", "no", "disabled", "nope", "f", "n", "stop", "tru"];
  check("every unrecognized or negative word disarms both switches", off.every((w) => rh.rhAutofireEnabled({ RH_OPTIONS_AUTOFIRE_ENABLED: w }) === false && rh.rhLiveArmed({ RH_LIVE_ARMED: w }) === false), off.filter((w) => rh.rhLiveArmed({ RH_LIVE_ARMED: w })).join(","));
  check("unset and blank stay armed (the trader's 2026-10-07 default), true/1/on/yes arm", rh.rhLiveArmed({}) === true && rh.rhLiveArmed({ RH_LIVE_ARMED: "" }) === true && ["true", "1", "on", "yes"].every((w) => rh.rhLiveArmed({ RH_LIVE_ARMED: w })));
}

console.log("workflow install state (reported, not failed: it needs a token with the `workflow` scope)");
for (const name of ["pr-agent", "brain-intake", "security"]) {
  if (!pendingWf(name)) continue;
  const live = liveWf(name);
  const norm = (t) => t.replace(/\r\n/g, "\n");
  const same = live != null && norm(live) === norm(wf(name));
  console.log(`  ${same ? "ok  " : "TODO"} .github/workflows/${name}.yml ${same ? "matches the hardened copy" : live == null ? "is not installed yet" : "is still the OLD version"} — copy docs/pending-workflows/${name}.yml over it and push with a workflow-scoped login`);
}

console.log(`\ntooling-guards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
