# Post-mortem 13:02 CT fixes + Keaton 13:26 CT (stacked on unblock-2, on #22 d2053f43)
rulesHash **c40b5555966491f3**. Replay: `WATCHER_DIR=<watcher copy> python3 replay_pm.py` (10/13–10/15 gates.log/cards.log + 1m bars from /workspace/audits/postmortem-1302; read-only, $0 data).
Replay rows are base = unblock-2 rebased with `second_entry_band` removed. Each fix is applied alone, and then cumulatively.

| Fix | Status | Replay Δ vs base (5 fires, +0.22R, +$57 opt / +$94 fut) |
|---|---|---|
| F1 1m close through same-side 5m/15m FVG ≤60m old, ≤15m, not reclaimed — hard on B+/A- | **live** | 0 (base already blocked the 13:02 long). Case: blocks the live 13:02:03 fire (`case_readprio.mjs`) |
| F2 sanePlan: no T2 promotion above 6R; primaryTarget never promotes (unblock-2) | **live** (desk) | 0 (display only) |
| F3 1h/4h opposing → −0.05 q + requireOneOf sweep/displacement/brain TAKE (replaces the no-op 50% cut, htfReversal off) | **live** | 0 fires changed; 09:45 MNQ long A-→B+ (same 1ct) |
| F4 B+ hard block on brain STAND + Floor gap note | shadow | −1 winner (10/14 09:03 MNQ short +1.17R): −1.17R, −$79 |
| F5 B+ after 13:00 ET → −0.05 q (B+ cards only, so an A- isn't caught) | **live** | 0 |
| F6 premium/discount soft q | shadow | 0 alone; with F1+F3+F5 cuts the 09:45 long: −0.63R |
| F7 R:R from fill ≥ 1.0 hard | shadow | cuts 2 winners (09:03, 08:30); +0.12R but −$45 opt |
| F8 stop beyond EQL pool | shadow | −0.25R, −$61 |
| F9 short from iFVG / 1m read-priority (CE entry) | **live** (desk) | not replayable offline (needs new cards); see case |
| F10 synth ticket DTE = optExec.dteByTime (0DTE before 14:30 ET) | **live** (watcher daemon) | 0 (replay already prices 0DTE) |
| F12 read-priority: 2+ same-side 5m FVGs closed through on 1m → any band blocked, card → C, opposite side armed same poll | **live** | 0 |
| Keaton 13:26: `second_entry_band` removed | **live** | +0.11R, +$33 vs before; **10/15 13:15:25 ES short fires** (live-state replay from 13:05 CT) |

Shipped set (F1+F2+F3+F5+F9+F10+F12 + second entry removed): 5 fires, +0.22R, +$57 options / +$94 futures-equivalent.
