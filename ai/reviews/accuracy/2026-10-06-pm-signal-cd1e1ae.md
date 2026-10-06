# Merge-gate review: PM signal engine

**SHA:** `cd1e1ae764e39d6e4be1033dd2a2f418859c2180`  
**Branch:** `feat/pm-signal-engine`  
**Commit:** *(PM signal engine + paper scorer — fee-net edges, FLB bins, Brier/Murphy, walk-forward)*  
**Owner:** Trading Stand · **Extra checks:** Design Atelier  
**Scope:** read-only. No push/merge/deploy/env/orders.  
**Date:** Tue Oct 6 2026.  
**Worktree:** `/workspace/ledger-desk-pm-cd1e` (removed after review). Suites sequential, `NODE_OPTIONS=--max-old-space-size=2048`, memory-gated.

## Verdict: **CHANGES**

Blocking: `verify:guards` fails — new dark module `src/lib/predict/signals.ts`. Wire it into a desk surface or delete the unused barrel before merge. Do **not** add it to `KNOWN_DARK`.

---

## Merge geometry

| Item | Result |
|------|--------|
| Merge-base with `origin/main` | **`f49d2f3`** (at review start); tip `origin/main` = **`008cbec`** (floor merge) |
| Behind / ahead | **3 behind / 1 ahead** vs `008cbec` |
| Tips on main not in branch | `0f83a1a` research brief; `259d34d` / `008cbec` floor overhaul |
| File overlap | `ai/research/2026-10-06-pm-signal.md` — **byte-identical** to main (`SPEC_IDENTICAL`) |
| Conflicts | **None expected** |

Diff vs merge-base: 9 files, ~+2040 — `signal-engine.ts`, `paper-scorer.ts`, `signal-evidence.ts`, `signals.ts` barrel, `predict-server.ts` (+`getPredictionSignals`), `prediction-market-feed.ts` (field adds), `verify-pm-signal-engine.mjs`, `package.json` (`verify:pm-signal`), research brief.

---

## Design Atelier extras

| Check | Result | Evidence |
|-------|--------|----------|
| `'no edge read'` when no model | **PASS** | `edgeFor` → `NO_EDGE_READ` (`signal-engine.ts:545-572`); board `noEdgeCount`; fixture + live: all no-edge without models |
| "No grade without a model probability" | **PASS with nuance (should-fix)** | Letter grades still emit, **capped at B** ("setup only") (`:714-716`, header `:25`). Tests: `no model → no grade better than B`, `coin-flip, no model → B`. Edge status correctly refuses edge. If Design meant **null/N/A letter** until model P exists, that is not what shipped — confirm B-cap is OK |
| Paper scoring = pre-outcome snapshots only | **PASS** | `preOutcome()` requires `snapshotAt < resolvedAt\|closeAt` (`paper-scorer.ts:145-161`); `scorePaper` excludes post-outcome and counts `excludedPostOutcome` (`:311-319`, `:348`) |
| Sample-size thresholds honest | **PASS** | `MIN_SAMPLE_OVERALL=30`, `MIN_SAMPLE_BUCKET=10` → `"too few to read"` via `gate()` (`signal-evidence.ts:114-116`, `paper-scorer.ts:197`); no fabricated scores below threshold |
| Live suite + fixture | **PASS** | Fixture **90/90**; `--live` **92/92** (Kalshi public, no key) |
| API surface `@/lib/predict/signals` | **PARTIAL → blocking via guards** | Barrel re-exports engine/scorer/evidence (`signals.ts:13-15`). `computeSignal` / `buildSignalBoard` / `hallLayout` live in `signal-engine.ts`. `getPredictionSignals` lives in `predict-server.ts` (POST, documented on barrel, **not** re-exported). **Nothing in `src/` imports the barrel** → dark module |

---

## Core accuracy (Trading Stand claims)

| Claim | Result | Notes |
|-------|--------|-------|
| Fee-net edges (Kalshi taker) | **PASS** (should-fix rounding) | `VENUES.kalshi.perSide = ceilCents(0.07·C·P·(1−P))` (`math.ts:115-119`). Matches Bürgi/schedule formula; verifier pins 56¢ fee. Should-fix: official PDF also discusses **centicent** + series multiplier `M`; maker path always `0.0175` (NFL-style) vs "makers free unless listed" |
| FLB / longshot bins | **PASS** | `PRICE_BINS` caps D/C for lt10 / 10–20 (`signal-evidence.ts:34-93`); Bürgi WP25/19 confirmed: ≤10¢ lose >60%, all −20%/−22%, takers −31.46% vs makers −11.99%, makers ≥50¢ ~+1.9% |
| Murphy B = REL − RES + UNC | **PASS** | `murphy()` + residual (`paper-scorer.ts:201-235`); verifier identity check |
| Walk-forward no look-ahead | **PASS** | Train only `resolvedAt < test[0].snapshotAt` (`:433-490`) |
| Moves shown, not graded | **PASS** | Reasons + score unchanged with candles (`signal-engine` + verifier) |
| Snowberg & Wolfers 2010 | **PASS** (citation) | JPE 118(4) / NBER w15923 — FLB as misperceptions |
| asOf = fetch time | **PASS** | `fetchKalshiFeedRaw` sets `asOf = new Date().toISOString()` (`predict-server.ts:477-482`); feed contract documents fetch-time (`prediction-market-feed.ts:8-24`) |
| No order / arm / RH path | **PASS** | Verifier scans signal modules; RH/trading files untouched in diff |
| No synthetic-as-real in engine | **PASS** | Board from Kalshi raw only; null when nothing priced |

---

## Blocking / should-fix

### Blocking

1. **`src/lib/predict/signals.ts` is a NEW dark module** — `verify-repo-guards.mjs` → `58 passed, 1 failed`: *finished code that ships no decision*. Fix: wire Prototype Lab / Mead / Predict to `import { … } from "@/lib/predict/signals"` (or call `getPredictionSignals` from a surface), **or** delete the unused barrel and document imports from `signal-engine` / `predict-server`. Do not baseline into `KNOWN_DARK`.
2. **Related:** `paper-scorer.ts` is only imported by that dark barrel (sibling re-export). Scorer never reaches a desk decision yet — wire with the barrel or drop from the public API claim until UI uses it. `getPredictionSignals` itself is defined but **no route/component imports it** yet (Mead still uses `getPredictionMarketFeed`).

### Should-fix

1. Design Atelier: confirm setup-only **letter grade ≤B** without model is acceptable vs null grade.
2. Fee fidelity: centicent / series `M`; maker fee always 1.75%.
3. After rebase onto `008cbec`, re-run guards + `verify:pm-signal`.

---

## Suites (this SHA)

| Suite | Result |
|-------|--------|
| `npm run verify:pm-signal` | **90 passed, 0 failed** |
| `npx tsx scripts/verify-pm-signal-engine.mjs --live` | **92 passed, 0 failed** (25 live signals, all no-edge) |
| `npx tsx scripts/verify-prediction-market-feed.mjs` | **96 passed, 0 failed** |
| `npx tsx scripts/verify-repo-guards.mjs` | **58 passed, 1 failed** — dark `signals.ts` |
| `tsc --noEmit` | **exit 0** (peer worktree same SHA `ld-rw-pm-sig-cd1e1ae`) |
| RH suites | Not re-run (diff does not touch RH); no RH/order imports in signal modules |

---

## Recommendation

**CHANGES** — land the engine after the dark-module fix (wire or delete `signals.ts`). Accuracy/math/Design core checks are otherwise in good shape; dependent Prototype Lab work can then consume a wired API.
