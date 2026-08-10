# Phase 3 integration notes (signal quality)

Everything below is ADDITIVE — no exported symbol, type, or field was renamed
or removed. `scanner.ts` and `build-desk.ts` compile unchanged. The wiring
steps here are for the integrator who owns those files.

## 1. Session-correct levels (already live, no wiring needed)

`analyzeStructure` now computes PDH/PDL on true CME sessions
(18:00 ET → 17:00 ET next day, DST-correct via Intl) instead of UTC calendar
dates. `dayOpen` is now the current session's open (first bar after the
18:00 ET roll). New nullable fields on `HtfBiasRead`:

- `pwh` / `pwl` — prior completed trading week (Sun 18:00 ET → Fri 17:00 ET).
  With the default 5d/15m fetch the prior week is only partially covered by
  data; extend the range (e.g. `"1mo"`) if full-week extremes matter.
- `midnightOpen`, `nyOpen830`, `nyOpen930` — 0:00 / 8:30 / 9:30 ET opens of
  the current session's calendar day.

Also exported: `etSessionKey(tMs)` (session bucketing helper) and, from
`sessions.ts`: `etWallParts(tMs)`, `etWallToEpochMs(dateIso, timeEt)`.

## 2. Swing-based SMT — wire into build-desk

`structure.ts` now exports `smtDivergence(leftBars, rightBars, opts?)` and
`smtRead` accepts an optional third argument. In `build-desk.ts` (bars are
already in scope there):

```ts
import { analyzeStructure, smtDivergence } from "./structure";

const divergence = smtDivergence(left.bars, right.bars);
const scan = scanSetups(biasL, biasR, clock); // unchanged today
```

To make the divergence primary, `scanSetups` should be extended (by the
scanner owner) to accept and forward it to `smtRead(left, right, divergence)`.
Until then, calling `smtRead(biasL, biasR, divergence)` directly anywhere
gives the enriched read; the two-arg form behaves exactly as before.

Semantics: `leader` = the index that printed the new extreme (the sweep);
the returned `edge` sits on the index that HELD (relative strength for
bullish SMT, relative weakness for bearish). `state` strings are unchanged
(`bullish_smt` / `bearish_smt` / `locked` / `relative_*`), so scanner string
checks keep working.

## 3. Ladder — replace levelsFrom

`referenceLevels(read)` in `structure.ts` supersedes build-desk's local
`levelsFrom`. Same return shape (`{name, price, kind}[]`, sorted desc) but
adds PWH/PWL, session open, midnight / 8:30 / 9:30 opens. Swap:

```ts
import { referenceLevels } from "./structure";

levels: [
  { symbol: left.symbol, items: referenceLevels(biasL) },
  { symbol: right.symbol, items: referenceLevels(biasR) },
],
```

New `kind` values to style in the ladder UI: `"weekly"` (PWH/PWL) and
`"open"` (already used for Day open).

## 4. News gate — mount the chip

- Data: `src/data/news-calendar.json` (verified US releases through
  2026-09-16; maintenance procedure in `src/data/news-calendar.md`).
- Logic: `newsRead(now, calendar?)` in `src/lib/trading/news.ts` —
  `blackout` (high ±15 min) / `caution` (high ±60 or medium ±15) / `clear`,
  plus `nextEvent {name, timeEt, minutesAway}`.
- UI: `<NewsChip />` from `src/components/desk/news-chip.tsx` is
  self-contained (ticks every 30 s client-side). Mount it in
  `session-hud.tsx` next to the killzone chip:

```tsx
import { NewsChip } from "@/components/desk/news-chip";
// inside the HUD chip row:
<NewsChip />
```

Optional server-side gate: call `newsRead(new Date())` in build-desk and add
a `blocked` entry when verdict is `blackout`, so the scanner's focus line
reflects the news halt too.

## 5. Config note

`tsconfig.json` gained `"resolveJsonModule": true` (needed for the calendar
import; Vite already supported JSON at runtime).
