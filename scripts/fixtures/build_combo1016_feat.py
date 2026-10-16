# Builds scripts/fixtures/combo1016-feat-parity.json: research proxy feature rows (score-rebuild/ev/feat_{ES,NQ}.parquet + gbm.py side mapping)
# and the raw bars the desk would hold (1m, 15m aggregated from the same 1m), plus research candidates (m.pkl) on the same days for S2/gbmP.
import pandas as pd, numpy as np, json, sys
TZ='America/Chicago'
DAYS=['2024-01-17','2024-03-08','2024-03-11','2024-06-12','2024-11-04','2025-02-27','2025-08-05','2026-03-09','2026-07-22','2026-10-15']
B={s:pd.read_parquet(f'/workspace/bt13w/cache/{s}.parquet') for s in ['ES','NQ']}
F={s:pd.read_parquet(f'/workspace/audits/score-rebuild/ev/feat_{s}.parquet') for s in ['ES','NQ']}
m=pd.read_pickle('/workspace/audits/score-rebuild/ev/m.pkl')
ms=lambda ix:[int(v.value//10**6) for v in ix]
def bars(d): return dict(t=ms(d.index),o=d.open.round(4).tolist(),h=d.high.round(4).tolist(),l=d.low.round(4).tolist(),c=d.close.round(4).tolist())
def side_map(f,side):
    sd=1 if side=='short' else -1
    o={}
    o['sw_with']=f[['swH_pd','swH_on','swH_asia','swH_lon','swH_eq']].max(axis=1) if sd>0 else f[['swL_pd','swL_on','swL_asia','swL_lon','swL_eq']].max(axis=1)
    o['smt_with']=f.smt_bear if sd>0 else f.smt_bull; o['fail3_with']=f.fail3H if sd>0 else f.fail3L; o['mss5_with']=f.mss_dn if sd>0 else f.mss_up
    o['tr1h_with']=f.tr1h*sd*-1*-1*(-1 if sd>0 else 1); o['tr4h_with']=f.tr4h*(-1 if sd>0 else 1); o['pdpos_with']=f.pdpos if sd>0 else 1-f.pdpos
    for k in ['compress','rng30','since_disp','atrpct']: o[k]=f[k]
    return {k:[None if (v!=v) else float(v) for v in o[k]] for k in o}
out=[]
for day in DAYS:
    d0=pd.Timestamp(day,tz=TZ)
    for s,ot in [('ES','NQ'),('NQ','ES')]:
        own=B[s]; oth=B[ot]
        w1=own[(own.index>=d0-pd.Timedelta('10h'))&(own.index<d0+pd.Timedelta('15h'))]
        o1=oth[(oth.index>=d0-pd.Timedelta('10h'))&(oth.index<d0+pd.Timedelta('15h'))]
        h=own[(own.index>=d0-pd.Timedelta('35D'))&(own.index<d0+pd.Timedelta('15h'))]
        b15=h.resample('15min',label='left',closed='left').agg({'open':'first','high':'max','low':'min','close':'last'}).dropna()
        f=F[s]; f=f[(f.index>=d0+pd.Timedelta('8h30min'))&(f.index<d0+pd.Timedelta('15h'))]
        mm=m[(m.sym==s)&(m.t>=d0)&(m.t<d0+pd.Timedelta('1D'))]
        cands=[dict(t=int(r.t.value//10**6),side=r.side,x={k:(None if pd.isna(r[k]) else float(r[k])) for k in json.load(open('/workspace/audits/score-rebuild/ev/X.json'))['X']},pg=float(r.pg),
                    raw=dict(tr4h_with=None if pd.isna(r.tr4h_with) else float(r.tr4h_with),atrpct=None if pd.isna(r.atrpct) else float(r.atrpct),pd=float(r.pd) if not pd.isna(r.pd) else None,wtmax=float(r.wtmax) if not pd.isna(r.wtmax) else None,
                             nk=float(r.nk) if not pd.isna(r.nk) else None,smt=bool(r.smt),disp=float(r.disp),mss=bool(r.mss),ifvg=bool(r.ifvg),risk_atr=None if pd.isna(r.risk_atr) else float(r.risk_atr),
                             chaseR=None if pd.isna(r.chaseR) else float(r.chaseR),arr_ifvg=float(r.arr_ifvg),tmin=float(r.tmin),rng30=None if pd.isna(r.rng30) else float(r.rng30))) for _,r in mm.iterrows()]
        out.append(dict(day=day,sym=s,own1m=bars(w1),oth1m=bars(o1),own15m=bars(b15),rows=dict(t=ms(f.index),short=side_map(f,'short'),long=side_map(f,'long')),cands=cands))
    print(day,flush=True)
json.dump(out,open(sys.argv[1],'w'))
