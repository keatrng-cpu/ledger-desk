# Merge-gate review: PM analyzer (Mead + Predict)

**SHA:** `df32e1e013466ef937fee97475176d5f578c3e7c`  
**Branch:** `proto/pm-analyzer`  
**Commit:** *proto(pm-analyzer): Mead Hall + Predict merged into one PM analyzer (paper only)*  
**Owner:** Prototype Lab · **Depends on:** `cd1e1ae` (PM signal engine)  
**Scope:** read-only. No push/merge/deploy/env/orders.  
**Date:** Tue Oct 6 2026.  
**Worktree:** `/workspace/ledger-desk-pm` (existing branch checkout). Suites sequential, `NODE_OPTIONS=--max-old-space-size=2048`, memory-gated.

## Verdict: **APPROVE**

(with should-fix on calibration ring labelling / thin buckets, and paper-record copy saying “unsettled”)

---

## Merge geometry

| Item | Result |
|------|--------|
| Merge-base with `origin/main` | **`008cbec`** (current main) |
| Behind / ahead | **0 behind / 3 ahead** |
| Commits on branch | `cd1e1ae` signal engine → `5022ae2` merge into proto → `df32e1e` analyzer |
| `cd1e1ae` included unchanged? | **YES** — `signal-engine.ts`, `paper-scorer.ts`, `signal-evidence.ts`, `signals.ts` **byte-identical** to `cd1e1ae` |
| Analyzer-only delta | `5022ae2..df32e1e`: 9 files, +964/−31 |
| Conflicts vs main | **None** (already based on `008cbec`) |

Analyzer-only files: `pm-analyzer.tsx`, `mead-signal-feed.ts`, `pm-paper-store.ts`, `pm-analyzer.test.mjs`, mead scene/screens tweaks, `predict-tab` embed props, `routes/index.tsx` (Mead tab folded into Predict), `prediction-market-feed.ts` (`MarketHallView`).

---

## (1) Diff beyond `cd1e1ae` / engine unchanged — **PASS**

Engine + scorer + evidence + barrel match `cd1e1ae` exactly. This SHA adds the UI wire that **fixes** the dark-module blocker on the engine alone (`pm-analyzer.tsx:33-36` imports `@/lib/predict/signals`).

---

## (2) Paper tickets localStorage-only, unsettled — **PASS** (should-fix copy)

| Claim | Evidence |
|-------|----------|
| localStorage only | `PM_PAPER_KEY` / `loadPaper` / `save` (`pm-paper-store.ts:15-66`) |
| Never auto-settle | `resolvePaper` exists but **not wired** to any feed (`:80-90` header: “Not wired yet”); tickets stay `outcome: null` |
| No invented hit/P&L | `Record` → `scorePaper` (`pm-analyzer.tsx:123-137`); rings use `ok` only when `overall.read === "ok"`, else `null` → **"n/a"** + `TOO_FEW` subtitle — no hit rate / net ¢ until real settlements |
| Render path | Desk: `DeskPanel` → `<Record tickets={mine} … compact />` (`:291`); global: `<Record tickets={tickets} title="Paper record — all analyzer tickets" />` (`:427-429`) + footnote that tickets stay open until a settled-market read |

**Should-fix:** Copy says “N open · 0 settled” and “rings read TOO_FEW”, not the word **“unsettled”**. Prefer title/footnote: *“unsettled — no settlements yet”* when `score.settled === 0`.

Test: paper book stays `overall.read === TOO_FEW` with open ticket (`pm-analyzer.test.mjs:78-92`).

---

## (3) Move / velocity top-6 only; honest empty — **PASS**

- Candles only for top **`SIGNAL_CANDLE_TOP = 6`** (`predict-server.ts:528`, `:591`).
- Desk `Move since open`: `basis === "none"` → sub `no real reference trade`; `velocityCentsPerHour == null` → **`velocity —`** (not `0`) (`pm-analyzer.tsx:251-257`). `signedC(null)` → `"—"`.
- Crowd: `reactionForCrowd` silent when `energy == null` / `basedOn === 0` (`mead-signal-feed.ts:209-213`); `setCrowd` only from real `CrowdRead` (`mead-scene.ts` analyzer mode).
- Hall UI defaults to 6 panels; “Show every market” expands without inventing velocity (`pm-analyzer.tsx` show-all control).

---

## (4) Calibration ring — **PASS with should-fix**

Custom in UI (`pm-analyzer.tsx:110-120`):

```ts
// 1 − n-weighted mean |observed − forecast| over scorer buckets
if (score.overall.read !== "ok") return null;
// skips n===0 / gap==null; weights by b.n
```

| Question | Finding |
|----------|---------|
| Labelled derived? | Subtitle shows formula `1 − mean \|observed − forecast\|` + Brier — **partially**. Main label is still **"Calibration"** (sounds like scorer export). |
| n-weighted? | **Yes** (`gap += b.n * abs(b.gap)`). |
| Suppressed on small overall n? | **Yes** — requires `overall.read === "ok"` (need 30). |
| Thin buckets? | **Includes** buckets with `n > 0` even when `b.read === "too few"` (n \< 10). |
| Implies accuracy it lacks? | Mild risk: a big green “Calibration 92%” is a 1−MAE-style gap score, not Murphy reliability / proper score. |

**Should-fix:** Rename to **“Calibration gap (derived)”** (or show Murphy `reliability` / Brier as the ring), and **only sum buckets with `b.read === "ok"`**.

---

## (5) Feed honesty — **PASS**

- Source: `getPredictionSignals` → `hallStateFromBoard` / `hallLayout` (`mead-signal-feed.ts:4-8`, `pm-analyzer.tsx:65-68`).
- Header chip: LIVE / **STALE ·** + Kalshi label + `asOf` clock (`pm-analyzer.tsx:377-384`).
- Bad poll **holds last live board**, note `STALE — last live board kept (…)`; never blanks to mock (`nextHallState` `:126-130`; test `:64-76`).
- Cold fail → `status: "error"`, empty markets — not synthetic rows.

---

## (6) Palette / IP — **PASS**

- Analyzer uses `MEAD` pine / iron / brass (`mead-screens.ts:66-75`; `pm-analyzer.tsx:16`, `:48`).
- No `#4F2683`, `#FFC62F`, purple-range literals, SKOL, or horn branding in analyzer delta (helm comments: “no cartoon … horns”).

---

## (7) No order / arm / env path — **PASS**

- Paper buttons call `addPaper` / `paperTicketFromSignal` only; confirm copy *“No order was sent anywhere”* (`pm-analyzer.tsx:199-206`).
- `pm-paper-store` / `mead-signal-feed` / signal modules: no place/review/cancel; no broker imports (engine verifier + store header).
- Embedded `PredictTab` still has a **GO beep checkbox** (`armed`) — notification only, pre-existing scanner UX, not RH `RH_LIVE_ARMED` / place path.
- RH suites green (unchanged by this delta).

---

## Suites (this SHA)

| Suite | Result |
|-------|--------|
| `scripts/pm-analyzer.test.mjs` | **5 passed** |
| `scripts/mead-hall.test.mjs` | **7 passed** |
| `npm run verify:pm-signal` | **90 passed** |
| `verify-prediction-market-feed.mjs` | **96 passed** |
| `verify-repo-guards.mjs` | **59 passed, 0 failed** (signals barrel now wired) |
| `tsc --noEmit` | **exit 0** |
| `verify-rh-autofire-gates.mjs` | **218 passed** |
| `verify-rh-path-fire.mjs` | **111 passed** |
| `verify-manager-live-loop.mjs` | **58 passed** |
| `verify-floor-rh-account.mjs` | **21 passed** |
| `verify-autofire-gates.mjs` | **22 passed** (bonus) |

---

## Should-fix (non-blocking)

1. Paper record: say **“unsettled”** when `settled === 0`.
2. Calibration ring: label **derived gap**; ignore `too few` buckets; or ring Brier / Murphy REL instead.
3. Engine SHA `cd1e1ae` alone still fails guards (dark `signals.ts`) — **do not land the engine without this wire** (or delete the barrel). This analyzer SHA is the intended consumer.

---

## Recommendation

**APPROVE** `df32e1e` for merge onto current main. Prefer merging this (or engine+analyzer together) rather than `cd1e1ae` alone, so the signal API is not dark.

---

## Follow-up 0aa34f6 (`proto/pm-analyzer-followup` @ `0aa34f6ac11799b3f071f2820023b205884a9b1d`)

Owners: Prototype Lab + Trading Stand. Built on `df32e1e` via Stand `8b2ea6f`. Diff vs `df32e1e` only (8 files; no other drift). Worktree: `/workspace/ledger-desk-pm-fu-0aa34`. `NODE_OPTIONS=--max-old-space-size=2048`; `free -m` before suites (~8.5–9.7 GB available). No `pkill`.

### Should-fixes (a)(b)(c) — **PASS**

| # | Requirement | Evidence |
|---|-------------|----------|
| (a) | Literal word `unsettled` when `settled === 0` | `pm-analyzer.tsx:150-160` — `settledLabel = score.settled === 0 ? "unsettled" : …` plus body line `unsettled — no settlements yet` |
| (b) | Murphy REL when overall read ok; else `Calibration gap (derived)` | `pm-analyzer.tsx:117-142` — ok path: label `Calibration (1−Murphy REL)`, value `1 - rel`; else label `Calibration gap (derived)`, `value: null` |
| (c) | Only buckets with `read === "ok"` weighted | `pm-analyzer.tsx:130-133` — `if (b.read !== "ok" \|\| b.gap == null \|\| !b.n) continue` |

Unit coverage: `scripts/pm-analyzer.test.mjs` subtest *Accuracy should-fix copy…* (**pass**).

### Stand null grade (`8b2ea6f`) — **PASS**

- `signal-engine.ts:749-750`: `ungradedReason = edge.status === "edge" ? null : NO_EDGE_READ`; `grade = ungradedReason ? null : letter` — **no letter without a model/edge read**.
- `verify-pm-signal-engine.mjs`: *no edge read → NO letter (grade null, not ≤B)*.
- Analyzer header uses `b.ungraded` + `NO_GRADE_LABEL` (`pm-analyzer.tsx:415`); DeskPanel shows `—` / gray when `s.grade == null` (`pm-analyzer.tsx:243-252`), never `GRADE_COLOR[null]`.

### Null-grade UI — **FAIL (letter leak)**

Guards that work:

- `mead-signal-feed.ts:42-43` — `hall.grade` omitted when `s.grade == null` (`MarketHallView.grade` optional, `prediction-market-feed.ts:107-109`).
- `mead-screens.ts:221-235` — when `m.hall` present, `gradeText` → `m.hall.grade ?? "—"`; jumbotron (`:309-311`) prints `No grade` when `!feat.hall.grade`.
- `pm-analyzer` DeskPanel / `NO_GRADE_LABEL` / `gradeLabel` — honest.

**Blocker — invented letter `D` for ungraded signals:**

- `mead-signal-feed.ts:65-66`: `setupGrade: s.grade != null ? SETUP[s.grade] : "D"` (comment admits “neutral placeholder”).
- Still rendered as a letter grade in **MeadHallTab** (still mounted under `captureMead && !desk`, `routes/index.tsx:1720-1730`):
  - `mead-hall-tab.tsx:113` — `{m.setupGrade} · …`
  - `mead-hall-tab.tsx:311-312` — letter cell `{m.setupGrade}`
  - `mead-hall-tab.tsx:336` — `grade {featured.setupGrade}`
- Fallback path when `hall` absent: `mead-screens.ts:224` returns `m.setupGrade`; jumbotron `:311` prints `Grade ${feat.setupGrade}`.

That is the same class as “default grade when null.” Canvas / analyzer desk prefer `hall` so they show `—` / “No grade”, but any path that reads `setupGrade` (MeadHallTab HTML, no-hall jumbotron) still paints **D**.

### Diff / guards / suites

| Check | Result |
|-------|--------|
| Diff vs `df32e1e` only | `0aa34f6` + `8b2ea6f`; 8 files; signals barrel import intact (`pm-analyzer.tsx` imports from `@/lib/predict/signals`) |
| `tsc --noEmit` | exit 0 |
| `scripts/pm-analyzer.test.mjs` | **6 passed** |
| `scripts/mead-hall.test.mjs` | **7 passed** |
| `npm run verify:pm-signal` | **98 passed** (was 90; Stand added cases) |
| `verify-prediction-market-feed.mjs` | **96 passed** |
| `verify:guards` | **59 passed, 0 failed** |
| `verify-rh-autofire-gates.mjs` | **218 passed** |
| `verify-rh-path-fire.mjs` | **111 passed** |
| `verify-manager-live-loop.mjs` | **58 passed** |
| `verify-floor-rh-account.mjs` | **21 passed** |

### Recommendation

**CHANGES** `0aa34f6` — should-fixes (a)(b)(c) and Stand null-grade engine are good; land after removing the `setupGrade: "D"` placeholder and stopping MeadHallTab / no-hall screens from rendering a letter when `grade` is null (use `—` / `NO_GRADE_LABEL` / omit, matching DeskPanel).

Parent `df32e1e` **APPROVE** above still stands for the analyzer base; this follow-up needs the letter-leak fix before merge.

---

## Re-check 9dc9eb7 (`proto/pm-analyzer-followup` @ `9dc9eb7edb52a5d43d69141402705ebaa243bfe4`)

Fixes the 0aa34f6 blocker (null grade → placeholder `setupGrade: "D"`). Worktree: `/workspace/ledger-desk-pm-fu-9dc9` (own; removed after). `NODE_OPTIONS=--max-old-space-size=2048`; `free -m` before each suite. No `pkill`. Main tip: `origin/main` = `df32e1e`.

### Diff vs `0aa34f6` only — **PASS**

Single commit `9dc9eb7`. 5 files: `mead-signal-feed.ts`, `mead-hall-tab.tsx`, `mead-screens.ts`, `prediction-market-feed.ts`, `pm-analyzer.test.mjs` (+58/−13). No other drift.

### Null grade end-to-end — **PASS**

| Site | Behavior |
|------|----------|
| `mead-signal-feed.ts:65-66` | `setupGrade: s.grade != null ? SETUP[s.grade] : null` — no `"D"` placeholder |
| `prediction-market-feed.ts:82-86` | `setupGrade: SetupGrade \| null`; comment: render `NO_GRADE_LABEL`, never a placeholder letter |
| `mead-screens.ts:228` | `setupGradeLabel = (g) => g ?? NO_GRADE_LABEL` |
| `mead-screens.ts:221-225` | `gradeText`: hall → `hall.grade ?? "—"`; else `setupGrade ?? "—"` |
| `mead-screens.ts` jumbotron | no-hall path: `setupGrade != null ? Grade X : "No grade"` |
| `mead-hall-tab.tsx:113` | `{setupGradeLabel(m.setupGrade)}` |
| `mead-hall-tab.tsx:312-316` | null → muted + `setupGradeLabel` (not raw `{m.setupGrade}`) |
| `mead-hall-tab.tsx:340` | `setupGrade != null ? grade X : setupGradeLabel(null)` |
| `routes/index.tsx:1720-1730` | MeadHallTab still mountable under `captureMead && !desk` — now shows `NO_GRADE_LABEL` via helpers above |

`SETUP` still maps letter **F → scanner "D"** (`mead-signal-feed.ts:35`) when `grade === "F"` — that is a real letter mapping, not a null default. Test asserts graded F → `"D"`, ungraded → `null`.

Grep: no `setupGrade: "D"` / `?? "D"` / neutral-placeholder path remains. Cap `"D"` in signal-engine/evidence is score-cap logic, unrelated.

New unit: *null grade (no edge read) stays null — never a placeholder D* (`pm-analyzer.test.mjs`).

### Is null→`D` live on main `df32e1e`? — **No**

On `df32e1e`, `MarketSignal.grade` is still non-null `SignalGrade` (`signal-engine.ts:203` at that SHA), and the feed does `setupGrade: SETUP[s.grade]` (`mead-signal-feed.ts:64`) with no null branch. The explicit `s.grade != null ? … : "D"` placeholder was introduced on `0aa34f6` after Stand `8b2ea6f` made `grade` nullable — it is **not** on main today. (F→D via `SETUP` when grade is F is separate and intentional.)

### Merge vs `origin/main` — **PASS**

`origin/main` = `df32e1e`. Branch is 3 commits ahead (`8b2ea6f`, `0aa34f6`, `9dc9eb7`); main is an ancestor → clean fast-forward. No conflict markers from merge-tree.

### Suites (one at a time)

| Suite | Result |
|-------|--------|
| `npm run typecheck` (`tsc --noEmit`) | exit 0 |
| `scripts/pm-analyzer.test.mjs` | **7 passed** |
| `scripts/mead-hall.test.mjs` | **7 passed** |
| `npm run verify:pm-signal` | **98 passed** |
| `npm run verify:guards` | **59 passed, 0 failed** |

### Recommendation

**APPROVE** `9dc9eb7` for merge onto current main (`df32e1e`). Prior 0aa34f6 blocker cleared; should-fixes (a)(b)(c) + Stand null grade + UI guards hold.
