# Builds scripts/fixtures/combo1016-arms-parity.json from SMC pnl-push research output (read only).
# Run from /workspace/audits/smc-research/pnl-push: python3 <this> <out.json>
import pandas as pd, numpy as np, json, sys
src=open('pp3.py').read(); exec(src[:src.index('# ---------- ROOT MISS 3')])
summ=pd.read_pickle('summ.pkl')
V0,V1=SPL['VAL 2024-10/09/26']
sub=x[(x.t>=V0)&(x.t<V1)&(x.S2>=65)&(x.pgr>=1)]
ms=lambda s: [int(pd.Timestamp(v).value//10**6) for v in s]
sel=dict(day=[str(d) for d in sub.day], sym=list(sub.sym), fillT=ms(sub.fill_t), S2=[float(v) for v in sub.S2], pgr=[float(v) for v in sub.pgr], idx2=[int(v) for v in sub.idx2])
for m in ['TR','E75']: sel['exitT_'+m]=ms(sub['ex_'+m]); sel['R_'+m]=[float(v) for v in sub['R_'+m]]
ref={}
for nm,k,m,B,A in [('C_70_trail','config1_trail','TR',250,500),('B_70_E75','config2_e75','E75',300,300),('A_relaxed65_E75','config3_e75_s65','E75',250,500),('B_70_E75','config2_e75_tier200_400','E75',200,400)]:
    tr=summ[nm]; t=tr[(tr.t>=V0)&(tr.t<V1)]
    wks=pd.period_range(V0.tz_localize(None),(V1-pd.Timedelta('1D')).tz_localize(None),freq='W-FRI')
    usd=t.R*np.where(t.S2>=85,A,B)
    ref[k]=dict(n=len(t),idx2=[int(v) for v in t.i],sumR=float(t.R.sum()),wr=float((t.R>0).mean()),usdwk=float(usd.sum()/len(wks)),nweeks=len(wks))
rng=np.random.default_rng(16); ex=[]
bars={s:pd.read_parquet(f'/workspace/bt13w/cache/{s}.parquet') for s in ['ES','NQ']}
xs=x.iloc[rng.choice(len(x),400,replace=False)]
for _,r in xs.iterrows():
    D=bars[r.sym]; f=int(r.fill); last=f+int(r.last_min)
    seg=D.iloc[f:last+1]
    ex.append(dict(sym=r.sym,side=r.side,entry=float(r.entry),risk=float(r.risk),h=[float(v) for v in seg.high],l=[float(v) for v in seg.low],c=[float(v) for v in seg.close],R_TR=float(r.R_TR),R_E75=float(r.R_E75)))
op=[]
t=summ['B_70_E75'].dropna(subset=['optR']).sample(150,random_state=3)
for _,r in t.iterrows():
    op.append(dict(sym=r.sym,side=r.side,entry=float(r.entry),risk=float(r.risk),a5=float(r.a5),fillMinCt=int(r.fill_t.hour*60+r.fill_t.minute),legs=[dict(frac=float(a),px=float(b),dm=int(c)) for a,b,c in r.L_E75],optR=float(r.optR),ncon=int(r.ncon)))
json.dump(dict(select=sel,ref=ref,exits=ex,opt=op),open(sys.argv[1],'w'))
print({k:(v['n'],round(v['usdwk'])) for k,v in ref.items()}, len(sub))
