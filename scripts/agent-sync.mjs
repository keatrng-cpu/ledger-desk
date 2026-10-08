#!/usr/bin/env node
/**
 * One brief for both agents. Grok and Claude share main. This prints the
 * commits and new files since that agent's bookmark, then moves the bookmark
 * to HEAD. The git log is the source of truth. The bookmark only says what
 * this agent has already been shown.
 *
 *   node scripts/agent-sync.mjs --agent grok
 *   node scripts/agent-sync.mjs --agent claude
 *   node scripts/agent-sync.mjs --print          (no bookmark, no write)
 *
 * Exit 0 when HEAD matches origin/main. Exit 2 when origin is ahead: pull
 * --rebase and run again. The bookmark does not move in that case.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jsonPath = join(root, "docs/agent-sync.json");
const mdPath = join(root, "docs/agent-sync.md");
const AGENTS = ["grok", "claude"];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const agent = arg("--agent");
const printOnly = process.argv.includes("--print") || !agent;
if (agent && !AGENTS.includes(agent)) {
  console.error("agent-sync: --agent must be grok or claude");
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

let fetched = true;
try {
  git(["fetch", "origin", "main"]);
} catch {
  fetched = false;
}

const head = git(["rev-parse", "HEAD"]);
const short = git(["rev-parse", "--short", "HEAD"]);
let origin = null;
try {
  origin = git(["rev-parse", "origin/main"]);
} catch {
  origin = null;
}
const behindCount = origin ? Number(git(["rev-list", "--count", `${head}..${origin}`]) || "0") : 0;
const behind = behindCount > 0;

function loadState() {
  try {
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
    return {
      lastSeen: { grok: parsed.lastSeen?.grok ?? null, claude: parsed.lastSeen?.claude ?? null },
    };
  } catch {
    return { lastSeen: { grok: null, claude: null } };
  }
}

function known(sha) {
  if (!sha) return false;
  try {
    git(["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function commitsOf(range) {
  const raw = git(["log", "--pretty=format:%H%x09%h%x09%cI%x09%s", range]);
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((line) => {
    const [sha, brief, at, ...rest] = line.split("\t");
    const names = git(["diff-tree", "--no-commit-id", "--name-status", "-r", sha])
      .split("\n")
      .filter(Boolean)
      .map((row) => {
        const [status, ...path] = row.split("\t");
        return { status, path: path.join("\t") };
      });
    return { sha, brief, at, subject: rest.join("\t"), names };
  });
}

const state = loadState();
const bookmark = agent ? state.lastSeen[agent] : null;
const unseen =
  agent && known(bookmark) && bookmark !== head
    ? commitsOf(`${bookmark}..HEAD`)
    : commitsOf("-15");
const recent = commitsOf("-15");
const added = [];
for (const commit of recent) {
  for (const file of commit.names) {
    if (file.status.startsWith("A")) added.push({ path: file.path, brief: commit.brief });
  }
}

const other = agent === "grok" ? "claude" : agent === "claude" ? "grok" : null;
const lines = [];
lines.push("# Agent sync");
lines.push("");
lines.push("Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.");
lines.push("");
lines.push(`HEAD \`${short}\`. ${fetched ? "Fetched origin." : "Fetch failed — this is the local tree only."} ${behind ? "Origin is ahead. Pull --rebase before editing." : origin === head ? "Local main matches origin." : "Local main is not origin. Push or rebase before you treat this as shared."}`);
lines.push("");
if (agent) {
  lines.push(`## Since ${agent} last looked`);
  lines.push("");
  if (!known(bookmark)) {
    lines.push("No prior bookmark. This run is the baseline, and the last 15 commits are listed below.");
  } else if (!unseen.length) {
    lines.push(`Bookmark \`${bookmark.slice(0, 7)}\` is HEAD. Nothing new.`);
  } else {
    lines.push(`Bookmark was \`${bookmark.slice(0, 7)}\`. ${unseen.length} commit(s) landed after it.`);
  }
  lines.push(`Bookmark after this run: \`${agent}\` → \`${short}\`.`);
  lines.push("");
}
lines.push("## Last 15 commits");
lines.push("");
lines.push("| SHA | When (UTC) | What | Files |");
lines.push("|---|---|---|---|");
for (const commit of recent) {
  const files = commit.names.map((f) => `${f.status} ${f.path}`).join(", ") || "—";
  lines.push(`| \`${commit.brief}\` | ${commit.at.slice(0, 16)} | ${commit.subject.replace(/\|/g, "/")} | ${files.replace(/\|/g, "/")} |`);
}
lines.push("");
lines.push("## New files in those commits");
lines.push("");
if (!added.length) lines.push("None.");
else for (const file of added) lines.push(`- \`${file.path}\` in \`${file.brief}\``);
lines.push("");
lines.push("## Before you edit");
lines.push("");
lines.push("- If origin is ahead, `git pull --rebase origin main`, then run this script again.");
lines.push("- A file in the table is unseen until you have read its diff: `git show SHA -- path`.");
lines.push("- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.");
lines.push("- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.");
if (other && known(state.lastSeen[other])) {
  lines.push(`- ${other} last bookmarked \`${state.lastSeen[other].slice(0, 7)}\`.`);
}
lines.push("");

const md = lines.join("\n");
process.stdout.write(md);

if (!printOnly && !behind) {
  state.lastSeen[agent] = head;
  const next = {
    head,
    generatedAt: new Date().toISOString(),
    lastSeen: state.lastSeen,
  };
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(next, null, 2) + "\n");
  writeFileSync(mdPath, md);
}

if (behind) process.exit(2);
