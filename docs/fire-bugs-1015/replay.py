"""fire-bugs-live 10/15: copy of audits/fire-fail-1015/replay.py plus replay_live() (confirmPolls / maxActionableAgeS, geometry fix).
Read-only dry-run replay of desk-watcher gates.log/cards.log.
Ranks hard blocks on B+-or-better rows, then replays fires with only bug-class gates fixed."""
import json,re,collections,datetime as D,sys
W='/workspace/desk-watcher/'
rows=[json.loads(l) for l in open(W+'gates.log') if l.strip()]
GOOD=('B+','A-','A','A+')
def ct(ts): return D.datetime.fromtimestamp(ts)  # box clock = CT
def hard_fails(r): return [g for g in r['gates'] if g[1] is False and not g[0].startswith(('shadow','soft'))]
# ---------- 1. block census ----------
good=[r for r in rows if r['band'] in GOOD]
blk=collections.Counter(); sole=collections.Counter(); sig_blk=collections.defaultdict(collections.Counter); sigs={}
for r in good:
    f=[g[0] for g in hard_fails(r)]
    for x in f: blk[x]+=1; sig_blk[x][r['signal']]+=1
    if len(f)==1: sole[f[0]]+=1
    sigs.setdefault(r['signal'],[]).append(r)
# ---------- 2. price series ----------
px=collections.defaultdict(list)
for l in open(W+'cards.log'):
    try: j=json.loads(l)
    except: continue
    q=j['card'].get('quotes') or {}
    for k in('left','right'):
        v=q.get(k) or {}
        if v.get('price'): px[v['symbol']].append((j['ts'],v['price']))
for r in rows:   # gate rows also carry a price
    for g in r['gates']:
        if g[0]=='fast:entry':
            m=re.search(r'px ([\d.]+)',g[2])
            if m: p=float(m.group(1)); px['MNQ' if p>15000 else 'ES'].append((r['ts'],p))
for k in px: px[k].sort()
# ---------- 3. replay ----------
num=lambda s:float(s) if s not in(None,'None') else None
def parse(r):
    g={x[0]:x for x in r['gates']}
    if 'fast:plan' not in g: return None
    m=re.search(r'entry (\S+) stop (\S+) T1 (\S+) side (\w+)',g['fast:plan'][2])
    if not m: return None
    e,s,t1,side=num(m.group(1)),num(m.group(2)),num(m.group(3)),m.group(4)
    pm=re.search(r'px ([\d.]+)',g['fast:entry'][2]); p=float(pm.group(1)) if pm else None
    if p is None or e is None: return None
    t2=None; gm=re.search(r'T2 ([\d.]+) not beyond',g['fast:geometry'][2]) or re.search(r'/ T2 ([\d.]+)',g['fast:geometry'][2])
    if gm: t2=float(gm.group(1))
    return dict(g=g,e=e,s=s,t1=t1,t2=t2,side=side,px=p,sym='MNQ' if p>15000 else 'ES')
def geom_fixed(d):
    """bug fix: ignore the desk Floor ticket of another setup, and drop a malformed T2 instead of refusing."""
    w=d['g']['fast:geometry'][2]
    if d['g']['fast:geometry'][1]: return True
    parts=[p for p in w.split('; ') if not p.startswith('desk Floor ticket') and 'not beyond T1' not in p]
    return not parts
def outcome(d,t0):
    L=d['side']=='long'; e=d['px']; st=d['s']; t1=d['t1']; risk=abs(e-st)
    t2=d['t2'] if d['t2'] and ((d['t2']>t1) if L else (d['t2']<t1)) else (t1+(t1-e))
    end=ct(t0).replace(hour=14,minute=50).timestamp(); half=False; R=0.0
    for ts,p in px[d['sym']]:
        if ts<=t0: continue
        if ts>end: R+= (0.5 if half else 1)*((p-e) if L else (e-p))/risk; return R,'time 14:50',ts
        if (p<=st if L else p>=st): R+=(0.5 if half else 1)*((st-e) if L else (e-st))/risk; return R,('BE after T1' if half else 'stop'),ts
        if not half and (p>=t1 if L else p<=t1): R+=0.5*abs(t1-e)/risk; half=True; st=e
        if half and (p>=t2 if L else p<=t2): R+=0.5*abs(t2-e)/risk; return R,'T1+T2',ts
    p=px[d['sym']][-1][1]; R+=(0.5 if half else 1)*((p-e) if L else (e-p))/risk; return R,'open (end of log)',None
def replay(hold_s, grace_s, fix_geom=True, fix_persist=True):
    fires=[]; streak={}; lastgood={}; day_n=collections.Counter(); busy_until=0
    for r in rows:
        d=parse(r)
        if not d: continue
        g=d['g']; key=d['sym']+':'+d['side']
        setup=[g[n][1] for n in('band','fast:plan','fast:entry','fast:agree','fast:velocity') if n in g]
        setup.append(geom_fixed(d) if fix_geom else g['fast:geometry'][1])
        ok=all(setup)
        if fix_persist:
            if ok:
                if key not in streak or r['ts']-lastgood.get(key,0)>grace_s: streak[key]=r['ts']
                lastgood[key]=r['ts']; held=r['ts']-streak[key]
            else: held=-1
        else:
            held=-1
            m=re.search(r'held ([\d.]+)s',g['fast:persist'][2])
            if ok and m: held=float(m.group(1))
        other=[x[0] for x in hard_fails(r) if x[0] not in('band','fast:persist','fast:plan','fast:entry','fast:agree','fast:velocity','fast:geometry')]
        day=ct(r['ts']).date()
        if ok and held>=hold_s and not other and day_n[day]<2 and r['ts']>busy_until:
            R,why,te=outcome(d,r['ts']); day_n[day]+=1; busy_until=te or 9e18
            fires.append(dict(t=ct(r['ts']).strftime('%m-%d %H:%M:%S'),sym=d['sym'],side=d['side'],band=r['band'],px=d['px'],entry=d['e'],stop=d['s'],t1=d['t1'],R=round(R,2),exit=why,exit_t=ct(te).strftime('%H:%M') if te else '-',sig=r['signal']))
    return fires

def replay_live(confirm=2, max_age=90, fix_geom=True):
    """Live rules of this PR: no hold timer; fire the first time the setup (sym:side:entry) is actionable once it passed
    `confirm` consecutive polls and is <= max_age s since first actionable; reset on invalidation / side change."""
    fires=[]; by={}; last=None; day_n=collections.Counter(); busy_until=0
    for r in rows:
        d=parse(r)
        if not d: continue
        g=d['g']; sid=f"{d['sym']}:{d['side']}:{d['e']}"; L=d['side']=='long'
        for k in [k for k in by if k.split(':')[0]==d['sym'] and k.split(':')[1]!=d['side']]: by.pop(k)
        if (d['s'] is not None and (d['px']<=d['s'] if L else d['px']>=d['s'])) or (d['t1'] is not None and (d['px']>=d['t1'] if L else d['px']<=d['t1'])):
            by.pop(sid,None); last=None; continue
        setup=[g[n][1] for n in('band','fast:plan','fast:entry','fast:agree','fast:velocity') if n in g]
        setup.append(geom_fixed(d) if fix_geom else g['fast:geometry'][1])
        if not all(setup):
            if sid in by: by[sid]['n']=0
            last=None; continue
        c=by.setdefault(sid,{'first':r['ts'],'n':0}); c['n']=c['n']+1 if last==sid else 1; last=sid
        other=[x[0] for x in hard_fails(r) if x[0] not in('band','fast:persist','fast:plan','fast:entry','fast:agree','fast:velocity','fast:geometry')]
        day=ct(r['ts']).date()
        if c['n']>=confirm and r['ts']-c['first']<=max_age and not other and day_n[day]<2 and r['ts']>busy_until and not c.get('fired'):
            R,why,te=outcome(d,r['ts']); day_n[day]+=1; busy_until=te or 9e18; c['fired']=True
            fires.append(dict(t=ct(r['ts']).strftime('%m-%d %H:%M:%S'),sym=d['sym'],side=d['side'],band=r['band'],px=d['px'],entry=d['e'],stop=d['s'],t1=d['t1'],R=round(R,2),exit=why,exit_t=ct(te).strftime('%H:%M') if te else '-',age_s=round(r['ts']-c['first'],1),sig=r['signal']))
    return fires
if __name__=='__main__':
    out={}
    V={'as_is_90s':lambda:replay(90,0,False,False),'live_confirm2_age90_geomfix':lambda:replay_live(2,90,True),'live_confirm2_age90_no_geomfix':lambda:replay_live(2,90,False),'live_confirm3_age90_geomfix':lambda:replay_live(3,90,True)}
    for k,f in V.items():
        out[k]=f(); print('\n##',k,len(out[k]),'fires, sumR',round(sum(x['R'] for x in out[k]),2))
        for x in out[k]: print(x)
    json.dump(out,open('replay-results.json','w'),indent=1,default=str)
