# The Floor — 66 fixes, by category (2026-10-05)

The trader asked for 20–50 categorized fixes: trading accuracy, how the five communicate and plan, the war room's details and
interactivity, more offices for roles that were missing, and agents that are always working to make money, raise the odds, work
toward the goal and find what the desk needs. **Shipped** means it is in the tree and covered by a verifier or the headless
check named; **Backlog** means it is not built, with the reason.

Nothing here changes a number in `src/lib/aplus/config.ts`, a gate, a size or the Execution card's limits. Where an item touches
trading accuracy it is a measurement, a diagnostic or a fix to something that mis-reported — never a new edge claim.

## A. Navigation and interactivity

| # | Fix | Status |
|---|-----|--------|
| 1 | Click a person: the camera follows them in third person (behind and above, first clear spot) | Shipped — `follow()`, `nav-annex` e2e |
| 2 | The chase rides with their movement; the viewer's orbit and zoom survive; a wall between lens and person pulls the lens in | Shipped — rig ride checked through a door, `nav-annex` e2e |
| 3 | Esc, the Stop button or any camera preset lets go | Shipped — `tab-ui` e2e |
| 4 | Double-click a screen, the board or a TV: fly to it, framed to fill the view | Shipped — `focusScreen()` |
| 5 | Double-click a monitor: its whole workstation bank, from over a shoulder | Shipped |
| 6 | Double-click a desk, chair or keyboard: that person's monitors | Shipped |
| 7 | Follow chips (five people) and Go-to chips (war room, annex, lounge) in the tab | Shipped — `PLACES` |
| 8 | Hover: pointer cursor and a label ("Nova — click to follow", "Setup scanner — double-click to go there") | Shipped — `tab-ui` e2e |
| 9 | Camera presets for the three annex offices | Shipped |
| 10 | Keyboard shortcuts to follow / go to | Backlog — chips and double-click cover it; add if the trader wants them |
| 11 | A hover label on a touch screen (long-press) | Backlog — pointer events only fire hover for a mouse |

## B. War room details and animation

| # | Fix | Status |
|---|-----|--------|
| 12 | **The setup scanner on a TV by the board**: every graded setup in board order | Shipped — `tv_scanner` |
| 13 | Each row: band badge, symbol and side, strategy, entry tier and distance, the missing layer, entry / stop / T1, P(T1), E[R] | Shipped — numbers are the desk's own (`hitOdds`, `readEntry`) |
| 14 | A refused card wears its verdict, not a "skip" band; the card's own futures symbol, not a derived one | Shipped |
| 15 | Frames behind every procedural TV and monitor (a sibling mesh, so the screen texture is not pasted on it) | Shipped |
| 16 | Name plates shrink to fit their width | Shipped |
| 17 | The seat league on a TV in the Goal Room | Shipped — `tv_goal` |
| 18 | The scanner's border pulses when a card is ARMED | Backlog — needs a timed redraw of a text-heavy texture; not worth the cost yet |
| 19 | Bake the annex into `office.glb` | Shipped (2026-10-05) — baked with Blender 5.0.1: 52 nodes and 19 materials added, the `alcove` floor removed (`office_RnD` covers its footprint), the 157 shared nodes unchanged; the runtime still builds any entry flagged `procedural` |

## C. Offices and roles that were missing

| # | Fix | Status |
|---|-----|--------|
| 20 | **R&D Lab**: the desk audit, the proposals for the trader, the ghost room's refusals, the R&D board | Shipped |
| 21 | **Ops & Data**: is the feed real and how late, VIX/10Y, the execution flags, the ops findings | Shipped |
| 22 | **Goal Room**: progress and pace, the exact odds, the contract ladder, the seats' race | Shipped |
| 23 | Owners walk to the office a finding belongs to when they report it (a presentation-only `ANNEX` zone + a spot) | Shipped — verifiers accept it, the cycle contract is unchanged |
| 24 | Sterling and Vince could not walk out of their own offices: each desk sat behind its own door, the walking route was shut and they crossed the glass. `navSize` narrows the walking footprint | Shipped — `verify-room` now walks every door |
| 25 | New characters for the new offices | Backlog — the trader's JSON contract fixes five characters; the offices are worked by the existing five |

## D. Communication, planning and execution

| # | Fix | Status |
|---|-----|--------|
| 26 | Audit findings are raised in turn by their owner, with a reply from someone else, from the right office | Shipped — `exAudit` |
| 27 | R&D verdicts and standups are said from the lab | Shipped |
| 28 | A heartbeat never repeats the one before it | Shipped — `verify-live-talk` |
| 29 | The goal council once each trading morning; the pace flips with hysteresis; a re-plan after 11:00 | Shipped |
| 30 | Seat tickets, passes and blocks are announced as they happen | Shipped |
| 31 | Every digit in every line is registered by code; the verifier rejects one that was not | Shipped |
| 32 | The pace says what it is measured against ("vs the path's mark for the end of today") — it read as "behind" at noon on day one | Shipped |

## E. Agents that compete, cooperate, improve the desk and work toward the goal

| # | Fix | Status |
|---|-----|--------|
| 33 | Five paper seats and The Room race $1,000 accounts on the room's own checklist and exits | Shipped — `verify-room-seats` |
| 34 | Syndicates: two or more seats back one card and share the credit and the blame | Shipped |
| 35 | The whole $20–$300 contract ladder, priced on today's card, for the seats and the goal | Shipped — floors are the trader's |
| 36 | R&D: six experiments with bars fixed in advance, answered on live-forward evidence | Shipped — `verify-rnd` |
| 37 | The desk audit: feed, goal collisions, refusing gates, odds calibration, execution flags, idle seats | Shipped — `verify-audit` |
| 38 | The goal planner: exact odds, the collisions with the rules, what it would take | Shipped — `verify-goal` |
| 39 | A Race panel (Goal / League / R&D / Audit) and the goal's inputs, which are the trader's | Shipped — `tab-ui` e2e |
| 40 | Re-run the four-year test automatically when an R&D proposal clears its bar | Backlog — the offline scripts need the capture data; a proposal says which one |

## F. Trading accuracy (measurement and honesty, not a new edge)

| # | Fix | Status |
|---|-----|--------|
| 41 | The scanner quotes P(T1) and E[R] from the card's model, the fit stays the gate, nothing new is scored | Shipped |
| 42 | The audit's odds-gap bar had a float edge (a gap of exactly ten points was flagged); the bar is now "over ten" | Fixed — `verify-audit` |
| 43 | Feed health is on a wall and in the audit: a late tape makes every level exit and the CE-touch alarm wrong | Shipped |
| 44 | A server-side runner, so a position is managed with the tab closed (`SERVER_RUNNER_BUILT`) | Backlog — needs infrastructure; the audit names it every session until it exists |
| 45 | Real option quotes (Alpaca shadow mode) to judge the Black-Scholes prices against | Backlog — needs the trader's keys and OPRA for live-grade quotes |
| 46 | Measure the hit rate of OTM strikes | Backlog — nothing is measured for them; the ladder is model-priced on one card |
| 47 | Schedule `/api/cron/exec-flatten` on Netlify (it is wired for Vercel) | Scheduled — `netlify/functions/exec-flatten.mjs` is copied into Nitro's function dir on build. It calls the route and does nothing until `CRON_SECRET` is set and the phase is paper or live |
| 48 | Move the PATH bands or the 0.65 floor onto P(T1) | Backlog — needs the trader's numbers in config.ts; not an AI change |

## G. The investment wing (the trader's request, 2026-10-05)

The long game: the five managing a mid-to-long-term portfolio funded by a share of day-trading income and other income. Same rules as the rest of the desk — narration and arithmetic, a source on every figure, no verdict word, no order, no recommendation, the sleeve targets and the sweep ladder untouched.

| # | Fix | Status |
|---|-----|--------|
| 49 | An Investment Office, a Boardroom and a Chair's Office south of the building (3 rooms, 6 walls, 32 pieces of furniture, 12 screens, 10 spots, 2 cameras), baked into `office.glb` | Shipped (2026-10-05) — `verify-room`, Blender `--verify` |
| 50 | The five work it in investing hats: Sterling chair/CEO, Nova CIO, Jax scout, Gemma news and evidence, Vince structure | Shipped — `live-voices-invest.ts` |
| 51 | THE LONG BOOK TV: the three sleeves against the trader's own targets, the research tiers the book covers, the next dollar — valued at cost, and it says so | Shipped — `verify-invest-office` |
| 52 | THE FUNNEL TV: swept, waiting to be bought, the rate ladder, a 1/5/10-year contribution path (contributions only — no return assumed) | Shipped |
| 53 | Other income as a second source into the funnel: two numbers (monthly dollars, the share the trader chooses), arithmetic only, never the Invest ledger | Shipped — panel + `invest-sources.ts` |
| 54 | A dated, sourced research file: 13 themes across safe / mid / high, each demand figure a third party's with a year and a URL; a theme with a wash-sale name or an unsourced figure is dropped at the door | Shipped — `invest-themes.json` (snapshot 2026-10-05) |
| 55 | A theme of the day with a second look; the TVs and the talk read the same pick | Shipped |
| 56 | The boardroom: THEME OF THE DAY and THE BOARD (the org chart and tonight's agenda, the same list the board speaks) | Shipped |
| 57 | Headlines that touch a held ticker, a theme's vehicle or a competitor, said as context | Shipped — 45 min apart, never older than 20 h, backlog marked seen |
| 58 | Four research monitors (allocation, themes, the news desk, competitors) and the chair's one page | Shipped |
| 59 | An Investment office panel in the tab: Funnel / Book / Research with every source | Shipped |
| 60 | New people for the wing (a real CEO, analysts) | Backlog — the trader's JSON contract fixes five characters; the wing, like the annex, is worked by the five |
| 61 | The book valued at market on the Floor | Backlog — the Floor fetches no prices; marks load on request in the Invest tab |
| 62 | The weekly kill-rule results and the dossier gate (ADD / WATCH) in the boardroom | Backlog — kill-watch needs the server and a signed-in user; the board says where the decisions live |
| 63 | Other income persisted to the server like the sweep ledger | Backlog — two numbers in this browser for now |
| 64 | Model-made return forecasts | Not built, deliberately — the office quotes third parties' projections with source and date and prints contributions only; a model's return forecast would be an invented number |
| 65 | A refresh cadence for the research file | Backlog — a dated snapshot; re-run the research pass (monthly is the suggestion); the file's `asOf` is on the TV |
| 66 | VTI's benchmark was rebranded from CRSP to Morningstar (Vanguard renamed the fund on 2026-07-29); `universe.ts` and the dossiers still say CRSP | Found in passing, confirmed against Vanguard's own press release — not changed here (the dossiers are the trader's research) |
