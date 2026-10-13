# Accuracy review — wave1/2026-10-13-quick-wins (18 repos), 2026-10-13
Read-only. Blobless clones and diffs against merge-base(default, tip). Nothing pushed to wave1 branches. No PRs opened.

## Tips
All 18 tips match the listed SHAs. merge-base = default tip in every repo except ledger-desk, where main moved on after the cut (mb ed971c1, main b9952fe; that one main commit only touches src/data/week-prints.json).

## T1 .graphifyignore
The file is identical in all 18 repos (md5 c9035d4f, 16 lines). It excludes: graphify-out/, node_modules/, dist/, build/, .next/, coverage/, **/routeTree.gen.ts, **/*.gen.ts, **/*.min.js, lib/i18n-dicts/, the npm/pnpm/yarn lockfiles, **/fixtures/ and deploy.zip.
- Discovery .graphifyignore:15 `**/fixtures/` hides fixtures/markets-print/check.py, a real program, plus the fixtures/caps/*.json defaults that desk/desk.py:1114-1115 reads. **FAIL**
- fitness-app-build .graphifyignore:11 `lib/i18n-dicts/` hides tracked lib/i18n-dicts/{ar,es,hi,zh}.ts. These are data dictionaries, so I note it rather than fail it.
- ledger-desk: `**/fixtures/` hides scripts/fixtures/*.json, which is test data. That's fine.

## H13 CI
None of the 10 workflows reference `secrets.*` or use pull_request_target, and none deploy, publish or push. All have `permissions: contents: read`, concurrency and timeout 15. Every step runs an existing package.json script or pytest; TA and SA pyproject files have a build-system.
- continue-on-error, expected (4): ledger-desk ci.yml:27 (lint), TA ci.yml:24, atrium-pe-atelier ci.yml:29, atrium-learning-desk ci.yml:25 (typecheck). Each one carries a comment.
- **EXTRA continue-on-error:** pickitupe ci.yml:29 (npm test, "not verified locally"), atrium-learning-desk ci.yml:30 (npm test, "not verified locally").
- **Triggers:** ci.yml:5-6 is `push: branches: [main]` in Stock-Automationa and Discovery, but those repos have no `main` branch (their defaults are claude/*), so push never fires. Website-optimization- ci.yml:6 has the same issue: a `main` branch exists but isn't the default. Last-Call has no CI, as expected.

## M2/M3 canon trims (mechanical, multiset of base−head canon lines vs reference file)
| repo | file | lines removed | lost/reworded | ref-only lines |
|---|---|---|---|---|
| ledger-desk | CLAUDE.md→docs/agents/CLAUDE-reference.md | 129 | 0 | title, footer, 3 section headings (headings also kept in canon as stubs) |
| pickitupe | CLAUDE.md | 188 | 0 | title, footer, 2 headings |
| Trading-Automation | CLAUDE.md | 93 | 0 | title, footer, 2 headings |
| Stock-Automationa | CLAUDE.md | 79 | 0 | title, footer, 8 headings |
| atrium-learning-desk | AGENTS.md | 491 | 0 | title, footer, 2 headings |
Every trim is lossless and verbatim. Each moved section leaves a "Moved verbatim to …#anchor" pointer in the canon.
- ledger-desk CLAUDE.md keeps "Hard rules" in the canon: 0.65 PATH floor (:53), A+ 0.75 (:54), bands and the B+ live gate with fit 0.60, SEQ TAKE, no veto, exactly 1 contract and $50–$550 (:55), and the news ±15m blackout (:73). The moved sections are UI map, Code map and Env only (:135/:139/:143). `liveQuote` appears **nowhere** in CLAUDE.md, before or after the trim, and not in the reference file either. The trim didn't drop it, but the canon doesn't carry it.
- Stock-Automationa: the moved "Intelligence layer" includes bullets about the news blackout, the live market-condition gate and the adaptive A+ bar. The rules themselves are still in the canon at CLAUDE.md:25-32, so this is OK.
- **atrium-learning-desk:** §1 and §3 were moved whole, and they contain rule sections: "startup.sh (required — you maintain this)", "First scaffold — required entry files", "Communication rules", "Quality bar", "Build & deploy target" and "Browser QA". These are no longer auto-loaded (pointers at AGENTS.md:50/:127). The footer claims "Rules, gates and floors stayed", which is inaccurate here. **FAIL**
- Realestate-genius CLAUDE.md:2-18 (added): src/lib/utils.ts (cn at :4), scripts/discover/discover-arcgis.mjs, src/lib/domain/deals.ts, the property page, src/app/api/ai/chat/route.ts and AGENTS.md all exist. There's no test script (true) and .env* is ignored (.gitignore:40). ai/NOW.md doesn't exist, but the text says "if present". graphify-out isn't tracked in this repo, so I can't check the "Hubs" ranking against a committed file.

## H1 ledger-desk
- Tip tracks 96 graphify-out files: 6 top-level (graph.json, GRAPH_REPORT.md, SEED_REPORT.md, manifest.json, .graphify_analysis.json, .graphify_root), obsidian/graph.canvas, and 89 under obsidian/brain/.
- 9,212 deletions: 9,211 top-level obsidian/*.md notes plus obsidian/.obsidian/graph.json. No file under obsidian/brain/ was deleted.
- Readers I found: scripts/verify-brain-vault.mjs:16-20,27 (GRAPH_REPORT, SEED_REPORT, graph.json, brain/Book.md, brain/smc-sequence.md, graph.canvas), brainlab/memory.py:12,27 (brain/*.md glob), brainlab/retain.py:158 (brain/), scripts/export-brain-vault.mjs:12 (writes brain/). There are no reads in src/, netlify/, server/, shared/, gateway/, vite.config.ts, netlify.toml, package.json, Makefile or .github. Every file that's read is still tracked.
- `git check-ignore --no-index` across all 96 tracked files returns no matches; the new .gitignore:47-50 re-includes brain/ and graph.canvas.
- verify-brain-vault: **6 passed, 0 failed**. It ran on node 20, with no npm ci needed.
- **DECISIONS not updated:** ai/DECISIONS.md:77-81 (2026-10-07 Graphify entry) is unchanged on the branch. It still describes graphify-out/obsidian/ as the vault and doesn't mention that the generated notes are now untracked. **FAIL** (claim not met)

## (d) claude/* defaults
| repo | default | default tip | wave1 merge-base |
|---|---|---|---|
| Discovery | claude/blissful-darwin-uaoi7e | c615273 | c615273 ✓ |
| Last-Call | claude/last-call-director-9va6ss | 5e4d117 | 5e4d117 ✓ |
| Stock-Automationa | claude/trading-journey-clause-sj5c41 | b127283 | b127283 ✓ |
| Website-optimization- | claude/sintra-local-app-rebuild-x7do9h | 12404d1 | 12404d1 ✓ |

## Scope
Nothing changed outside the claimed scope. The 8 T1-only repos change only .graphifyignore. ledger-desk adds .gitignore for H1. Realestate-genius CLAUDE.md is the claimed expansion.

## Verdicts
| repo | SHA | result | reasons |
|---|---|---|---|
| ledger-desk | 4dc27d1 | FAIL | ai/DECISIONS.md:77-81 not updated for H1; note: liveQuote absent from CLAUDE.md (pre-existing). Trim lossless, H1 sound, vault 6/6, CI ok |
| pickitupe | ce0c214 | FAIL | extra continue-on-error .github/workflows/ci.yml:29 |
| Trading-Automation | 957d0b0 | PASS | — |
| Stock-Automationa | a3535bb | FAIL | ci.yml:5-6 push on nonexistent main (default claude/*) |
| atrium-learning-desk | 1670a0a | FAIL | extra continue-on-error ci.yml:30; rule sections moved out of AGENTS.md (:50,:127) |
| atrium-pe-atelier | e8ae6b1 | PASS | — |
| Realestate-genius | c67bb2e | PASS | facts backed; Hubs ranking unverifiable (no graphify-out tracked) |
| grok-mcp-server | 158e460 | PASS | — |
| Website-optimization- | d9fb11e | FAIL | ci.yml:5-6 push on main, not the default branch |
| Discovery | 6234149 | FAIL | ci.yml:5-6 push on nonexistent main; .graphifyignore:15 hides fixtures/ source |
| Last-Call | 2594744 | PASS | — |
| RouteForge | 93b266e | PASS | — |
| american-penny-power | b177d5c | PASS | — |
| e-eplumbing | e88b8dd | PASS | — |
| fitness-app-build | 7fe4832 | PASS | note .graphifyignore:11 hides lib/i18n-dicts/*.ts |
| gf-plat | d66a158 | PASS | — |
| helixscales | e3d162d | PASS | — |
| profxtrader | 640efca | PASS | — |
