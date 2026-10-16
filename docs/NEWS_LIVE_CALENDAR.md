# Narration & context features (2026-10-16)

Keaton: "Build all of these but don't affect the scoring, this will be nice for reasoning."

Nothing below changes scoring, PATH bands, `config.ts`, sizing, RH autofire gates or orders.
`RULES_HASH` stays `9eeed9b4083700cb` and `shared/desk-rules.json` is byte-identical (asserted in
`scripts/narration.test.mjs`). The only edit to `src/lib/trading/news.ts` is exporting the existing row validator
(`isNewsEvent`) so the live job validates rows the same way the bundled file is validated.

## 1. WS-CAL — live release calendar (`NEWS_LIVE_CALENDAR`, default OFF)

- `src/lib/news/calendar-live.ts` fetches the BLS ICS, the BEA ICS and the Fed FOMC page, parses them into
  `NewsEvent` rows, validates them (`isNewsEvent`, date window, 07:00–16:00 ET, ≥ 6 rows ahead, an FOMC decision
  ahead), aligns names with bundled rows at the same date and minute, and diffs them against `src/data/news-calendar.json`.
- Cron: `GET /api/cron/news-calendar`, weekdays 08:00 ET (12:00 and 13:00 UTC in `vercel.json`, with an ET-hour guard).
- Requests carry an identifying User-Agent (`CALENDAR_USER_AGENT`, else a default naming the repo). **BLS returned 403
  to the build box even with that UA** (Akamai). If BLS refuses in production too, the run fails and the bundled file
  stays in charge. Setting `CALENDAR_USER_AGENT` to something with a real contact address may get through (BLS asks
  for that). That hasn't been proven.
- Grok (web search) only cross-checks the next high-impact rows against the agency pages. The result is logged and
  never edits, adds or drops a row.
- Any fetch, parse or validation failure means the bundled file stays the calendar.

### The flag: what turning it on does

`NEWS_LIVE_CALENDAR=1` hands validated rows to `setLiveCalendar`. `newsRead` then merges them over the bundled file
for 24 hours (`LIVE_CALENDAR_MAX_AGE_MIN`). **That changes what the ±15-minute blackout sees, so it can block or allow
fires.** Leave it off until the daily logs (`[cron] news-calendar`: `onlyLive`, `onlyBundledHigh`,
`grokDisagreements`) have matched the agency pages for a while.

Serverless caveat: `setLiveCalendar` is module state, so with the flag on, the rows only reach the instance that ran
the cron. To make the live calendar reach every desk build, the rows need to be persisted (e.g. a small table) and
read where the desk is built. That isn't done here on purpose, because it's the step that changes fires.

## 2. Actuals → `week-prints.json`

`src/lib/news/actuals.ts` and `scripts/stamp-actuals.mjs`:

```
npx tsx scripts/stamp-actuals.mjs --date 2026-11-10            # dry run
npx tsx scripts/stamp-actuals.mjs --date 2026-11-10 --write    # append (never overwrite)
npx tsx scripts/stamp-actuals.mjs --date 2026-11-10 --write --grok   # Grok writes the note prose only
```

- CPI / PPI / Employment Situation come from the BLS Public API v2 (`BLS_API_KEY` optional), computed by code: m/m
  from SA, y/y from NSA, and payroll change from the level. `vs` is the prior period only, because there's no
  official consensus feed.
- GDP / PCE come from the BEA API (needs `BEA_API_KEY`; without it they're skipped and reported).
- A Grok note carrying any number the code didn't compute is replaced by the deterministic note.
- The rows feed `week-ahead.ts` → `live-world.ts` calendar TVs and `session-brief.ts` with no code change.
- It's a script, not a cron, because a serverless function can't write a committed data file.

## 3. Shock explainer

`src/lib/news/shock-explain.ts` (+ `shock-explain-server.ts`). The flow: a ≥ 3×ATR candle with no calendar row
within ±15 min, then Grok web search names the headline, then the Floor (`exShockExplain`, Gemma + Sterling) says it,
crediting the source host. A headline is only accepted with citations and only when every digit in it appears in a
cited title or the tape facts. Otherwise there's no headline, and the room's existing tape lines stand alone.
`shock.ts`, its lock, its lean and `ShockBias.headline` are untouched.

## 4. Pulse: term structure + FRED

`news-server.ts` `PULSE` adds `^VIX9D`, `^VIX3M`, `^VVIX` (Yahoo, same delayed path), and the code adds FRED `GDPNOW` and
`T10Y2Y` (API with `FRED_API_KEY`, else fredgraph CSV; cached 6 h). `pulse-regime.ts` computes VIX/VIX3M (IVTS) and
contango/backwardation. These feed:

- Floor `exPulse` (a term-structure line and a 2s10s/GDPNow line, only when those values are present), and
- the journal: `AnalyticsTrade.volStructure` → `AnalyticsReport.byVolStructure` (display slice). Recording
  `volStructure` per trade needs a column and a writer, so the slice stays empty until that follow-up lands.

`mandate.ts` still reads spot `"VIX"` only. Nothing sizes or vetoes on these values.

## 5. Weekly cost summary

`GET /api/cron/weekly-cost`, Sunday 18:30 ET. It reads the week's closed live fills, runs `disciplineScorecard` and
`buildAnalytics`, and prices the leaks: rules followed vs broken, costliest mistake, tilted clicks, trades taken
against the desk's word, worst killzone/weekday, friction, and expectancy. Grok narrates those lines, and any extra
number in its text drops the narration for the deterministic lines. No badges, streaks or scores.

## Keys (presence only, never printed)

`XAI_API_KEY` (narration), `CALENDAR_USER_AGENT`, `BLS_API_KEY` (optional), `BEA_API_KEY`, `FRED_API_KEY` (optional),
`NEWS_LIVE_CALENDAR` (default off).
