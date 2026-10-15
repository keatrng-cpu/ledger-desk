"""Re-run of the strictness replay with the fire-unblock rules (persist 20s per sym:side surviving failed rows,
POI half soft/exempt, velocity soft; hard: band>=B+, plan R:R>=1, entry within 0.5 ATR & not through stop, T1 not traded,
1h+4h not both against). 0DTE ATM, $300 debit, market at the fire bar. One open trade per symbol, 30-min cooldown, max 3/day."""
import json, datetime as D, sim
P=[json.loads(l) for l in open('polls.jsonl')]
EDGE={'B+':.60}
def rows(p):
    s,e,st,t1,px,atr=p['side'],p['entry'],p['stop'],p['t1'],p['px'],p['atr'] or 0
    t2=p.get('t2'); rr=lambda t:None if None in (e,st,t) or e==st else ((e-t) if s=='short' else (t-e))/abs(e-st)
    if rr(t1) is not None and rr(t1)<1.2 and t2 is not None and rr(t2) is not None and rr(t2)>=1.5 and ((t2<t1) if s=='short' else (t2>t1)): t1g=t2
    else: t1g=t1
    tfirst=t1; t1=t1g
    ok={}
    ok['band']=(p['q'] or 0)>=0.60
    sides=None not in (e,st,t1) and ((s=='long' and st<e<t1) or (s=='short' and t1<e<st))
    ok['plan']=bool(sides and abs(t1-e)/abs(e-st)>=1)
    want='bull' if s=='long' else 'bear'
    ok['agree']=not(p['b1'] not in (None,want) and p['b4'] not in (None,want))
    ok['entry']=px is not None and e is not None and atr>0 and abs(px-e)<=0.5*atr and (st is None or (px<st if s=='short' else px>st))
    ok['rr_fill']=None not in (px,st,t1) and abs(st-px)>0 and abs(t1-px)/abs(st-px)>=1 and ((t1<px<st) if s=='short' else (st<px<t1))
    dead=px is not None and ((st is not None and (px>=st if s=='short' else px<=st)) or (tfirst is not None and (px<=tfirst if s=='short' else px>=tfirst)))
    return ok,dead
streak={};fires=[];last={};day=__import__('collections').Counter()
for p in P:
    t=p['ts'];d=D.datetime.fromtimestamp(t)
    if not (D.time(8,30)<=d.time()<=D.time(14,30)): continue
    k=f"{p['sym']}:{p['side']}";ok,dead=rows(p)
    for kk in list(streak):
        if kk.split(':')[0]==p['sym'] and kk!=k: streak.pop(kk)        # side change on the book
    if dead: streak.pop(k,None); continue
    if k not in streak and ok['band'] and ok['plan'] and ok['agree']: streak[k]=t
    if k in streak and t-streak[k]>=20 and all(ok.values()):
        dk=d.date()
        if day[dk]>=3 or t-last.get(p['sym'],0)<1800: continue
        r=sim.trade(p['sym'],p['side'],t,p['px'],p['stop'],p['t1'],p.get('t2'),dte=0,budget=300,tag=d.strftime('%m/%d %H:%M:%S'))
        if r and 'skip' not in r: fires.append(r);last[p['sym']]=t;day[dk]+=1;streak.pop(k,None)
for r in fires: print(r)
print('n',len(fires),'win',sum(r['pnl']>0 for r in fires),'0DTE $',sum(r['pnl'] for r in fires),'R',round(sum(r['R'] for r in fires),2))
