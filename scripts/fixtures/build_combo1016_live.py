# Builds combo1016-live-ref.json: SMC integration golden_decisions (166) + exit_ref (75) + SMC's config1_trail VAL trade list
# (pnl-push summ.pkl C_70_trail, 2024-01-01..2026-10-09) with pp4 opt_trade contracts/pnl at the config1 tier ($250 base, $500 A+).
import json, sys, math, pandas as pd
sys.argv=[sys.argv[0]]+sys.argv[1:]
I='/workspace/audits/smc-research/integration/fixtures/'
G=json.load(open(I+'golden_decisions.json'))['fixtures']; E=json.load(open(I+'exit_ref.json'))
exec(open('/workspace/ld-combo1016/docs/combo1016/live_diff_backtest.py').read().split("tr['usdR']")[0])
tr=tr.copy(); tr['usdR']=[500 if s>=85 else 250 for s in tr.S2]
T=[]
for r in tr.itertuples():
    o=opt(r,r.usdR)
    T.append(dict(sym=r.sym,side=r.side,entry=float(r.entry),risk=float(r.risk),a5=float(r.a5),fill_tod=int(r.fill_t.hour*60+r.fill_t.minute),S2=float(r.S2),usdR=int(r.usdR),
                  legs=[[float(f),float(px),int(dm)] for f,px,dm in r.L_TR],R=float(r.R),n=None if o is None else int(o['n']),pnl=None if o is None else float(o['pnl']),K=None if o is None else int(o['K'])))
json.dump(dict(golden=G,exit=E,trades=T),open(sys.argv[1],'w')); print(len(G),len(E),len(T))
