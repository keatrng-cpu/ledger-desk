# Builds scripts/fixtures/combo1016-feat-smc.json: SMC integration minutes_{SYM}_{DAY}.json expected rows + the raw bars the desk would hold.
import pandas as pd, json, sys, glob, os
TZ='America/Chicago'; I='/workspace/audits/smc-research/integration/fixtures/'
B={s:pd.read_parquet(f'/workspace/bt13w/cache/{s}.parquet') for s in ['ES','NQ']}
ms=lambda ix:[int(v.value//10**6) for v in ix]
def bars(d): return dict(t=ms(d.index),o=d.open.round(4).tolist(),h=d.high.round(4).tolist(),l=d.low.round(4).tolist(),c=d.close.round(4).tolist())
out=[]
for p in sorted(glob.glob(I+'minutes_*.json')):
    j=json.load(open(p)); s=j['sym']; ot='NQ' if s=='ES' else 'ES'; d0=pd.Timestamp(j['day'],tz=TZ)
    own=B[s]; oth=B[ot]; sl=lambda x:x[(x.index>=d0-pd.Timedelta('10h'))&(x.index<d0+pd.Timedelta('15h'))]
    h=own[(own.index>=d0-pd.Timedelta('35D'))&(own.index<d0+pd.Timedelta('15h'))]
    b15=h.resample('15min',label='left',closed='left').agg({'open':'first','high':'max','low':'min','close':'last'}).dropna()
    rows=[dict(t=int(pd.Timestamp(r['t_bar']).value//10**6),short=r['short'],long=r['long'],rng30=r['rng30'],compress=r['compress'],since_disp=r['since_disp'],atrpct=r['atrpct'],atr5=r['atr5'],dow=r['dow'],cands=r['candidates']) for r in j['minutes']]
    out.append(dict(src=os.path.basename(p),day=j['day'],sym=s,own1m=bars(sl(own)),oth1m=bars(sl(oth)),own15m=bars(b15),minutes=rows))
json.dump(out,open(sys.argv[1],'w')); print(len(out),'files',sum(len(o['minutes']) for o in out),'minutes')
