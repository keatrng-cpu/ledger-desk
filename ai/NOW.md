# NOW — ledger-desk current truth

**As of:** 2026-10-29 11:07 ET (session-partner close-out check-in below — **CANARY STILL FAILED, 106+ min after first flag, still not restored, re-pushed to trader**); current-state block 2026-10-19; rest last revised 2026-10-06 (UTC) · **Maintainer:** Graph Keeper · **Repo:** `keatrng-cpu/ledger-desk`
**Branch of this file:** `codex/fix-dev-node-boundary` (stacked on PR #66; not on `main` until Accuracy Review + Release Watch approve and Design Atelier merges)
**Tracking:** issue #7 · plan `ai/research/2026-10-06-desk-implementation-plan.md` @ `09aad4b` · HANDOFF `ai/HANDOFF.md` @ `ceb62b7` (branch `coord/2026-10-06-desk-assignments`; assignments first committed at `defa9e0`)

> Keep this file under 150 lines. It states what is true now, not history. History goes in `ai/DECISIONS.md`.

---

## Current patch (2026-10-19)

- Dev desk now renders at `http://localhost:8080`: PR #66 removes the client-reachable `node:crypto` import; this branch removes the remaining top-level `node:fs` / `node:path` imports from `market/databento.ts`.
- Node-only `.env` access is async, browser-guarded, dynamically imported, and cached. Pure contract-roll and OHLC aggregation live in `market/bars.ts`; synchronous client-reachable consumers import only that module.
- Typecheck, focused boundary/data-path tests, development build, browser render, Discuss surface, and `verify-all --baseline` pass. No `shared/desk-rules.json`, `RULES_HASH`, scoring, or order path change.

## Session-partner check-in (2026-10-29, ~11:07 ET scheduled run — close-out) — CANARY STILL FAILED, 3rd consecutive run, re-pushed to trader

- **`week-ahead.ts` is still 0 lines**, now on `main` HEAD `00dc6fb`. 106+ minutes since the premarket flag (09:21 ET), through the 10:37 ET mid-session check-in, and now the 11:00 ET close-out — three scheduled runs in a row with no fix pushed, despite 4 unrelated commits landing on `main` in that window.
- Restore command unchanged: `git checkout 5e1669a -- src/lib/trading/week-ahead.ts`, then re-apply the legitimate Oct 28 restamp content (FOMC hold, Durable Goods +1.8%) that landed in `de68d47`/`84d1456`/`4bdba1c` on top of the now-empty file.
- Per this session's scope (repo only, narration/discipline, no code edits authorized by the scheduled task), did not run the restore — sent a third PushNotification, escalating: unfixed before next dev build touch repeats the 09-04/09-20/09-25 production-break pattern.
- Close-out content given regardless: gateway window ends 11:30 ET, asked whether today's trades/SKIPS are logged (`src/data/trade-log.json` still ~1 row against thousands backtested — same binding-constraint gap every close-out), command `npx tsx scripts/log-trade.mjs FILE` (desk pre-fills, 4 fields are the trader's); stated any unfilled plan dies at the cash close and must not carry into the next session.
- No fills, prices, or outcomes invented.

## Session-partner check-in (2026-10-29, ~10:37 ET scheduled run — mid-session) — CANARY STILL FAILED, pushed to trader again

- `week-ahead.ts` still 0 lines at that run's HEAD `5cc8252`, 76+ min after the premarket flag with no fix pushed. Flagged again via PushNotification; no restore run (out of this session's scope).
- Mid-session discipline content given regardless (A+-only past 10:00 ET; entry = rest limit at CE; scale = 50% off at T1/BE/runner, do-not-protect-early). No open-position state visible from the repo to grade against the rule.

## Session-partner check-in (2026-10-29, ~09:21 ET scheduled run — premarket) — CANARY FAILED, first flag, NOT restored this session

- **`week-ahead.ts` found at 0 lines on `main` HEAD `4bdba1c`.** Gutted by commit `de68d47` ("Restamp Oct 28: FOMC hold...") — 824 lines removed, collapsed to empty; prior commit `5e1669a` had it healthy at 824 lines. `month-ahead.ts` clean at 535 lines.
- Pushed to the trader via PushNotification immediately on detection, before anything else this run (reporting only, per this session's "repo and nothing else" scope — no code edit).
- Premarket content for Thu Oct 29 still reported, read from the last-good blob (`git show 5e1669a:src/lib/trading/week-ahead.ts`) + `src/data/news-calendar.json`: daily bias "Selective — post-FOMC, prints live"; three 08:30 ET releases (GDP Q3 advance, PCE/Personal Income Sep, Initial Jobless Claims); skip-if = no raid of prior-week H/L or no clean MSS.
- **This is the 6th+ recurrence of the same truncation signature** (prior: 09-04, 09-20, 09-25, and three times during Oct 22–27).

Older 2026-10-28, 10-27, 10-23 and 10-22 check-ins trimmed for length — see `ai/DECISIONS.md` for the dated entries (the 2026-10-27 10:39 ET entry has the `bda6b63` vs `1845be7` restore-SHA correction).

## Read order (every session)

1. `ai/NOW.md` — this file
2. `graphify-out/GRAPH_REPORT.md` — code map from a real Graphify run (`graphify extract . --code-only`, 2026-10-07). Open `graphify-out/obsidian/` as a vault. The trading book is `graphify-out/obsidian/brain/`. The older import ranking is `graphify-out/SEED_REPORT.md`.
3. `ai/DECISIONS.md` — append-only decision log + open locks
4. `ai/HANDOFF.md` — Dual Desk's current packet (today only on branch `coord/2026-10-06-desk-assignments` @ `ceb62b7`)
5. Then file search (`CLAUDE.md` code map, `ai/research/INDEX.md`, source)

Precedence already set by the repo: `AGENTS.md` defers to `CLAUDE.md`; if `CLAUDE.md` conflicts with `src/lib/aplus/config.ts`, **code wins**. This canon does not override either.

---

## Current state (2026-10-15)

- **2026-10-19 07:51 CT:** Keaton approved PR #55 (4h Globex anchor) to go live today after Accuracy + Release Watch GO, swapped while flat; RULES_HASH stays `0a692dc19944a8df` (see DECISIONS.md).
- **Desk-sequence deployed:** main merge `5fa7e30e`, watcher `0bcf2f7`, rulesHash `e7338987cbc7eea5`. All 12 new modes are **shadow**. Watcher daemon PID 1241488 alive. Release Watch PASS, Accuracy PASS.
- **week-ahead.ts:** restamp stub emptied it at `5aafe4d6`; restored in `cebd9c4d` (Accuracy APPROVE); restamp `78aef9fe` passed. Restamps edit, never rewrite; every clone sets `git config core.hooksPath scripts/hooks`.
- **Paper futures** (box `/workspace/paper-futures`, 24/7 under a watchdog): $100k start, cash $93,896 raw. Opens only when the live gates pass (options-only gates excepted), stale-entry 0.5×ATR guard, 2% risk from the fill. 10-14 14:33 CT −$8,540 trade VOID (stale fill). Legacy loose-rule NQ long filled 15:23 CT, −$1,850. Gaps: `PAPER_JOURNAL_TOKEN` missing; no reboot persistence.
- **Backtest (20 Yahoo days, 2026-09-17 → 10-14; no Databento key, so 2022–2026 not possible yet):** live rules 10 trades, 40% win, +0.44R avg, +0.25% on $50k ($126); at 2% risk +1.72% ($860). ~2.5 trades/week, far from the 75% goal. All 353 blocked fire-band signals = −0.16R avg, −55R total, so the gates save money. Shadow-study: fast:agree blocks (+0.35R, n=69), fast:entry blocks (+0.11R, n=104). Earning their keep: second_entry_band (−0.34R), persist, velocity.

## Goal

Fold the Research Desk implementation plan (`09aad4b`) into ledger-desk with one owner per workstream and **one task in flight**. Plan §1 goals: profitability, probability (honest calibrated odds), productivity, intelligence. Binding constraint per plan/ROADMAP: **sample before size-up** — the PATH journal must reach n ≥ 100 before any size-up or autonomy expansion.

## In flight (one task per repo)

| Slot | Workstream | Owner | State |
|---|---|---|---|
| ▶ 1 | **WS-KG0 Knowledge spine** | Graph Keeper | This branch: `ai/NOW.md`, `ai/DECISIONS.md`, `ai/research/INDEX.md`, `graphify-out/GRAPH_REPORT.md` — Accuracy Review passed @ `8ced8f4`, nothing blocking (per Dual Desk; review note `reviews/2026-10-06-ws-kg0-8ced8f4.md` not found on any branch at 06:15 UTC); Dual Desk fixes S1–S4 on top; next Release Watch → Design Atelier |
| next | WS-P1 PATH journal → n ≥ 100 | Trading Stand | Queued; starts when KG0 is accepted or parked by Dual Desk |

Full queue (15 items) lives in issue #7 and `ai/HANDOFF.md`; not duplicated here.

## Live constraints

- **Git is the bus.** Work, research, and assignments land on branches; that is how desks see each other.
- **Brain lab** (`brainlab/`, 2026-10-07). Reads bars, chains, and greeks. Does not place. The book keeps print age and noise on `now:precision` and one shared line on `now:read`. Neither is a gate. Streamlit: `streamlit run brainlab/app.py`. CodeRabbit reads `.coderabbit.yaml`. PR-Agent runs on a `/review` comment once `OPENAI_KEY` is set.
- **Uncommitted work is invisible.** If it is not committed and pushed, no other desk, agent, or session can see it — treat it as not done.
- **One task in flight per repo.** Do not start the next queue item until the current one is done or explicitly parked by Dual Desk.
- **Merge path:** branch → Accuracy Review → Release Watch → **Design Atelier merges** to `main`. No direct commits to `main` from desk work.
- **No size-ups** until PATH n ≥ 100 and the expected-R gate pass (`src/lib/trading/profit-path.ts`; ROADMAP). Separate Accuracy Review ticket.
- **No live orders** from WS-BP / WS-PRE; Robinhood env arms remain human.
- **Do not lower the confluence floor** to manufacture clears (see ambiguity note in Open questions).
  - Grade bands in code (`riskGradeFromScore`, `src/lib/aplus/config.ts:99-107`; same edges for complete sequences in `pathBand`, `src/lib/trading/strategy-grade.ts:422-429`): **A+ ≥ 0.75** (`aPlusThreshold`, config.ts:20) · **A ≥ 0.68** (`confluenceFloor + 0.03`, config.ts:101) · **A− ≥ 0.65** (`confluenceFloor`, config.ts:22, :102) · **B+ ≥ 0.60** (`confluenceFloor − 0.05`, config.ts:103). Verified identical at `33cfb8a` and `main` @ `008cbec`.
  - **B+ live gate** (Robinhood path, from `33cfb8a`; Accuracy + Keaton 2026-10-06): `APLUS_RULES.profitPath.bPlusLive` (config.ts:85-90) = `fitFloor: 0.6` (:86), `requireSeqTake: true` (:87), `requireNoVeto: true` (:88), `maxContracts: 1` (:89). Enforced in `src/lib/execution/rh-autofire-gates.ts`: `evaluateRhBplusGate` (:76-100 — fit < 0.60 refuses :82; SMC sequence TAKE required, unknown fails closed :85-91; veto unknown refuses :92-98) and `evaluateRhBandSize` (:103-110 — exactly 1 contract). A+/A/A− keep `RH_PATH_FLOOR = 0.65` (:36); B+ never lowers it. B+ debit stays inside `RH_MIN_DEBIT_TOTAL`/`RH_MAX_DEBIT_TOTAL` = 50/650 (fireFix.envelope.maxDebit; fixed $650 every grade, Keaton 2026-10-13).
- **No invented numbers.** Floor/dashboard digits come from code or committed packs only (plan WS-DASH / WS-FLOOR; existing verifiers).
- Canon files never place, suggest, or size trades.

## Last decision

- **Adopted 2026-10-06 (Dual Desk, HANDOFF `ceb62b7`; first committed at `defa9e0`):** owner assignments for Phase 1–3; WS-KG0 in flight; Graph Keeper next owner.
- **Proposed 2026-10-06 (Graph Keeper; still pending Keaton's acceptance — Accuracy Review's pass of WS-KG0 does not lock it):** NOW/DECISIONS live under `ai/` (not `.grok/` or `PROGRAM.md`). Reasoning in `ai/DECISIONS.md` (2026-10-06 entry).

## Open questions (from plan §5 / HANDOFF; Keaton or named owner decides)

1. **CBDR clock** for NQ/ES — which timestamp does Keaton lock? *(open lock; no CBDR code found in repo)*
2. What is **flout** on this desk? *(open lock; term not found in repo)*
3. Rename desk **`sponsored`** to avoid ICT collision? *(open lock; term used in `engine-weights.ts`, `confluence.ts`, `scanner.ts`, `smc-master.ts`, others)*
4. Current PATH graded n toward 100? *(unknown from canon — read from journal code/data, never estimate)*
5. Judas release vs hard-block — keep pending WS-J1?
6. Kalshi FLB post-2025 persistence?
7. QQQ/SPY options vs NQ/ES PD-array transfer / basis?
8. NOW/DECISIONS location — **proposed: `ai/`** (pending Keaton's acceptance)
9. PM data vendor / API for Kalshi historical bins?
10. Server-side runner (`FLOOR_BACKLOG` #44) vs PATH journal priority?

Ambiguities Graph Keeper found while building canon (for Accuracy Review):
- **Floor value wording.** Plan/issue say "do not lower 0.75 floor" citing Trading-Automation `knowledge/confluence.json`; ledger-desk `src/lib/aplus/config.ts` has `confluenceFloor: 0.65` and `CLAUDE.md`/README call 0.65 the PATH floor with A+ at ≥ 0.75. Both rules say "do not lower"; which number a given workstream means should be stated explicitly. Code bands (config.ts:99-107): A+ ≥ 0.75 · A ≥ 0.68 · A− ≥ 0.65 · B+ ≥ 0.60 (B+ live only via the explicit gate above, config.ts:85-90). So in ledger-desk 0.75 is the A+ edge and 0.65 the execute floor.
- **Push-to-main wording.** `CLAUDE.md` "When coding" says "Push to **main** so Grok and Claude share one tree"; the 2026-10-06 desk merge path is branch → AR → RW → Design Atelier. Keaton/Dual Desk should reconcile.

## Owners (desk map, from HANDOFF `ceb62b7` / issue #7)

| Role | Owns in ledger-desk |
|---|---|
| **Keaton** | Repo owner; locks open questions (CBDR, flout, sponsored, etc.) |
| **Graph Keeper** | Canon (`ai/NOW.md`, `ai/DECISIONS.md`, `ai/research/INDEX.md`) + code map (`graphify-out/`); WS-KG0 |
| **Dual Desk** | Coordinates Claude and Grok; assigns owners; owns `ai/HANDOFF.md` |
| **Trading Stand** | The trading routine for ledger-desk; WS-P1, WS-BP, WS-D1 contracts, WS-J1 |
| **Research Desk** | Research briefs under `ai/research/`; WS-CAL; co-maintains INDEX |
| **Prototype Lab** | WS-PRE, WS-DASH |
| **Site Copy** | WS-FLOOR copy/lines |
| **Claude** | Deep code: WS-D1 detector code, WS-C1, WS-PM, Graphify hooks |
| **Accuracy Review** | Merge gate: verifiers, no invented numbers |
| **Release Watch** | Actions/build health; approves after AR |
| **Design Atelier** | Merges to `main` after AR + RW; brand/visual systems |

## Where things are (pointers, not copies)

- Hard numbers: `src/lib/aplus/config.ts` (code wins) · protocol + code map: `CLAUDE.md`
- Research: `ai/research/INDEX.md`
- Program/track-record definition (unsigned draft, sealed separately): `PROGRAM.md` — **not** session canon
- Live routine: `docs/RH_LIVE_ROUTINE.md` · backlog: `docs/FLOOR_BACKLOG.md` · roadmap: `ROADMAP.md`
