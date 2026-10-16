# Rule 1: SHADOW Δ0.7 0DTE ticket (overnight-1016 item 1)

**Mode: SHADOW.** The ticket is computed and shown next to the current Rule 1 ticket. It never sizes, stages or places an order, and the live order path is unchanged. **RULES_HASH stays `a4bfcb65c88badcd`**: the config is in `shared/rule1-d70.json`, outside `shared/desk-rules.json`, and a test asserts the hash.

| unit | what it gets |
|---|---|
| Desk | `src/lib/trading/rule1-d70.ts` computes `ticketD70 = {mode:"shadow", live:false, d70, atm}` for each `wire.rule1[]` ticket: 0DTE, strike at |Δ| 0.70 (and the ATM Δ0.5 comparison), ≤ 4 contracts, debit ≤ $650. If the Δ0.7 1-lot is over the cap, the **shadow** pick steps down to Δ0.6 then ATM (overnight report line 156); `capBlocked` only when ATM also exceeds the cap. The existing `option` (Δ0.6) is unchanged. |
| Brain (Master seat) | Adds one narrative line, `Rule1 shadow <sym> <side>: Δ0.7 0DTE … · ATM … · current … (shadow, no order)` (or `Δ0.7→0.6` / `Δ0.7→0.5` when stepped). It is narrative only, so the verdict and checks stay the same (tested). |
| Floor | `RoomDeskRead.rule1Shadow: string[]` carries the same lines in `readDeskForRoom`. No seat gates on it. |
| Watcher | `watcher-d70.patch` changes `rule1_shadow.py`, so each `rule1_would_fire` row now also logs `d70`, `atm` and `d70_live:false` next to the current strike/delta. The patch also fixes the reader: the live card carries the tickets on `wire.rule1`, but the old reader only looked at top-level `rule1`, so it logged nothing against the live card. The patch is NOT applied to the live watcher. After review, apply it with `git apply docs/shadow-1016/d70/watcher-d70.patch` (or `patch -p1`) in the watcher tree. |

## Cap: no-trade vs step-down
- **Validation scripts** (`validate_d70.py`, study-style): a 1-lot over the $650 cap counts as **no trade** (`cap-blocked`, $0). That matches how the paired tables were built.
- **Overnight report** (`audits/overnight-1016/report.md` line 156 / Top-10 #1): if debit > $650, **step down to Δ0.6, then ATM**; skip only if ATM also exceeds the cap.
- **This PR's shadow ticket logic** follows the overnight step-down (shadow only). Live sizing and the RH order path are untouched.

## Validation (`validate_d70.py`, closed bars, all TFs 30s–1D)
Results are in `validation-iv-rv20.md` (the study's IV, 1.2× 20-day realized) and `validation-iv-desk.md` (the desk's IV, 1.2× 5m-range sigma). The test covers 716 Rule 1 tickets (desk mirror `scripts/rule1.py`) on ES+NQ from 2019-01-02 to 2026-10-15.

Sign and ranking **depend on the cost model** — do not say both lose (or both win) unconditionally:

- **Study IV:** d0.7 beats ATM only under this cost model: **+$42.7 per trade paired (t = 6.10, n = 716)**, and **both are negative** at −$40.9/wk vs ATM −$116.1/wk.
- **Desk IV (cheaper):** **both are positive** (+$35.6/wk vs ATM +$42.8/wk), with d0.7 **−$4.1 per trade vs ATM (t = −0.55)**.
- The desk's own Rule 1 mirror gives +0.117R per trade on this set, not the study's +0.474R (different event build). See the lane validation.

Re-run: `python3 docs/shadow-1016/d70/validate_d70.py` (`IV_MODEL=rv20` or `IV_MODEL=desk`). It needs `/workspace/data/databento` and caches `events.json` next to the script.
