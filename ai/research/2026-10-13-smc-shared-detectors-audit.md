# SMC shared detectors — audit (2026-10-13, branch feat/smc-shared-detectors)

Base: origin/main @ b3d58e0f. Not for main until Accuracy Review → Release Watch → Design Atelier.

## Where each one decides
| Surface | Decides | File · function |
|---|---|---|
| Desk band / q | components, confluence, band, veto flags | `src/lib/trading/scanner.ts` `scanSetups` (components ~L520-700); bands `strategy-grade.ts` `pathBand` (L422-429), `aplus/config.ts` `riskGradeFromScore` (L99-107) |
| Brain word | TAKE/WAIT/STAND from must-layers + sequence | `trading/smc-master.ts` `gradeBook` (layers L470-790, word L843-848), `sequenceGaps` (L217); factors `trading/smc-canon.ts` `scoreCanonStack` / `canonInputForCandidate` (L531); raid/confirmation `trading/market-narrative.ts` `confirmationState` (L278) |
| Floor verdict + ticket | ARMED/WATCH/STAND, priced ticket | `trading/options-desk.ts` PATH ticket (L1600-1745), 0DTE (L1750+), SMT swing (L1830-1935), event (L1955+) |
| Floor seats | blocked/skip/take | `room/orchestrator.ts` `evaluateEntry` (L516; gates market, desk, card, desk_word=ARMED, desk_ticket, dte, halt_day/week…), `room/seats.ts` `verdictFor` (L305; Sterling A/A+ only, Nova/structure HTF, Vince/edge Kelly, Room consensus) |
| SMC seats (ICT/TJR/Blake/Patty-PB) | fits/missing/against | `trading/school-brief.ts` `schoolRead`/`schoolGate` — reads the brain's layers first (`layerOf`), gate `SCHOOL_GATE.enabled=false` (L446) |

## Concept table (✗ = disagreement before this branch)
| Concept | Desk scanner | Brain | Floor |
|---|---|---|---|
| Sweep / raid | ✗ `sweep_significant` = newest sweep of EITHER side (`det.sweep.latest`, 24 bars, fractal swing, close back inside) kept only if this side's polarity; or Blake mechanical sweep | ✗ canon `sweep` = narrative raid of the NARRATIVE's direction, must also have `confirmation≠none`; no mechanical fallback in the factor (but `sequenceGaps` accepts `mechanical_model`) | inherits brain word (SMC TAKE for B+) |
| Displacement | `pairedDisplacement` after `polaritySweep` (newest same-side raid), window min(30 min, 6 bars) | narrative `confirmationState` — same pair when bars>20 | inherits |
| MSS/CHoCH / CISD | `cisdThroughSeries` after raid; `lastBOS` | LTF layer (`armed_entry`/`confirmed`/`sweep_displace`+`ltf_reaction`) | — |
| FVG/IFVG entry | CE of gap the displacement left (`entryPx`) | `array` sequence part = `entryPx != null` | CE touch required (rh-autofire-gates L384) |
| Premium/discount | `preferZone` (impulse leg OR 80-bar window) | `pd_half` must; NOTE when raid+LTF named (halfNote); equilibrium waits | ✗ PATH ticket: size cut; SMT ticket: HARD BLOCK on 80-bar `dealing.zone` (L1859, L1876) |
| HTF bias | `htfOk`, `htfDisrespected` release | `htf` must; NOTE once raid named | PATH ticket: 1h/4h gap direction BLOCK (L1647-1649) |
| Killzone / Judas | session-event tape gate; Judas 09:30-09:45 | `time` is a note; Judas `readJudas` release | news blackout refuse (gates L439) |
| CBDR | none in repo (open lock #1) | none | none |

## Agreement data (committed files only)
- `src/data/replay-drills.json` `selection.population` (four-year capture, 5,026 rows ≥ 0.65 / 3,603 episodes): brain word WAIT 2,416 · STAND 1,171 · **TAKE 16** episodes. Desk in band (A−+) vs brain TAKE agree on **16 / 3,603 (0.44%)**. Blocking layer: **sweep 1,434 (39.8%)**, **pd_half 1,269 (35.2%)**, ltf 255, retrace 194, target 146, time 113, htf 86, dol 73, path 17.
- `src/data/shadow-replay.json` (Jul 3 – Sep 1 2026, 195 refused cards, 387 legs, all desk A+/A/A−): reason sweep 126 cards (124 = "BSL raid arms SHORT / SSL raid arms LONG" wrong-polarity text, 2 "no raid"), pd_half 64, ltf 3, retrace 2. T1 later hit: sweep 31/126, pd_half 5/64. Legs refused on sweep: limit 34 won / 57 lost / 8 expired; chase 68 won / 51 lost / 6 scratch. pd_half: limit 6 won / 19 lost; chase 35 won / 18 lost.
- Floor verdict / seat decisions: no committed recording → no agreement number.

## What this branch changes
1. `src/lib/smc/shared.ts`: `armingRaid` (polarity raid, else live mechanical), `raidReadForCard`, `cardHasRaid`, `locationVerdict`.
2. scanner `sweep_significant` uses `armingRaid` (a later other-pool tag no longer erases this side's raid).
3. canon `canonInputForCandidate` uses `raidReadForCard`: when the narrative raid does not arm the card's side but the card carries its own raid, the brain grades the card's raid (fixes the "missing liquidity sweep"/wrong-polarity STAND).
4. options-desk SMT ticket: dealing-zone fight is a size-cut reason, not a block (matches PATH ticket + brain halfNote).
Not changed: floors, bands, RH gates, safety blocks.
