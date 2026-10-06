# Desk Implementation Plan — Fold Research into ledger-desk
**Date:** 2026-10-06  
**Rule:** branch-only · no product code in this commit · Dual Desk assigns owners  
**Inputs:** `ai/research/2026-10-06-ny-am-session-brief.md` (main) · `ai/research/2026-10-06-pm-signal.md` (main) · `ai/research/2026-10-06-smc-deep-dive.md` (branch `research/2026-10-06-smc-deep-dive`) · `docs/RH_LIVE_ROUTINE.md` · `docs/FLOOR_BACKLOG.md` · `docs/ENGINE_BRIDGE.md` · `ROADMAP.md` · `smc-canon.ts` · `judas-window.ts` · `profit-path.ts` · `src/lib/aplus/confluence.ts` · `src/lib/room/research.ts` · Trading-Automation `CLAUDE.md` / `aplus/strategy/*` / `knowledge/confluence.json`  
**Note:** `ai/NOW.md` and `ai/DECISIONS.md` were requested; **not present** on main (only `ai/research/`). Gap tracked as WS-KG0.

---

## 1. Goals & success metrics

| Goal | Definition | Measurable success (90-day) |
|---|---|---|
| **Profitability** | Positive fee/slip-adjusted expectancy on PATH-eligible fills | PATH expectancy ≥ **+0.35R** (desk target in `profit-path.ts`); net after fees > 0 on walk-forward holdout; never lower confluence floor to manufacture clears (`confluence.json` cleared 0 @ 0.75) |
| **Probability** | Honest, calibrated odds — not narrative confidence | PATH journal **n ≥ 100**; per-stand WR with Wilson CI; Brier + Murphy REL/RES/UNC on any PM signals; Floor characters only cite pack/model numbers (`research.ts` contract) |
| **Productivity** | Same pre-session work in less wall-clock, fewer misses | Pre-session checklist completion ≥ 90% of NY AM days; session brief auto-published by **08:00 ET**; Judas release false-positive rate logged; ≤1 open question on BP readiness before arm |
| **Intelligence** | Detectors + confluences + calendar + PM scoring compound | Cold detectors diagnosed (bug vs scarce); ≥1 ablation showing optional factor ΔE[R] CI excl. 0 **or** explicit kill; calendar stratifies metrics; PM FLB monitor live for Kalshi bins |

Aligns with `ROADMAP.md`: **sample before size-up / autofire expansion** — n=0 measured PATH trades is still the binding constraint.

---

## 2. Workstreams

Owner labels are **SUGGESTIONS for Dual Desk** (not assignments). S/M/L = rough effort.

### WS-KG0 — Knowledge spine (NOW / DECISIONS / research index)
| | |
|---|---|
| **Build** | Create `ai/NOW.md`, `ai/DECISIONS.md`, `ai/research/INDEX.md` linking the three 2026-10-06 briefs + this plan. Graph Keeper indexes terms → files. |
| **Why** | Inventory gap — SMC deep dive §2.3; no NOW/DECISIONS on main. |
| **Accept** | Agents load NOW each session; DECISIONS lists open locks (CBDR clock, flout, sponsored rename); INDEX has commit SHAs. |
| **Deps** | None |
| **Size** | S |
| **Owner (SUGGESTION)** | Graph Keeper + Research Desk; Dual Desk splits edits |

---

### WS-D1 — Detector contracts + cold / missing detectors
| | |
|---|---|
| **Build / land** | Contract doc `docs/DETECTOR_CONTRACTS.md` (tick tol, body-close vs wick, ET clocks). Code (later PRs): cold — `Trading-Automation/aplus/strategy/order_blocks.py` + ledger ports under `src/lib/trading/` / detectors; missing — OTE (`fib`/scanner), BPR, voids/vacuum, NWOG/NDOG+EHPDA, IPDA 20/40/60, macros (`sessions` / new modules). Rename or document desk `sponsored` (`fvg.py` / weight in `engine-weights.ts`). Lock CBDR clock before coding. |
| **Why** | SMC deep dive §2.1 gaps, §2.3, §5, §9, §11 items 1–3; `knowledge/confluence.json` cold OB/breaker/mitigation/propulsion @ 0–1.4% fire. |
| **Accept** | Each detector: unit tests + no-look-ahead; fire% reported on same NQ window; cold components either fire >0 with verified labels **or** written “scarce — keep weight” decision in DECISIONS.md. OTE/BPR/void/gaps/IPDA/macros each have contract + test **before** weight changes. |
| **Deps** | WS-KG0 (locks); WS-C1 before changing weights |
| **Size** | L |
| **Owner (SUGGESTION)** | Trading Stand (defs) · Dual Desk (Claude vs Grok code split) · Accuracy Review (verify) |

---

### WS-C1 — Confluence ablation + walk-forward + FDR
| | |
|---|---|
| **Build / land** | Harness extending `src/lib/aplus/confluence.ts` + Trading-Automation scanner weights; factor matrix from SMC §10.2; walk-forward folds; FDR / pre-registered optional list; do not lower 0.75 floor. |
| **Why** | SMC §10–11; pm-signal §3 scoring discipline (CI, walk-forward, no snooping). |
| **Accept** | Report: per-factor ablation ΔE[R] + CI; hot components not up-weighted; published “keep / kill / needs-n” table committed under `ai/research/`. |
| **Deps** | WS-D1 contracts for new factors; PATH journal (WS-P1) for live labels |
| **Size** | M |
| **Owner (SUGGESTION)** | Trading Stand · Dual Desk · Accuracy Review |

---

### WS-P1 — PATH journal → n ≥ 100
| | |
|---|---|
| **Build / land** | Journal schema on PATH fires/skips/fills: stand id, factors[], session, event_day, MAE/MFE, R, fees — wire `profit-path.ts` `buildProfitPath` + `src/routes/api/engine/journal.ts` / setup-memory. Dashboard buckets by grade/strategy. |
| **Why** | SMC §2.2 PATH min sample 100; `profit-path.ts` PROFIT_MIN_SAMPLE; ROADMAP “n = 0”. |
| **Accept** | `pathTradeCount` progressing with verifier; by-grade / by-strategy tables populated; incomplete → C still enforced. |
| **Deps** | Stable PATH banding (no silent floor change) |
| **Size** | M |
| **Owner (SUGGESTION)** | Trading Stand · Dual Desk · Prototype Lab (UI) · Accuracy Review |

---

### WS-CAL — Calendar / event filter + recurring session-brief feed
| | |
|---|---|
| **Build / land** | Scheduled prints gate (NFP/CPI/FOMC/…): harden `news` / `src/data/news-calendar.md` + scanner blackout; stratify PATH metrics by event day (SMC §10.4). **Recurring feed:** Research Desk template from NY AM brief → `ai/research/YYYY-MM-DD-ny-am-session-brief.md` by 08:00 ET (econ + levels + headlines + next-up); Floor cue consumes summary. |
| **Why** | NY AM brief §§1–4; SMC §7.4 / §12 news evidence; ROADMAP sample integrity on event days. |
| **Accept** | Blackout fail-closed when calendar unknown; brief checklist items automated or flagged missing; metrics stratified in journal. |
| **Deps** | Bigdata/econ calendar source reliability |
| **Size** | M |
| **Owner (SUGGESTION)** | Research Desk (briefs) · Trading Stand (gates) · Dual Desk · Site Copy (brief voice) |

---

### WS-PM — Prediction-market signal engine (minimal)
| | |
|---|---|
| **Build / land** | New module tree e.g. `src/lib/pm/` (or `aplus/research/pm/` offline): (1) price-bin FLB monitor Maker/Taker; (2) horizon MAE/Brier curves; (3) Murphy REL/RES/UNC + reliability diagram; (4) Kalshi fee calculator; (5) walk-forward harness. **No autofire** until Accuracy Review signs post-fee edge. |
| **Why** | pm-signal §4 “What to build first”; fee schedule caution. |
| **Accept** | Each of 1–5 runnable offline with cited inputs; dashboard panel or research artifact; open questions from pm-signal listed in DECISIONS. |
| **Deps** | Kalshi/Polymarket data access; fee schedule pin |
| **Size** | L |
| **Owner (SUGGESTION)** | Trading Stand (engine) · Research Desk (methods) · Dual Desk · Accuracy Review · Prototype Lab (viz) |

---

### WS-DASH — Calibration / scoring dashboard
| | |
|---|---|
| **Build / land** | Single surface: PATH by-grade WR/E[R]/CIs, confluence fire%, ablation results, PM Brier/FLB, calendar strata. Prefer Floor Goal/R&D TVs + Invest research patterns (`FLOOR_BACKLOG` measurement ethos). |
| **Why** | Profitability/probability goals; FLOOR_BACKLOG F (accuracy = measurement); pm-signal §3; SMC §10. |
| **Accept** | Every digit registered from code (Floor voice rule); no hand-typed edges. |
| **Deps** | WS-P1, WS-C1, WS-PM (can ship PATH-first slice) |
| **Size** | M |
| **Owner (SUGGESTION)** | Design Atelier (layout) · Prototype Lab · Dual Desk · Site Copy |

---

### WS-FLOOR — Smarter Floor characters (grounded)
| | |
|---|---|
| **Build / land** | Extend `src/lib/room/research.ts` shelves: session-brief bullets, PATH journal stats, calendar blackout state, PM calibration one-liners **only** from committed JSON packs. Cross-check: verifier rejects unsourced digits (existing contract). Optional: R&D experiments that test Judas release / sponsored / new detectors (`FLOOR_BACKLOG` E36). |
| **Why** | FLOOR_BACKLOG E/F; `research.ts` live duty note; SMC intelligence goal. |
| **Accept** | Each character cites source id; new notes covered by `verify-*`; no verdict/order language. |
| **Deps** | Pack builders for any new numbers; WS-CAL brief JSON |
| **Size** | M |
| **Owner (SUGGESTION)** | Design Atelier · Site Copy · Dual Desk · Accuracy Review · Graph Keeper |

---

### WS-PRE — Pre-session productivity checklist
| | |
|---|---|
| **Build / land** | Checklist UI/API from SMC §11.7 + RH_LIVE_ROUTINE 09:08 prep: HTF+DOL, PDH/PDL/Asia, calendar, killzone/Judas criteria, one book, risk, CE/OTE on planned POIs only, RH env still false until arm. |
| **Why** | Productivity goal; RH_LIVE_ROUTINE; NY AM brief open levels. |
| **Accept** | Completable before 09:30; incomplete blocks “ready” flag (not live place — env arms remain human). |
| **Deps** | WS-CAL brief; RH account note |
| **Size** | S |
| **Owner (SUGGESTION)** | Trading Stand · Prototype Lab · Site Copy |

---

### WS-BP — Options BP / margin readiness note
| | |
|---|---|
| **Build / land** | Desk-facing readiness card (not diagnosis): settled vs unsettled vs Instant vs reserved; T+1 restore timing; Agentic `995386158` BP ≥ $150 gate; Individual display-only. Reuse `rhAccountNote` / `rhArmedPathNote` in `research.ts` + RH_LIVE_ROUTINE. Link NY AM brief §5 causes checklist. **Do not** auto-place; **do not** scrape accounts beyond approved connector reads when armed. |
| **Why** | NY AM brief §5; RH_LIVE_ROUTINE BP hard gates; Accuracy Review NO-GO until BP. |
| **Accept** | Pre-arm checklist shows which bucket likely blocks; fail-closed if portfolio stale; copy cites Robinhood help themes without inventing account numbers. |
| **Deps** | Host funding / env policy |
| **Size** | S |
| **Owner (SUGGESTION)** | Trading Stand · Accuracy Review · Site Copy · Release Watch (env arm only) |

---

### WS-J1 — Judas Window measurement (critical-path adjacent)
| | |
|---|---|
| **Build / land** | A/B log: hard-block vs `judas-window.ts` release-on-1m/2m/3m — expectancy & false-release rate OOS. |
| **Why** | SMC §6.4, §11.4, open Q6. |
| **Accept** | Committed research note with n and CI; DECISION keep/kill release. |
| **Deps** | WS-P1 labels; sub-15m tape |
| **Size** | M |
| **Owner (SUGGESTION)** | Trading Stand · Accuracy Review · Research Desk |

---

## 3. Owner map (SUGGESTIONS for Dual Desk)

| Role | Suggested WS |
|---|---|
| **Trading Stand** | D1, C1, P1, CAL (gates), PM, PRE, BP, J1 |
| **Dual Desk** | Assigns all; splits Claude vs Grok on D1/C1/P1/PM/FLOOR |
| **Accuracy Review** | D1, C1, P1, PM, FLOOR, BP, J1 — gate before ship |
| **Release Watch** | Deploy after AR; env arms for RH only; no research-branch merge |
| **Design Atelier** | DASH, FLOOR visuals; **merges to main** after AR+RW |
| **Site Copy** | CAL briefs voice, PRE/BP copy, FLOOR lines |
| **Prototype Lab** | P1 UI, DASH, PRE, PM viz |
| **Graph Keeper** | KG0, term→file graph for SMC taxonomy |
| **Research Desk** | CAL recurring briefs, PM methods, J1 writeup, INDEX |

---

## 4. Sequencing

### Phase 1 — Measure & lock (critical path)
1. **WS-KG0** knowledge spine  
2. **WS-P1** PATH journal (starts the n→100 clock)  
3. **WS-BP** + **WS-PRE** (same morning readiness)  
4. **WS-CAL** blackout harden + first automated brief template  
5. **WS-D1** contracts only (no weight changes yet) + cold-detector diagnosis plan  

**Critical path:** KG0 → P1 → (journal accruing) while D1 contracts + CAL run in parallel.

### Phase 2 — Build detectors & score honestly
1. **WS-D1** implement missing/cold per contract  
2. **WS-C1** ablation + walk-forward + FDR  
3. **WS-J1** Judas A/B  
4. **WS-DASH** PATH+confluence slice  
5. **WS-FLOOR** consume new packs  

### Phase 3 — PM engine & compound intelligence
1. **WS-PM** full minimal engine (FLB / Brier / Murphy / fees / WF)  
2. **WS-DASH** PM panels  
3. **WS-FLOOR** PM + brief shelves  
4. Size-up / RH autonomy changes **only if** PATH n≥100 and E[R] gate passes (ROADMAP) — separate AR ticket, not this plan’s code.

### Merge path (respect desk rule)
```
feature/research branch
  → Accuracy Review approve (verifiers + no invented numbers)
  → Release Watch approve (build/deploy health)
  → Design Atelier merges to main
```
Research-only docs (this file, briefs) may land on `research/*` branches first; **Design Atelier** merges when ready. **Do not commit product code on research branches without Dual Desk ticket.**

---

## 5. Risks & open questions

### Risks
| Risk | Mitigation |
|---|---|
| Lowering floor to get clears | Forbidden; DECISIONS + AR veto |
| Cold detectors “fixed” by loosening definitions | Contract + tests first; offline review |
| PM fee illusion | Fee calculator mandatory before any edge claim |
| Look-ahead in new detectors | Same discipline as HTF resample fix (Trading-Automation defect #1) |
| Floor unsourced chatter | Existing digit-registration verifiers; extend to new notes |
| RH live before BP/sample | RH_LIVE_ROUTINE NO-GO; BP card; PATH n gate |
| Scope explosion (niche ICT terms) | Phase 1 contracts only for terms with locked defs; flout/CBDR stay flagged |

### Open questions (carry from briefs + plan)
1. CBDR clock for NQ/ES — which timestamp does Keaton lock? (SMC §9.19 / §13)  
2. What is **flout** on this desk? (SMC §9.20)  
3. Rename desk `sponsored` to avoid ICT collision? (SMC §9.2)  
4. Current PATH graded n toward 100?  
5. Judas release vs hard-block — keep pending J1?  
6. Kalshi FLB post-2025 persistence? (pm-signal OQ)  
7. QQQ/SPY options vs NQ/ES PD-array transfer / basis?  
8. Should NOW/DECISIONS live under `ai/` or `.grok`/PROGRAM — Dual Desk pick  
9. PM data vendor / API for Kalshi historical bins?  
10. Server-side runner (`FLOOR_BACKLOG` #44) vs PATH journal priority?

---

## 6. Traceability (brief → workstream)

| Brief | Sections → WS |
|---|---|
| NY AM session | §§1–4 levels/calendar → CAL, PRE; §5 options BP → BP; open Q → KG0 |
| pm-signal | §4 build-first → PM; §3 scoring → C1, DASH |
| SMC deep dive | §2 inventory → D1, KG0; §10–11 → C1, P1, PRE, J1; §9 niche → D1 (gated) |
| RH_LIVE_ROUTINE / research.ts | PRE, BP, FLOOR |
| ROADMAP / confluence.json | P1, C1 sequencing; no floor cut |
| FLOOR_BACKLOG | FLOOR, DASH measurement ethos |

---

*End of plan. Suggestions only — Dual Desk assigns. No product code in this commit.*
