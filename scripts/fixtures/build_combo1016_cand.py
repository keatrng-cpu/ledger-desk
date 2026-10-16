# Builds scripts/fixtures/combo1016-cand-parity.json: research candidate-level inputs (eng.py/score.py via score-rebuild/ev/m.pkl) for the
# combo1016-feat-parity.json days, with the raid time, market anchor (next open), newest near edge and stop, so candFeatures can be checked.
import pandas as pd, json, sys
TZ='America/Chicago'
DAYS=['2024-01-17','2024-03-08','2024-03-11','2024-06-12','2024-11-04','2025-02-27','2025-08-05','2026-03-09','2026-07-22','2026-10-15']
m=pd.read_pickle('/workspace/audits/score-rebuild/ev/m.pkl')
ms=lambda v:int(v.value//10**6)
out=[]
for day in DAYS:
    d0=pd.Timestamp(day,tz=TZ)
    for s in ['ES','NQ']:
        mm=m[(m.sym==s)&(m.t>=d0)&(m.t<d0+pd.Timedelta('1D'))]
        for _,r in mm.iterrows():
            mk=r.mkt if isinstance(r.mkt,dict) else None; ne=r.newest_edge if isinstance(r.newest_edge,dict) else None
            out.append(dict(day=day,sym=s,side=r.side,t=ms(r.t),traid=ms(r.traid),price=None if mk is None else float(mk['entry']),
                edge=None if ne is None else float(ne['entry']),stop=float(r.stop),
                ref=dict(b1=float(r.b1),b4=float(r.b4),pd=float(r.pd),smt=bool(r.smt),chaseR=None if pd.isna(r.chaseR) else float(r.chaseR),tmin=int(r.tmin))))
json.dump(out,open(sys.argv[1],'w')); print(len(out))
