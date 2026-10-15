#!/usr/bin/env python3
"""PAPER trend-day MNQ lane (edge-1015 variant 3). NO broker, NO orders — logs only.
Rule (from /workspace/audits/edge-1015/tests.py feats + eng.py ranked_target/sim, NQ only, 1 MNQ):
  at 09:30 CT score = drive(|px-open|>=0.25ADR) + ON hi/lo break + gap(>=0.15ADR) + 30-min IB break + PDH/PDL break;
  |score|>=3 -> trade sign(score) at market; stop = opposite morning extreme (08:30-09:29 low for long / high for short);
  skip if risk <= 0.05*ADR; target = nearest unswept ranked pool >= 1R (PDH/PDL/ONH/ONL/Asia/London + 1h/4h fractal swings);
  exit stop (first) / target / time 14:50 CT. 1 trade/day. $2/pt, $1.50 RT fees, 1 tick slippage on entry and stop.
Bars: Supabase live_market_bars_1m over HTTPS (env SUPABASE_SERVICE_ROLE_KEY; project ref = DATABASE_URL username suffix).
Simplification vs the engine: 15m equal-high/low pools are omitted."""
import os,sys,json,time,csv,math,datetime as D,urllib.parse as u,urllib.request as R
from zoneinfo import ZoneInfo
CT=ZoneInfo('America/Chicago');UTC=D.timezone.utc
HERE=os.path.dirname(os.path.abspath(__file__));SYM='NQ';MULT=2.0;FEE=1.5;TICK=0.25;K=3
CSV=os.path.join(HERE,'trades.csv');JL=os.path.join(HERE,'events.jsonl');ST=os.path.join(HERE,'state.json')
def log(ev,**kw):
    kw.update(ev=ev,at_ct=D.datetime.now(CT).isoformat(timespec='seconds'))
    with open(JL,'a') as f: f.write(json.dumps(kw,default=str)+'\n')
def fetch(start,end=None):
    ref=u.urlparse(os.environ['DATABASE_URL']).username.split('.',1)[-1];k=os.environ['SUPABASE_SERVICE_ROLE_KEY']
    out=[];off=0
    while True:
        q=f"symbol=eq.{SYM}&bar_time=gte.{u.quote(start.astimezone(UTC).isoformat())}"+(f"&bar_time=lt.{u.quote(end.astimezone(UTC).isoformat())}" if end else '')
        url=f"https://{ref}.supabase.co/rest/v1/live_market_bars_1m?select=bar_time,o,h,l,c&{q}&order=bar_time.asc&limit=1000&offset={off}"
        b=json.load(R.urlopen(R.Request(url,headers={'apikey':k,'Authorization':'Bearer '+k}),timeout=30));out+=b;off+=len(b)
        if len(b)<1000: break
    return [dict(t=D.datetime.fromisoformat(x['bar_time']).astimezone(CT),o=float(x['o']),h=float(x['h']),l=float(x['l']),c=float(x['c'])) for x in out]
DBN='/workspace/data/databento/NQ_1m.parquet'
def history(today):
    """Prior-day context (ADR20, PDH/PDL, ON, 1h/4h swings). Supabase history is gappy (<300 RTH bars on many
    September days), so prior days come from the local Databento 1m file when present, else Supabase."""
    cut=D.datetime.combine(today,D.time(0),CT)-D.timedelta(hours=7)
    try:
        import pandas as pd
        df=pd.read_parquet(DBN,columns=['open','high','low','close']);df=df[df.index>=pd.Timestamp(today-D.timedelta(days=40),tz='UTC')]
        df.index=df.index.tz_convert('America/Chicago');df=df[df.index<pd.Timestamp(cut)]
        h=[dict(t=r.Index.to_pydatetime(),o=float(r.open),h=float(r.high),l=float(r.low),c=float(r.close)) for r in df.itertuples()]
        if h: return h
    except Exception as e: log('history_fallback',err=repr(e)[:200])
    return fetch(D.datetime.combine(today-D.timedelta(days=40),D.time(0),CT),cut)
def mins(t): return t.hour*60+t.minute
def rth(bars,d): return [b for b in bars if b['t'].date()==d and 510<=mins(b['t'])<900]
def context(bars,today):
    days=sorted({b['t'].date() for b in bars if b['t'].date()<today and b['t'].weekday()<5 and len(rth(bars,b['t'].date()))>300})
    if len(days)<21: raise RuntimeError(f'need 21 prior RTH days, have {len(days)}')
    rng=[(lambda r:max(x['h'] for x in r)-min(x['l'] for x in r))(rth(bars,d)) for d in days[-20:]];adr=sum(rng)/20
    pd_=rth(bars,days[-1]);pdh=max(x['h'] for x in pd_);pdl=min(x['l'] for x in pd_);pdc=pd_[-1]['c'];pe=pd_[-1]['t']
    on=[b for b in bars if pe<b['t'] and (b['t'].date()<today or mins(b['t'])<510)]
    asia=[b for b in on if mins(b['t'])>=1020 or mins(b['t'])<60];lon=[b for b in on if 60<=mins(b['t'])<420]
    pools=[('PDH',pdh,pe),('PDL',pdl,pe)]
    if on: pools+=[('ONH',max(b['h'] for b in on),on[-1]['t']),('ONL',min(b['l'] for b in on),on[-1]['t'])]
    if asia: pools+=[('AsH',max(b['h'] for b in asia),asia[-1]['t']),('AsL',min(b['l'] for b in asia),asia[-1]['t'])]
    if lon: pools+=[('LoH',max(b['h'] for b in lon),lon[-1]['t']),('LoL',min(b['l'] for b in lon),lon[-1]['t'])]
    return dict(adr=adr,pdh=pdh,pdl=pdl,pdc=pdc,onh=max(b['h'] for b in on) if on else math.nan,onl=min(b['l'] for b in on) if on else math.nan,pools=pools)
def swings(bars,now,minutes,look_bars,k=2):
    """fractal (k/k) swing highs/lows on resampled bars closed by `now`; 4h buckets offset 1h as in the engine."""
    off=60 if minutes==240 else 0;B={}
    for b in bars:
        if b['t']>=now: break
        m=int(b['t'].timestamp()//60);key=(m-off)//minutes
        x=B.setdefault(key,[b['h'],b['l'],None]);x[0]=max(x[0],b['h']);x[1]=min(x[1],b['l']);x[2]=b['t']
    ks=sorted(B)[:-1][-look_bars:];H=[B[q][0] for q in ks];L=[B[q][1] for q in ks];out=[]
    nm='S4h' if minutes==240 else 'S1h'
    for i in range(k,len(ks)-k):
        if H[i]==max(H[i-k:i+k+1]): out.append((nm+'H',H[i],B[ks[i+k]][2]))
        if L[i]==min(L[i-k:i+k+1]): out.append((nm+'L',L[i],B[ks[i+k]][2]))
    return out
def ranked_target(bars,pools,side,entry,risk,now):
    c=[]
    for nm,p,ft in pools:
        dist=side*(p-entry)
        if dist<=0: continue
        seg=[b for b in bars if ft<b['t']<now]
        if seg and ((side>0 and max(b['h'] for b in seg)>=p) or (side<0 and min(b['l'] for b in seg)<=p)): continue
        c.append((dist,p,nm))
    for dist,p,nm in sorted(c):
        if dist>=risk: return p,nm,dist/risk
    return None
def load_state(): return json.load(open(ST)) if os.path.exists(ST) else {}
def save_state(s): json.dump(s,open(ST,'w'),indent=1,default=str)
def write_trade(row):
    new=not os.path.exists(CSV)
    with open(CSV,'a',newline='') as f:
        w=csv.DictWriter(f,fieldnames=['date','signal_time_ct','score','features','side','entry','stop','target','target_pool','target_R','risk_pts','exit_time_ct','exit_px','exit_reason','pts','R','usd_1mnq','status'])
        if new: w.writeheader()
        w.writerow(row)
def step(today,s):
    now=D.datetime.now(CT);d=s.setdefault(str(today),{})
    if mins(now)<571 or d.get('done'): return            # wait for the 09:29 bar to close
    if 'signal' not in d:
        bars=history(today)+fetch(D.datetime.combine(today,D.time(0),CT)-D.timedelta(hours=7))  # live from 17:00 prior evening
        cx=context(bars,today);t=rth(bars,today);m=[b for b in t if mins(b['t'])<570]
        if not m or mins(m[0]['t'])!=510 or mins(m[-1]['t'])!=569: log('no_data',n=len(m));return
        px=m[-1]['c'];op=m[0]['o'];adr=cx['adr'];ib=m[:30]
        f=dict(drive=(1 if px>op else -1) if abs(px-op)>=0.25*adr else 0,on=1 if px>cx['onh'] else (-1 if px<cx['onl'] else 0),
               gap=(1 if op>cx['pdc'] else -1) if abs(op-cx['pdc'])>=0.15*adr else 0,ib=1 if px>max(b['h'] for b in ib) else (-1 if px<min(b['l'] for b in ib) else 0),
               pd=1 if px>cx['pdh'] else (-1 if px<cx['pdl'] else 0))
        sc=sum(f.values());hi=max(b['h'] for b in m);lo=min(b['l'] for b in m)
        d['signal']=dict(score=sc,features=f,px=px,adr=round(adr,2),hi=hi,lo=lo);log('score',**d['signal'])
        if abs(sc)<K: d.update(done=True,why=f'|score| {sc} < {K}');log('no_trade',why=d['why']);return
        side=1 if sc>0 else -1;stop=lo if side>0 else hi;entry=px+side*TICK;risk=side*(entry-stop)
        if risk<=0.05*adr: d.update(done=True,why='risk <= 0.05 ADR');log('no_trade',why=d['why']);return
        pools=cx['pools']+swings(bars,m[-1]['t']+D.timedelta(minutes=1),60,5*23)+swings(bars,m[-1]['t']+D.timedelta(minutes=1),240,15*6)
        tg=ranked_target(bars,pools,side,entry,risk,m[-1]['t']+D.timedelta(minutes=1))
        if not tg: d.update(done=True,why='no ranked pool >= 1R');log('no_trade',why=d['why']);return
        d['pos']=dict(side=side,entry=entry,stop=stop,target=tg[0],pool=tg[1],tR=round(tg[2],2),risk=risk,since=m[-1]['t']+D.timedelta(minutes=1))
        log('paper_fill',**d['pos'],note='simulated market fill at 09:29 close + 1 tick; NO ORDER SENT')
    p=d.get('pos')
    if not p: return
    since=D.datetime.fromisoformat(str(p['since']));bars=fetch(since)
    for b in bars:
        if mins(b['t'])>=890 or b['t'].date()!=today: return close(d,p,b['t'],prev_close(bars,b),'time 14:50')
        if p['side']*((b['l'] if p['side']>0 else b['h'])-p['stop'])<=0: return close(d,p,b['t'],p['stop']-p['side']*TICK,'stop')
        if p['side']*((b['h'] if p['side']>0 else b['l'])-p['target'])>=0: return close(d,p,b['t'],p['target'],'target '+p['pool'])
        p['last']=b['c']
    if mins(now)>=891: close(d,p,now,p.get('last',p['entry']),'time 14:50 (no later bar)')
def prev_close(bars,b):
    i=bars.index(b);return bars[i-1]['c'] if i else b['o']
def close(d,p,t,px,why):
    pts=p['side']*(px-p['entry']);Rr=pts/p['risk']
    row=dict(date=str(t.date()),signal_time_ct='09:30',score=d['signal']['score'],features=json.dumps(d['signal']['features']),side='long' if p['side']>0 else 'short',
             entry=p['entry'],stop=p['stop'],target=p['target'],target_pool=p['pool'],target_R=p['tR'],risk_pts=round(p['risk'],2),exit_time_ct=t.strftime('%H:%M'),
             exit_px=px,exit_reason=why,pts=round(pts,2),R=round(Rr,2),usd_1mnq=round(pts*MULT-FEE,2),status='closed')
    write_trade(row);log('paper_exit',**row);d.update(done=True,pos=None,result=row)
def main():
    once='--once' in sys.argv;log('start',pid=os.getpid(),mode='once' if once else 'loop')
    while True:
        now=D.datetime.now(CT);s=load_state()
        if now.weekday()<5 and 510<=mins(now)<900:
            try: step(now.date(),s);save_state(s)
            except Exception as e: log('error',err=repr(e)[:300])
        if once: break
        time.sleep(30)
if __name__=='__main__': main()
