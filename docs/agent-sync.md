# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `ad4a937`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `684fdde`. 2 commit(s) landed after it.
Bookmark after this run: `claude` → `ad4a937`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `ad4a937` | 2026-10-23T14:12 | session-partner: 10:11 ET mid-session check — canary clean | M ai/DECISIONS.md, M ai/NOW.md |
| `6a19ce2` | 2026-10-23T13:09 | agent-sync: bookmark claude at 684fdde (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `684fdde` | 2026-10-23T13:09 | session-partner: 09:07 ET premarket — canary clean, 5th week-ahead.ts truncation self-healed same morning | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `d8d2504` | 2026-10-23T07:26 | fix: restore week-ahead.ts byte-exact from cad1953 (gutted by 025f5b3b/ec2a1ec3) (#86) | M src/lib/trading/week-ahead.ts |
| `ec2a1ec` | 2026-10-23T07:12 | Fix week-ahead.ts with updated Oct 19-23 range notes | M src/lib/trading/week-ahead.ts |
| `025f5b3` | 2026-10-23T07:12 | Update week-ahead notes for Oct 19-23 live range and FedWatch odds | M src/lib/trading/week-ahead.ts |
| `cad1953` | 2026-10-22T23:39 | guard: reject placeholder-only/truncated week-ahead.ts + week-prints.json; run verify-repo-guards in CI (#85) | M .github/workflows/ci.yml, M scripts/verify-repo-guards.mjs |
| `3305aa1` | 2026-10-22T16:07 | fix: restore week-ahead.ts + week-prints.json byte-exact from 9180db3a (gutted d3eb1269/aed6d593/2a2f9764); stamp Oct 22 claims 194k (#83) | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `2a2f976` | 2026-10-22T15:52 | Fix restamp: full week-prints with Oct 22 194k claims; full week-ahead Thursday update | M src/data/week-prints.json |
| `aed6d59` | 2026-10-22T15:51 | Restamp Oct 22 claims 194k; Thursday plan still under PWH, Sunday quiet-week holds | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `d3eb126` | 2026-10-22T15:51 | Restamp Oct 22 claims 194k; Thursday plan still under PWH, Sunday quiet-week holds | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `9180db3` | 2026-10-22T15:16 | agent-sync: bookmark claude at 2d8565d (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `2d8565d` | 2026-10-22T15:16 | session-partner: 11:00 ET close-out — canary clean, trade-log flagged | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `18a784c` | 2026-10-22T14:18 | agent-sync: bookmark claude at f49c064 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `f49c064` | 2026-10-22T14:18 | agent-sync: bookmark claude at 6fe7b66; log 10:00 ET canary check-in | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |

## New files in those commits

None.

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
