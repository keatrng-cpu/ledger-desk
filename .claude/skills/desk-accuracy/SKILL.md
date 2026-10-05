---
name: desk-accuracy
description: The Ledger Desk's rules for numbers. Use whenever a figure from outside the repo enters the desk (research, market data, a research-file refresh, a figure on a TV or in a spoken line), when any calculation, projection, option price or backtest result is reported, or before using a finance skill (return-calculations, time-value-of-money, performance-metrics...). A model may find, read and explain a number; it may never be the source of one.
---

# Desk accuracy

The desk's standing rule is 100% accuracy and no model in the scoring loop. A model (you included) may find, read and explain;
it is never the source of a number. These are the working rules that follow.

## 1. A figure comes from a page, with a date

- Store every outside figure with: the value as the source states it (units included), what it measures, the source's name, an
  https URL to the primary page or table (an agency, a filer, a company release — not a summary, a blog or a search snippet) and
  an as-of date. No URL, and it does not go in a file, on a screen or into a spoken line.
- Search-engine and model summaries are leads, not sources. In the 2026-10-05 research pass two were wrong (an IMF forecast with
  its years swapped; a CMS share off by a tenth) and only the primary page was right.
- A headline number gets a second look at an independent source (FRED for a Census series, EDGAR for a filing, the agency's own
  release for a press story).
- Cannot reach it: say "unknown". Never fill the gap from memory.

## 2. Check it by machine, not by confidence

- `npx tsx scripts/check-research-sources.mjs` fetches every page `src/data/invest-themes.json` cites and tests that each number
  in the quoted figure is on the page (years and single digits ignored; a unit conversion counts when the arithmetic rounds to the
  figure). Run it after any edit to a research file and monthly. MISSING or PARTIAL is a finding for a person to read, not a
  verdict. `volatile: true` marks a rolling "latest" page; `manual: "..."` records what a person read where a page refuses
  scripts. Its offline controls are `verify-source-check.mjs`.
- Captured data (`scripts/capture-*.mjs`) writes `capturedAt` and the source. Never transcribe a table by hand. Say how old a
  snapshot is when you quote it (the earnings calendar is committed; dates more than two weeks out are provisional).

## 3. Arithmetic runs in code

- Never do arithmetic in prose. Use `node -e` / tsx for desk maths, or the reference calculators that ship with the finance skills
  (return-calculations, time-value-of-money, performance-metrics, historical-risk, diversification, rebalancing,
  quantitative-valuation, bet-sizing; `python scripts/<name>.py --verify` runs each one's own checks). They are calculators and
  primers, never policy: the desk's hard rules in CLAUDE.md win over anything a skill says about sizing or allocation.
- Units are part of the number. `driftPct` and `sweepRate` are fractions, `ratePct` is a percent, a sweep is dollars and cents.
  Keep full precision inside, round once at the edge, show cents when recorded money has cents.
- A projection is arithmetic, not a forecast: contributions only unless a return is the trader's own stated input.
- Option prices: `blackScholes` (r = 0, VIX-scaled IV) is checked against an independent oracle (`scripts/oracle/bs_oracle.py`,
  `verify-option-math-oracle.mjs`; worst price error $0.0001 per share). It is a model, never a chain quote.

## 4. Verify the verifier

- Prefer a differential test (an independent recomputation) to a fixture of the code's own output. Read what a test SKIPS. Add a
  mutation check, so the test is shown to fail on a wrong answer.
- A new verifier is named `verify-*.mjs`, so `verify-all` and the pre-push hook run it. A check that needs the network is not
  named that way.

## 5. Claims about an edge

- An effect counts only on a day-clustered difference with |z| >= 2, in both halves of the sample, with the number of variants
  tried in the denominator. State n. Fix the rule before the run; never tune on the test period.
- A number that was never measured (n = 0) is called untested wherever it appears.

## 6. What gets said

- Every digit in a spoken line is registered through `Facts`. Talk is narration, never a gate; no model in the poll loop.
- Label synthetic vs Yahoo vs Databento vs gateway data, and say `lagSec`.
- When new data reverses an earlier number, say so explicitly instead of silently contradicting it.

## 7. Skills installed on this machine: what each may do here

- **Finance calculators** (return-calculations, time-value-of-money, performance-metrics, historical-risk, diversification,
  rebalancing, quantitative-valuation, bet-sizing): reference arithmetic with a `--verify` mode. They compute; they never set a
  size, an allocation or a verdict. CLAUDE.md's hard rules win.
- **3D / Blender skills** (37, user-wide): the Floor's look only. They touch no data, gate or number.
- **Reviewed 2026-10-05 and not installed** (so the idea is not silently re-proposed). Read, scanned, not executed:
  - tradermonty/claude-trading-skills (30 reviewed): 18 name an FMP_API_KEY in their files, so they are inert without a paid key.
    position-sizer, futures-position-sizer, drawdown-circuit-breaker and pre-trade-discipline-gate are a second set of the desk's
    own sizing, halts and checklist; two sets of rules disagree. breakout-trade-planner writes an Alpaca bracket the desk's
    checklist never sees (the author's own warning). The screener and breadth family is single-stock swing, not MNQ/ES or the
    QQQ/SPY sleeve.
  - staskh/trading_skills: the ib_* modules, `broker/stop_loss.py`, `zero_dte*.py` and its MCP server place Interactive Brokers
    orders. Orders reach a broker only through the Execution card (src/lib/room/exec).
  - himself65/finance-skills: the TradingView plugin opens a DevTools session and reads browser cookies; the social readers need
    a logged-in session; the rest reads Yahoo, which the desk already labels and lags.
  - agiprolabs/claude-trading-skills (68): Solana DeFi, swaps via Jupiter, wallets. Not this market.
  - zubair-trabzada/ai-trading-claude: a model writes the Trade Score, the entry and the exit. That is the number this desk refuses.
  - backtest-expert: clean scan, no network. Not installed: its 0-100 Deploy/Refine/Abandon score is the author's own weighting;
    the bar here is section 5.
- **An idea that is worth testing** (COT crowding from cot-contrarian-detector, breadth, regime) enters as a measurement script on
  the four-year capture with the rule fixed before the run (like scripts/measure-*.mjs), reports n and a day-clustered z, and
  only then does a person decide. Never as a gate, a score weight or a skill's verdict.
