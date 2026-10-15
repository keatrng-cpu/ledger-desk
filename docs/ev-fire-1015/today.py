import json,re,datetime as dt,sys
sys.path.insert(0,'.')
exec(open('wf.py').read().split("TH=[")[0].replace("print(","(lambda *a,**k:None)("))  # reuse cal + helpers, no sweep
PALL,_,_=build(set(days))
SKIP=('account','no_','live_quote','sizing','buying','shadow','soft:','exec_account','tape_fresh','card_age','rules_')
want={'08:30':None,'08:40':None,'08:55':None}
for l in open('/workspace/desk-watcher/gates.log'):
    try:g=json.loads(l)
    except: continue
    t=dt.datetime.fromtimestamp(g['ts'])
    if t.date().isoformat()!='2026-10-15': continue
    hm=t.strftime('%H:%M')
    if hm not in want or want[hm] is not None: continue
    gd={n:(ok,why or '') for n,ok,why in g['gates']}
    m=re.search(r'entry ([\d.]+) stop ([\d.]+) T1 ([\d.]+) side (\w+)',gd.get('fast:plan',(0,''))[1])
    if not m: continue
    rung=re.search(r'holds on (\d+) rungs',gd.get('shadow:smc:continuation',(0,''))[1])
    e=dict(q=g.get('q') or 0,e=float(m[1]),st=float(m[2]),t1=float(m[3]),side=m[4],rungs=int(rung[1]) if rung else 0,htf=gd.get('soft:htf_bias',(0,''))[1],band=g.get('band'))
    fails=[n for n,ok,_ in g['gates'] if ok is not True and not n.startswith(SKIP)]
    p=PALL(e); ev=evr(e,p)
    want[hm]=dict(time=t.strftime('%H:%M:%S'),band=e['band'],q=e['q'],side=e['side'],entry=e['e'],stop=e['st'],t1=e['t1'],rr=round(rr(e),2),p=round(p,3),evR=round(ev,3),
      hard_fails=sorted(set(fails)&(HARD|{'fast:entry'})),all_fails=fails,entry_txt=gd.get('fast:entry',(0,''))[1])
json.dump(want,open('today.json','w'),indent=1); print(json.dumps(want,indent=1))
