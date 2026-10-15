"""fire-bugs-live 10/15 final config replay (read-only): no hold timer (confirmPolls 2, maxActionableAgeS 90), geometry fix,
velocity = size cut (ETA > 30m half, > 60m / unknown 1ct), entry re-arm. Every other hard gate as logged.
R from the watcher's quote series (replay.outcome: 50% at T1, BE, rest T2 or 2xT1, 14:50 time exit);
0DTE $ = ATM QQQ/SPY Black-Scholes (rightness.py model), whole contracts within a $650 debit, then the velocity cut."""
import sys, re, json, math, collections, datetime as D
sys.path.insert(0, '/workspace/audits/fire-fail-1015'); sys.path.insert(0, '.')
import replay as RP, pandas as pd
AUD='/workspace/audits/strictness-1015/'
def yq(f):
    j=json.load(open(AUD+f))['chart']['result'][0]
    return pd.Series(j['indicators']['quote'][0]['close'],index=pd.to_datetime(j['timestamp'],unit='s',utc=True).tz_convert('America/Chicago')).dropna()
ratio={}
for s,(e,f) in {'MNQ':('QQQ','NQ'),'ES':('SPY','ES')}.items():
    a=yq(f'y_{e}.json');b=yq(f'y_{f}=F.json');x=pd.concat([a,b],axis=1,join='inner').dropna(); ratio[s]=float((x.iloc[:,0]/x.iloc[:,1]).median())
IV={'MNQ':0.20,'ES':0.15}; DEBIT=650; COST=0.025
def N(x): return 0.5*(1+math.erf(x/2**0.5))
def bs(S,K,T,v,call):
    T=max(T,1e-7);d1=(math.log(S/K)+0.5*v*v*T)/(v*T**0.5);d2=d1-v*T**0.5
    return S*N(d1)-K*N(d2) if call else K*N(-d2)-S*N(-d1)
def yrs(ts): t=RP.ct(ts); return max((t.replace(hour=15,minute=0,second=0)-t).total_seconds(),60)/(365*86400)
def path(d,t0):
    """Events on the quote series: [(ts, px, frac)] exits, label."""
    L=d['side']=='long'; e=d['px']; st=d['s']; t1=d['t1']
    t2=d['t2'] if d['t2'] and ((d['t2']>t1) if L else (d['t2']<t1)) else (t1+(t1-e))
    end=RP.ct(t0).replace(hour=14,minute=50).timestamp(); ev=[]; half=False; rem=1.0
    for ts,p in RP.px[d['sym']]:
        if ts<=t0: continue
        if ts>end: ev.append((ts,p,rem)); return ev,('T1 then time' if half else 'time 14:50')
        if (p<=st if L else p>=st): ev.append((ts,st,rem)); return ev,('T1 then BE' if half else 'stop')
        if not half and (p>=t1 if L else p<=t1): ev.append((ts,t1,0.5)); rem=0.5; half=True; st=e
        if half and (p>=t2 if L else p<=t2): ev.append((ts,t2,0.5)); return ev,'T1+T2'
    ts,p=RP.px[d['sym']][-1]; ev.append((ts,p,rem)); return ev,('T1 then open' if half else 'open')
def vel(g):
    m=re.search(r'T1 ~([\d.]+|None)m',g.get('fast:velocity',(0,0,''))[2]); return None if not m or m.group(1)=='None' else float(m.group(1))
def run(confirm=2,max_age=90,cap=30):
    fires=[]; by={}; spent=set(); last=None; day_n=collections.Counter(); busy=0
    for r in RP.rows:
        d=RP.parse(r)
        if not d: continue
        g=d['g']; sid=f"{d['sym']}:{d['side']}:{d['e']}"; L=d['side']=='long'
        for k in [k for k in by if k.split(':')[0]==d['sym'] and k.split(':')[1]!=d['side']]: by.pop(k)
        if (d['s'] is not None and (d['px']<=d['s'] if L else d['px']>=d['s'])) or (d['t1'] is not None and (d['px']>=d['t1'] if L else d['px']<=d['t1'])):
            if sid in by: spent.add((RP.ct(r['ts']).date(),sid))   # stop / T1 touched: spent for the session (Accuracy 10/15)
            by.pop(sid,None); last=None; continue
        if (RP.ct(r['ts']).date(),sid) in spent: by.pop(sid,None); last=None; continue
        ok=all(g[n][1] for n in('band','fast:plan','fast:entry','fast:agree') if n in g) and RP.geom_fixed(d)
        cur=by.get(sid)
        if not ok:
            if cur:
                cur['n']=0
                m=re.search(r'0\.5xATR ([\d.]+)',g['fast:entry'][2])
                if not g['fast:entry'][1] and m and abs(d['px']-d['e'])>0.5*float(m.group(1)): cur['ooz']=True
            last=None; continue
        if cur and cur.get('ooz'): cur=by[sid]={'first':r['ts'],'n':0,'rearm':cur.get('rearm',0)+1,'fired':cur.get('fired')}; last=None
        cur=by.setdefault(sid,{'first':r['ts'],'n':0}); cur['n']=cur['n']+1 if last==sid else 1; last=sid
        other=[x[0] for x in RP.hard_fails(r) if x[0] not in('band','fast:persist','fast:plan','fast:entry','fast:agree','fast:velocity','fast:geometry')]
        day=RP.ct(r['ts']).date()
        if cur['n']>=confirm and r['ts']-cur['first']<=max_age and not other and day_n[day]<2 and r['ts']>busy and not cur.get('fired'):
            R,why,te=RP.outcome(d,r['ts']); ev,lab=path(d,r['ts']); day_n[day]+=1; busy=te or 9e18; cur['fired']=True; spent.add((day,sid))
            k=ratio[d['sym']]; S0=d['px']*k; K=round(S0); v=IV[d['sym']]; p0=bs(S0,K,yrs(r['ts']),v,L)+COST
            n0=int(DEBIT//(p0*100)); m=vel(g)
            n=n0 if (m is not None and m<=cap) else (1 if (m is None or m>2*cap) else max(1,n0//2))
            n=min(n,n0)
            if n==0: pnl=None
            else:
                q=[]; left=n
                for i,(ts,px,frac) in enumerate(ev):
                    c=left if i==len(ev)-1 else (n if n==1 else n//2)
                    c=min(c,left); left-=c
                    if c: q.append((c,bs(px*k,K,yrs(ts),v,L)-COST))
                    if not left: break
                pnl=round(sum(c*(p-p0)*100 for c,p in q))
            fires.append(dict(t=RP.ct(r['ts']).strftime('%m-%d %H:%M:%S CT'),sym=d['sym'],side=d['side'],band=r['band'],entry_card=d['e'],fill_px=d['px'],stop=d['s'],t1=d['t1'],
                              outcome=lab,R=round(R,2),exit=RP.ct(te).strftime('%H:%M') if te else '-',T1_eta_min=m,contracts=n,full_size=n0,prem=round(p0,2),opt_pnl=pnl,rearmed=cur.get('rearm',0),sig=r['signal']))
    return fires
if __name__=='__main__':
    f=run(); json.dump(f,open('replay-live-results.json','w'),indent=1)
    for x in f: print(x)
    print('fires',len(f),'sumR',round(sum(x['R'] for x in f),2),'sum$',sum(x['opt_pnl'] or 0 for x in f))
    # coverage of the calls / 10/15 longs
    for lbl,t0,t1 in [('10/15 ES/MNQ longs 08:58-09:26 CT (09:58-10:26 ET)','2026-10-15 08:58','2026-10-15 09:26')]:
        a,b=[D.datetime.fromisoformat(x).timestamp() for x in (t0,t1)]
        sub=[r for r in RP.rows if a<=r['ts']<=b and (RP.parse(r) or {}).get('side')=='long']
        c=collections.Counter(); bands=collections.Counter(r['band'] for r in sub)
        for r in sub:
            if r['band'] in RP.GOOD: c.update(x[0] for x in RP.hard_fails(r) if x[0]!='fast:persist')
        print(lbl,'long rows',len(sub),'bands',dict(bands),'blocks on B+ rows',c.most_common(8))
