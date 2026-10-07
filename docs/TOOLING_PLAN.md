# Tooling plan: the GitHub apps, skills and libraries, what they do for the floor and the brain, and where each stands

Written 2026-10-07 after auditing what Grok added (screenshots of its own write-up, the trader's two pasted lists, and the files that actually landed).
Status words are literal: **DONE** has a verifier and a mutation check, **NEXT** is designed and not built, **YOURS** needs the trader's hands
(an account, a secret, a decision), **DECLINED** has a stated reason. Rules that do not move: `config.ts` is not edited by a tool, no model in the
poll or scoring path, no order path in the lab, a change to a number waits on a day-clustered |z| >= 2.

## What was found (before any new work)

| Item | Finding |
|---|---|
| Lab (`brainlab/`, Python) | Real code, careful (selfcheck asserts no order call), but **not installed anywhere** and read by **nothing** in the live desk. |
| `docs/pending-workflows/pr-agent.yml` (NOT YET INSTALLED, see README there) | Public repo: **any GitHub user** could comment `/review` and spend `OPENAI_KEY`; a third-party action ran from a moving branch; a dispatch input was interpolated into a script; no refusals for the floor. |
| `docs/pending-workflows/brain-intake.yml` (NOT YET INSTALLED) | Posted a comment from any stranger's issue; pasted raw issue text (mentions, links, HTML) into a public comment; "short" won whenever the word appeared, even beside "long". |
| `gate.py` | A Python copy of the desk's order gates with no check that it matched: a typed-in `debit` (the page passed a fixed 200 whatever the quote) could call a $102 ticket "usable"; no 1-4 contract cap, no DTE, no B+ one-contract rule. |
| `fills.py` | An unusable (never sent) ticket could be "filled"; a ticket could be filled twice. |
| `legs.py` | Equal highs (a double top, ICT's "equal highs") produced no swing; consecutive same-side swings dropped a leg. |
| `rhread.py` | Read buying power of the login's **default** account (the Individual one, $11.56), not the Agentic one the desk trades. |
| `memory.py` | Chroma sends anonymous usage telemetry by default. |
| Arm switch (`rh-autofire.ts`) | Unset = armed (the trader's call, 2026-10-07), but any unrecognized word ("disabled", "nope", a typo) also **armed**. A kill switch failed open. |
| Secrets | The full history (536 commits) had never been scanned. First scan: **no real credential**; 11 generic-rule false positives (storage-key names, a platform preview OAuth client). |
| `graphify-out/` | 9,000+ generated files and 32 MB in a public repo. |
| Robinhood execution | There is no in-repo executor and the lab must not gain one. Orders go through the desk's gated agent (`review_option_order` then `place_option_order`). |

## Done this session (each has a test; the count is the list)

Guards and the front door
1. PR-Agent only runs for an owner, member or collaborator.
2. PR-Agent is pinned to the v0.47.0 release commit.
3. A dispatch input reaches the script through env, not interpolation.
4. PR-Agent has a timeout and a concurrency group.
5. `.pr_agent.toml`: the same refusals CodeRabbit has (never lower the floor, no model in the poll, no order path, narration-only modules).
6. Brain-intake reads only an owner/member/collaborator's issue.
7. Brain-intake has a timeout and a concurrency group.
8. Intake comments cannot ping (`@` broken), link, or render HTML; the body is capped.
9. Intake: both a long and a short written = no side taken.
10. Intake: "put"/"call" count only beside a strike, an option word or a dollar amount ("call me at 5pm" is not a call).
11. The Probot variant passes `--title=...` so a body starting with `-` is not an option.
12. CodeRabbit: narration-only rules for the school grader, ledger, focus-pick and keep-live.
13. CodeRabbit: rules for `.github/**` (public repo, association gate, pinned actions, env not interpolation).
14. CodeRabbit: rules for the lab (constants must match TypeScript; read-only robin_stocks).
15. The arm switch fails CLOSED on any word that is not clearly yes (unset/blank still armed).
16. Throttle guard: one Robinhood placement per 60 s (the trader's number); a future timestamp refuses.
17. Drawdown breaker: no new entries when the account is down the desk's own `dailyLossLimitPct`; says flatten is advised, never places.
18. Both inputs flow through the candidate, `proposeRhFromPathFire` and `proposeRhFromManagerFeed`.
19. `security.yml`: Gitleaks (SHA-256 pinned download) over the whole history, and Bandit, on every push and PR. **Written but not installed:** GitHub refused the push (the token has no `workflow` scope), so the three hardened files wait in `docs/pending-workflows/` and `main` still runs the old workflows. Install steps are in that folder's README.
20. `.gitleaks.toml`: default rules ON; the 11 reviewed false positives allowlisted one by one with a reason.
21. Gitleaks full-history scan run locally: **no leaks found** with the config.
22. Bandit over `brainlab` and `gateway`: 12 findings, all Low; CI fails on Medium and above.
23. `scripts/verify-tooling-guards.mjs` (30 checks) pins 1-22 so none can quietly loosen.

The lab (Python, 64 self-checks in `brainlab/selfcheck.py`)
24. The debit is derived (ask + 2c) x 100 x contracts; a caller's debit must agree with the ask or the limit.
25. 1-4 contracts enforced.
26. DTE 0 or 1 enforced when given.
27. B+ is exactly one contract.
28. Debit floor and cap judged on the real cost.
29. A crossed market is a bad quote; a quote older than 15 s is stale (exactly 15 s is not).
30. An unusable ticket cannot be sent or filled; a ticket is not filled twice; a zero fill is refused.
31. Signal-to-send and send-to-fill latency.
32. Slippage report (mean, median, p90, worst) with a Welch test of the last 10 fills, printed only with 20+ fills.
33. Swings: an equal high or low is a swing.
34. Swings: consecutive highs (or lows) collapse to the extreme before legs are paired.
35. Chroma telemetry off.
36. Ledger export becomes notes (graded cards only) and is indexed.
37. Similar-card recall, every hit marked `similarity_only`.
38. The desk's own 15m bars are loadable beside Yahoo's, and `compare_bars` reports the gap in points and in bar-ranges.
39. `rhread` reads the trade account's buying power; an unreadable field is `None`, not 0.
40. `.env` loading (python-dotenv), `.env.example` with names only and a warning not to store the MFA seed.
41. Windows test hygiene (Chroma's mapped file no longer breaks cleanup).
42. `npm run lab:setup | lab:check | lab:security | lab:crosscheck`.
43. `scripts/verify-lab-constants.mjs` (22 checks): every number the lab copies equals its TypeScript source, no order call, no stored credential.

Accuracy and the brain
44. **The desk's FVG detector, checked against an independent library** (`smartmoneyconcepts`): 151 of 151 MNQ and 140 of 140 ES gaps over 2,000 bars agree on direction, third candle and bounds. The library's extra gaps are the small ones the desk filters out by design. Run `npm run lab:crosscheck`.
45. **Sponsored gaps, PB's tiers and if-then** (`sponsored-gap.ts`): the 1h/4h sponsored gap on the card's side is the map; price in or within 0.5 ATR of it is "in play"; the 1-5 minute inverse inside it is the trigger; the structure it defends is the invalidation. Both sides.
46. Blake and Patty grade it as a preference (never a refusal); ICT and TJR do not carry it.
47. Sterling says PB's map first on a new card.
48. The desk's "sponsored" tag is proven equal to its definition (middle body >= 1.5 ATR) on real stored bars: 18 sponsored and 24 plain MNQ arrays, 15 and 19 on ES, none wrong, none missed.
49. `ledgerExport` and `ledgerStats` (with the "too few cards for a rate" warning below 20).
50. Brain-tab panel: the high-alert ledger, Copy and Download.
51. A cross-language test: the TypeScript export is read by the Python lab's `ledger_notes` and exactly the graded cards become notes.
52. The Graphify parse cache is no longer tracked.

## Tools looked at and not installed (reasons)

| Tool | Why not |
|---|---|
| `smart-money-concepts`, `fvg-detector`, `pylimits` | **Do not exist on PyPI** under those names. The real SMC library is `smartmoneyconcepts` (installed, vetted, pinned). An FVG is a three-candle gap, so no package was needed; the circuit breaker is custom (above). |
| `pydash` | A lodash clone. It has nothing to do with secrets; `python-dotenv` is what loads `.env`. |
| `ccxt` | Crypto exchanges. The desk trades CME futures and ETF options. |
| `backtrader` | Unmaintained since 2019. |
| `vectorbt` | A second backtester beside the four-year evidence pipeline (day-clustered, |z| >= 2, a family bar for the number of tests). Parameter sweeps are how a floor gets moved by noise. The TJR-sweep-inside-ICT-OTE hybrid is tested in that pipeline, not here. |
| TruffleHog | Redundant with Gitleaks here; its "verify" mode would send any found key to the provider's API. If added: `--no-verification`. |
| robin_stocks for ORDERS | The lab stays read-only. The unofficial client's login grants full trading ability to the process, so no order path in Python. Orders stay with the desk's gated agent. |
| MetaTrader 5, websocket quotes, pandas-ta indicators | Dormant by design in the lab (MT5 fails closed off Windows terminals, the socket needs a real URL, ATR only). Not extended. |

## Next: the floor

**The full, ordered plan (25 items, six runs, with checks and budgets) is `docs/FLOOR_PLAN.md`. The notes below are the earlier reasoning it grew from.**

The floor is a Three.js scene with procedural capsule people on a Blender-built `office.glb`. Grok's own review: nothing below helps until the five have a skeleton and a face.
- **NEXT, Blender path (the one that keeps the names the floor looks up):** a real head (blendshapes: viseme set, brow, blink) and a joint skeleton on each of the five in `scripts/blender/build_floor.py`; rebuild `office.glb` and portraits. Blender 5.0.1 headless is the exporter. `bpy` wants Python 3.11; this machine runs 3.14, so use Blender's own Python.
- **NEXT, after the rig:** map the spoken line to visemes. Audio2Face (ACE) is an open-source audio-to-52-blendshapes model and would drive an ARKit-style head; it needs a GPU or NVIDIA's cloud. Cheaper first: drive the existing visemes from the text through `spoken-form.ts` (the line is already digit-checked), no GPU.
- **NEXT, floor screens:** put the sponsored-gap read and the delivery line on the scanner TV (`floor-screens.ts`), and the ledger's last three lessons on the lounge TV.
- **DECLINED, Godot/Spline/ComfyUI-3D/InstantMesh/Tripo as a replacement:** each throws away the A* walk, the contract zones and the named screens, or produces meshes the runtime cannot find by name. Tripo P2 (quads) is acceptable for ONE prop or a head blank that a person then rigs and renames.
- **DECLINED, chat-to-animation clip libraries:** a clip does not know whether the sweep was real. The line-to-gesture map (point on a sweep, marker on the CE) already does it from facts.

## Next: the brain

- **NEXT, bridge the ledger to the lab automatically:** the ledger lives in the browser. Add a server copy (the `room_snapshot` pattern) so it fills with every tab closed, and let the lab read it.
- **NEXT, Chroma "cards that read like this one" on the Brain tab** (display only, labelled similarity): fed by `index_ledger`. The Floor's own recall (same model and side, counts) stays the voice.
- **NEXT, slippage book from the journal's real fills** (`recordRealFill`) instead of a second SQLite store; the Welch test already exists in `fills.py`; port the report to TypeScript or export fills to the lab.
- **NEXT, the schools' gate:** still narration only. Plan and the fixed decision rule are in `ledger-desk-school-brief` (memory): measure first on the four-year cards, refuse-only, never promote or size up.
- **NEXT, TJR-sweep-inside-ICT-OTE hybrid:** a claim in `scripts/measure-model-claims.mjs` with the rule fixed before the run.
- **NEXT, Graphify:** keep the report and the `obsidian/brain` notes; the 9,000 per-symbol notes and the 12 MB `graph.json` are regenerable and could be untracked (Grok's call).
- **DECLINED, GitPython auto-commits of anything but a slippage note**; `gitnote.py` already refuses the floor file and any push.

## Yours (these need your hands)

1. **Install the CodeRabbit GitHub App** on `keatrng-cpu/ledger-desk` (the config is in the repo; the app is what reads it).
2. **Add the `OPENAI_KEY` repository secret** if you want PR-Agent. Without it the job says so and stops.
3. **Create `brainlab/.env` yourself** from `.env.example` if you want the read-only quote script. Never paste credentials into chat. Do not store the MFA seed; use a one-time code for the run.
4. **Pass the two circuit-breaker inputs** from the Robinhood agent: `lastPlaceAtMs` (when it last placed an order) and `dayPnlPct` (the account's P&L today as a fraction, from `get_portfolio`). Absent means "not asserted"; the throttle and the drawdown stop only bite when they are passed.
5. **Decide the schools' gate** once the measurement exists.

## Hosting the lab 24/7: looked at 2026-10-07, not built

The idea: a free cloud host running a Python daemon (a `robin_stocks` option-chain scanner, GitPython auto-commit, Obsidian sync) in a Docker/PM2 loop. Checked against the hosts' current pages and docs; where sources disagreed, the claim is marked.

| Option | What a search of its current terms found | Fit |
|--------|-------------------------------------------|-----|
| [Render free](https://render.com/docs/free) | Spins down after 15 min with no inbound traffic; local disk is lost on every spin-down, restart or deploy; 750 free hours a month; no persistent disk, no one-off jobs. | Cannot be a 24/7 daemon. |
| Railway | A 30-day trial with $5 credit, then Hobby at $5 a month; sources disagree on whether any permanent free tier exists (confirm on railway.com/pricing). | Not free. |
| PythonAnywhere free | No always-on tasks; outbound internet limited to an allow-list; 100 CPU-seconds a day; scheduled-task terms conflict between sources. | Cannot reach Databento, Yahoo or Robinhood. |
| Hugging Face Spaces | Not checked this pass. | Unverified. |
| GitHub Actions on this public repo | Scheduled workflows run free; GitHub disables them after 60 days with no repo activity ([docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)), which this repo's push rate prevents. | The one free option that fits (below). |

**Decisions**
1. **No free always-on host.** The desk does not need one: Netlify (Pro) runs `room-step` every 5 minutes and `exec-flatten`, Supabase holds the books, and the gateway stays on the trader's PC (the trader declined cloud for it on 2026-10-01).
2. **`robin_stocks` is not installed.** It is an unofficial wrapper (Robinhood publishes no public API; the project's own README warns it places orders without the app's confirmations), needs the account password and an MFA code or seed on whatever host runs it, and unofficial access is the commonly cited reason for account restrictions. The ToS wording was read second-hand, not from Robinhood. The desk's order path is the external agent through `review_option_order` and `place_option_order`; a second Robinhood login on a free third-party host would add a credential and no capability. Real option quotes come from Alpaca's indicative feed in the Execution card's shadow phase (an official API key the trader sets), which is also what prices the Black-Scholes model's error.
3. **The free thing that fits is GitHub Actions**, credential-free: `npm run lab:check`, the weekly `scripts/check-research-sources.mjs`, and `verify-all` on every push, so a red verifier is visible on the commit instead of only in a local hook. Not written yet: it cannot be pushed without the `workflow` scope (see `docs/pending-workflows/README.md`), and `verify-all` reads `.cache` captures that are not in the repo, so a CI run needs a decision on which verifiers can run there. Install the three pending workflows first.
4. **No Dockerfile.** Docker is not installed on this machine, so an image could not be built or run here; an untested Dockerfile would be a claim, not a deliverable.
5. **Auto-commit stays local.** `brainlab/gitnote.py` refuses the floor file and any push. Pushing from a cloud host to a public repo needs a deploy key and a review of what it may write; not done.

## Multi-agent LLM desks (CrewAI, AutoGen, Langflow/Flowise, GitHub Actions cron): declined, 2026-10-07

Proposed: a CrewAI or AutoGen "crew" of model-backed nodes (Anthropic, OpenAI, xAI) that analyse the market and place Robinhood orders through `robin_stocks`, woken by a GitHub Actions cron every 5 to 15 minutes, with Langflow or Flowise as a visual builder. Not installed, for these reasons, so the idea is not re-proposed without a new one:

1. **A model decides and places.** The desk's standing rules are that scoring is deterministic, no language model sits in the poll or the decision path, a model never overrides a gate, and a model never changes a number (the account rule is stricter still: accuracy has to be 100%). In that design the agents choose the strike and the quantity and send the order. The Grok, Claude and Discuss narration stays narration for exactly this reason.
2. **The sample code fabricates.** Its market tool returns a hard-coded sentence about EUR/USD, and its order tool returns "Successfully executed" without sending anything. A loop built on that would report fills that never happened, which breaks the desk's first rule (never invent fills).
3. **Debate is not edge.** The repo's own rule is to act only on a day-clustered |z| >= 2 difference, and none of the model-opinion features measured so far passed it. Agents agreeing with each other is not a measurement.
4. **GitHub Actions cannot be the sender.** Cron on Actions has a 5-minute floor and is routinely delayed, the place window needs a poll about every 60 seconds, and it would put brokerage credentials in a public repo's secrets with a model reading untrusted headlines (prompt injection) next to the order tool. The brokerage tools live in the agent that holds the Robinhood connector, not in a workflow.
5. **`robin_stocks`** is unofficial (see the hosting note above): the account password and MFA on another host, and account-restriction risk.
6. **Langflow / Flowise** add a web server, more keys and a second place the logic lives, for a pipeline that is already readable in code.

What does fit is already planned: a deterministic sender that polls an authenticated desk endpoint (`/api/desk/rh-cycle`, see the Grok prompt for the RH sender) and runs `review_option_order` then `place_option_order` under the existing gates. A model may read the journal afterwards and write a post-mortem (narration, never a gate); that is the only place a crew framework could sit.

### Revised the same day: an analyst crew is allowed, a firing crew is not

The trader clarified (2026-10-07) that the crew was never meant to fire orders: execution stays desk to Robinhood, deterministic, and never falls back on a model. Scoped that way, a CrewAI (or AutoGen) crew is acceptable for research, analytics, explaining numbers, proposing desk optimisations and Floor enhancements. Conditions, so it cannot drift into the decision path:

- **No order path, no broker code, no broker credentials.** The crew's tools are read-only. A guard test fails if anything under the crew imports an execution, broker or `robin_stocks` module (the lab's `selfcheck` and `verify-lab-constants` already do this for `brainlab`).
- **A model is never the source of a number.** All arithmetic, backtests and calculations run in code (the existing `scripts/*.mjs` and `brainlab` Python); the agents read the result, explain it and propose. The account rule (100% accuracy) stands.
- **Proposals, not commits.** Output is markdown plus draft issues or pull requests. A change to a rule or a number still needs a day-clustered |z| >= 2 measurement and the trader's call; `config.ts` is never edited by a model; no auto-commit to `main` (GitPython stays limited to notes).
- **Schedule: after the close and weekly, not market hours,** from GitHub Actions or locally. Secrets are only the model keys (OPENAI_KEY, ANTHROPIC_API_KEY, XAI_API_KEY), never a brokerage credential. Fetched web text is untrusted, so the crew has no write tool beyond opening a draft PR and a spend cap per run.
- Model names in the pasted sample are out of date: take current ones from each provider's docs. Pin the framework version and verify the install in the lab venv before relying on it.
