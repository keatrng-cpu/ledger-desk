# Merge-gate review: Floor 3D overhaul Chunk A (items 7–15)

**SHA:** `259d34d4b46a76449a67630dab616a4874ea5d4e`  
**Branch:** `proto/floor-overhaul`  
**Commit:** *Floor 3D overhaul, Chunk A (items 7-15): pit, glass Manager office, Owner balcony, session clock, VIX weather, liquidity lanes, ticker wall, sound bed, stat banners, trophy shelf + wall of scars*  
**Owner:** Prototype Lab · **Requested by:** Design Atelier  
**Scope:** read-only. No push/merge/deploy/env/orders.  
**Date:** Tue Oct 6 2026.  
**Worktree:** `/workspace/ledger-desk-floor-259d` (removed after review). Suites sequential, `NODE_OPTIONS=--max-old-space-size=2048`, memory gate ≥~1.5GB available before each suite.

## Merge geometry

| Item | Result |
|------|--------|
| Merge-base with `origin/main` | **`f49d2f3`** (Mead merge already on main ancestry) |
| Behind / ahead | **1 behind / 1 ahead** |
| Tip on main not in branch | `0f83a1a` *research: add 2026-10-06 prediction-market signal evidence brief* |
| File overlap since merge-base | **None** — research brief does not touch Floor overhaul paths |
| Conflicts | **None expected** (clean merge/rebase onto current main) |

Diff vs merge-base: 10 files, +1839/−18 — `floor-props.ts`, `floor-overhaul.ts`, `floor-sound.ts`, layout/scene/tab wiring, `floor-overhaul.test.mjs`.

---

## (1) Stats / banners / trophies / scars → real data only — **PASS**

All figures flow through pure `floorProps()` (`src/lib/room/floor-props.ts:357-369`) from `TalkWorld` + room book/memories — no invented markets.

| Surface | Source | Empty / missing |
|---------|--------|-----------------|
| Stat banners | `statProps` from `BookRead` + `LabLite` + `startCash` (`:280-292`) — day P&L, equity, closed/won, loss streak, PATH month cap, calibration | Calibration → `"no filled plans scored yet"` (`:291`); zero closed stays muted tone (`:285`) |
| Trophies / scars | `trophiesAndScars` from `RoomClosedTrade[]`, graded `Memory` outcomes, ghost `lab.refusals` (`:312-340`) | Empty lists → honest copy on screens (`floor-overhaul.ts:812-816`, `:828-832`): shelf empty / no scars yet — **no placeholder cups** (`placeCups` only for real trophies `:524+`) |
| Ticker / lanes / weather | TalkWorld books, pulse, feed, desk levels | Missing levels listed in `missing[]` (`floor-props.ts:175-176`, `:196-203`); never filled |

Tests pin empty trophies/scars (`scripts/floor-overhaul.test.mjs` trophies test → `{ trophies: [], scars: [] }`).

Wall-of-scars concrete speckles use a **fixed seed for texture only** (`floor-overhaul.ts:818-826`) — not financial numbers. Acceptable presentation noise.

---

## (2) VIX weather — real `^VIX`, fail-closed — **PASS** (should-fix: label source)

**Data path (real):**

1. `getPulse()` → `loadPulse()` (`src/lib/news/news-server.ts:126-135`)
2. `pulseQuote("^VIX", "VIX")` hits Yahoo chart API (`:57-58`, `:66-67`: `query1.finance.yahoo.com/v8/finance/chart/^VIX`)
3. Room engine stores `pulse.vix` every 5 min (`room-engine.ts:683-687`); catch leaves prior/null — no invent
4. `vixWeather(null|NaN|≤0)` → `{ band: "none", intensity: 0, label: "No VIX pulse" }` (`floor-props.ts:143-144`)
5. Scene draws **no** weather without a VIX (`floor-overhaul.ts:326-327`, comment `:8`)

**Claim “real VIX” is true** for Chunk A weather (not a fabricated constant).

**Should-fix (Accuracy / feed tags):** Weather dial and VIX ticker tile show `VIX 12.34 · Storm` / weather band (`floor-overhaul.ts:611`, `floor-props.ts:260-261`) but **do not** say **Yahoo / Y!** or show pulse lag/`at`. Desk convention tags feeds LIVE / Y! / DB / SYN. Yahoo is delayed structure — label the VIX tile/sub like the existing floor feed chip (`trading-floor-tab.tsx:263-266` already says “DELAYED · Yahoo” for the main feed).

**Related (pre-existing, not introduced here):** war-room **windows** still fall back to VIX **16** when missing (`floor-screens.ts:814`). Overhaul path correctly refuses that default; consider aligning windows in a follow-up.

---

## (3) Liquidity runways + puck — **PASS**

`liquidityTrack` (`floor-props.ts:187-227`):

- **PDH / PDL** by desk level **name** (`isPdh` / `isPdl`)
- **BSL / SSL** = nearest **pool** levels above/below price (not invented)
- **DRAW** only if desk draw exists and isn’t already a lane
- **Puck** = price mapped onto scale of real lanes + px; pad only expands axis (`:213-215`), does not invent levels
- **Taken** from tape `dayHigh` / `dayLow`
- Absent levels → `missing[]`; footer draws `not in desk levels: …` or `SYNTHETIC FEED — not a price` (`floor-overhaul.ts:724-725`)

Tests: nearest-pool selection, missing list, null price → null track (`floor-overhaul.test.mjs`).

---

## (4) Killzone clock / Judas / DST — **PASS**

- Segments scanned minute-by-minute from `resolveKillzone` (`floor-props.ts:53-71`) — cannot disagree with HUD killzone id (tested)
- Wall clock via `etWallParts` → `Intl` **`America/New_York`** (`sessions.ts:74-99`) — **DST by construction**
- Judas note when `clock.judas`: `"Judas window 09:30–09:45"` (`floor-props.ts:112`); `isJudasWindow` is 09:30–09:45 ET minutes (`sessions.ts:246-249`)
- Weekend / holiday / Globex / blackout notes from TalkWorld clock (`:108-111`)

---

## (5) Ticker wall feed tags — **PASS** (should-fix: short tags)

`feedTile` (`floor-props.ts:245-249`):

| `feed.kind` | Shown | Tone |
|-------------|-------|------|
| `live_gateway` | **LIVE** | up if lag ≤30s |
| `yahoo` | **YAHOO** | warn (never LIVE) |
| `databento` | **DATABENTO** | warn |
| `synthetic` | **SYNTHETIC** | down |
| else | **NONE** | — |

Synthetic banner on wall/banners/tracks (`floor-overhaul.ts:656-661`, `:724`, `:765-767`). SYN/Y! are **not** painted as live.

**Should-fix:** map to desk short tags **Y!** / **DB** / **SYN** for consistency with CLAUDE.md / Accuracy chrome (keep semantics; shorten labels).

---

## (6) Sound bed — **PASS**

- Master pref **`on: false` by default** (`floor-sound.ts:91-97`); remembered in `localStorage`
- `ensure()` requires user gesture / AudioContext (`:212+`) — autoplay-safe
- Six layers independently muteable (`BED_LAYERS`, UI in `trading-floor-tab.tsx:1370+`)
- Weather silent without VIX band; tape/clock gated by mutes + killzone
- No network / order side effects — Web Audio only

---

## (7) No order / arm / env path — **PASS**

Grep of new overhaul modules: **no** `place_*`, `RH_LIVE`, `AUTOFIRE_ENABLED`, or POST fetches.

Manager glass monitors **display** existing `ManagerRoomState.arms` as status text only (`floor-overhaul.ts:938`: `arms: autofire … · live …`) — read-only chrome, does not flip env or place.

Paper book / ROOM PAPER banners remain paper; RH account lines reuse existing `readRhAccount` freshness (“not a live read” when snapshot).

---

## (8) Suites (sequential, memory-gated)

| Suite | Result |
|-------|--------|
| `npm run typecheck` | **exit 0** |
| `node --test scripts/floor-overhaul.test.mjs` | **7 / 0** |
| `npx tsx scripts/verify-live-talk.mjs` | **111 / 0** |
| `npx tsx scripts/verify-room-exec.mjs` | **222 / 0** |
| `npx tsx scripts/verify-repo-guards.mjs` | **59 / 0** |
| `npx tsx scripts/verify-floor-cues.mjs` | **35 / 0** |
| `npx tsx scripts/verify-floor-voice.mjs` | **pass** (voice/gender checks) |
| `npx tsx scripts/verify-rh-autofire-gates.mjs` | **218 / 0** |
| `npx tsx scripts/verify-rh-path-fire.mjs` | **111 / 0** |
| `npx tsx scripts/verify-manager-live-loop.mjs` | **58 / 0** |
| `npx tsx scripts/verify-floor-rh-account.mjs` | **21 / 0** |

---

## Blocking vs should-fix

### Blocking
*None.* Chunk A props are fail-closed on missing data; VIX path is real `^VIX` via Yahoo; no order path; empty shelves are honest; suites green; merge onto main is conflict-free on files.

### Should-fix (non-blocking)
1. **Label VIX source + delay** on weather dial / VIX ticker tile (Yahoo / Y!, lag or `pulse.at`) — `floor-props.ts:260-261`, `floor-overhaul.ts:611`.
2. **Short feed tags** LIVE / Y! / DB / SYN on the ticker FEED tile (`floor-props.ts:246`) to match desk convention.
3. **Follow-up:** remove war-room window default VIX `16` (`floor-screens.ts:814`) so all Floor VIX presentation matches overhaul honesty.

---

## Verdict: **APPROVE** `259d34d`

Floor batch A is presentation-only over real TalkWorld / room book / Yahoo `^VIX` pulse, with honest empties and synthetic flags. Safe to merge onto current `origin/main` (rebase/merge past `0f83a1a` research brief first). Prefer landing the VIX/Y! label polish in the same PR or an immediate follow-up.

*Reviewer: Grok Bot executor. Read-only.*
