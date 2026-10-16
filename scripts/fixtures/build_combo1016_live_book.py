# combo1016-live-book.json: every config1 FIRE candidate in VAL (S2>=70 & gbm top10, pp3 x) with fill/exit times and net TR R,
# plus SMC's taken flag (pnl-push run(): caps 5/3, busy per symbol, halt after the first loss). For the live DayBook replay.
import sys, os, json, pandas as pd, numpy as np
os.chdir('/workspace/audits/smc-research/pnl-push')
src=open('pp3.py').read(); exec(src[:src.index('# ---------- ROOT MISS 3')])
V0,V1=SPL['VAL 2024-10/09/26']
s=x[(x.S2>=70)&(x.pgr>=1)]; s=s[(s.t>=V0)&(s.t<V1)]
tr=run(s,'TR',5,3,1); took=set(tr.i)
rows=[dict(i=int(r.idx2),day=str(r.day),sym=r.sym,side=r.side,t=int(r.t.value//10**6),fill=int(r.fill_t.value//10**6),ex=int(pd.Timestamp(r.ex_TR).value//10**6),R=float(r.R_TR),taken=bool(r.idx2 in took)) for r in s.itertuples()]
json.dump(rows,open(sys.argv[1],'w')); print(len(rows),len(took))
