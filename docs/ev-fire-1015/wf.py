import sys,json,collections,datetime as dt
sys.path.insert(0,'/workspace/audits/fire-logic-1015'); import os; os.chdir('/workspace/audits/fire-logic-1015')
from sim import *
os.chdir('/workspace/audits/ev-fire-1015')
REL=lambda e,allowed: set(e["fails"])<=allowed
W={'fast:persist','fast:velocity','band','second_entry_band'}
first={}
for e in EV: first.setdefault(e['sig'],e)
days=sorted({day(e) for e in EV}); H1=set(days[:len(days)//2]); H2=set(days[len(days)//2:])
# calibration samples: first eval per signal, outcome = T1 hit (true hit, not just R>0)
CAL=[]
for e in first.values():
    o=outcome(e,'now')
    if o:
        b=bars[e['sym']]; i=bisect.bisect_left(T[e['sym']],e['ts']*1000); px=b[i]['o']; sg=1 if e['side']=='long' else -1
        CAL.append((day(e),e,abs(o[0]-sg*(e['t1']-px)/(sg*(px-e['st'])))<1e-9))
def key(e): return (min(int(e['q']*20),15), e['rungs']>=5, htf_ok(e))
def build(daysel,prior=10):
    S=[(e,h) for d,e,h in CAL if d in daysel]; g=sum(h for _,h in S)/len(S)
    t=collections.defaultdict(lambda:[0,0])
    for e,h in S: t[key(e)][0]+=h; t[key(e)][1]+=1
    return lambda e: (t[key(e)][0]+prior*g)/(t[key(e)][1]+prior), g, len(S)
def evr(e,p,cap=4.0,cost=0.10): return p*min(rr(e),cap)-(1-p)-cost
FBs=set(FB)
def run_ev(P,th,qf,daysel=None,size=True,cap=4.0):
    r=simulate(lambda e,c: (daysel is None or day(e) in daysel) and e['q']>=qf and REL(e,W) and evr(e,P(e),cap)>=th)
    for x in r: x['w']=1.0 if (not size or x['band'] in FBs) else 0.5
    return r
def st(r,bk=set()):
    n=len(r)
    if not n: return dict(n=0,win=None,avgR=None,totR=0,added_losers=0,maxDD=0)
    R=[x['R']*x['w'] for x in r]; eq=0;pk=0;dd=0
    for v in R: eq+=v;pk=max(pk,eq);dd=min(dd,eq-pk)
    add=[x for x in r if (x['day'],x['sym'],x['side']) not in bk]
    return dict(n=n,win=round(sum(v>0 for v in R)/n,3),avgR=round(sum(R)/n,3),totR=round(sum(R),2),added_losers=sum(x['R']<=0 for x in add),maxDD=round(dd,2))
bk={(dt.datetime.fromtimestamp(t['t_in']).date().isoformat(),t['symbol'],t['side']) for t in D['trades']}
cur=simulate(lambda e,c: e['band'] in FB and not e['fails'])
out={'days':[days[0],days[-1],len(days)],'H1':sorted(H1)[-1],'current_desk':st(cur,bk),
     'current_desk_H1':st([x for x in cur if x['day'] in H1]),'current_desk_H2':st([x for x in cur if x['day'] in H2])}
PA,gA,nA=build(H1); PB,gB,nB=build(H2)
out['cal']=dict(H1_base=round(gA,3),H1_n=nA,H2_base=round(gB,3),H2_n=nB)
TH=[0.0,0.05,0.10,0.15,0.20,0.25,0.30,0.40]; QF=[0.40,0.45,0.48,0.50,0.52,0.55]
grid={}
for th in TH:
  for qf in QF:
    a=run_ev(PA,th,qf,H2)  # calibrate H1 -> test H2
    b=run_ev(PB,th,qf,H1)  # calibrate H2 -> test H1
    oos=sorted(a+b,key=lambda x:x['ts'])
    bp=[x for x in oos if x['band'] in FBs]
    grid[f'{th}|{qf}']=dict(test_H2=st(a),test_H1=st(b),oos=st(oos,bk),bplus=st(bp))
out['grid']=grid
# in-sample reproduction of design (uncapped RR, LODO-ish) for reference
PALL,_,_=build(set(days))
for cap in (4.0,99):
  r=run_ev(PALL,0.15,0.45,None,size=False,cap=cap); out[f'insample_th0.15_q0.45_cap{cap}_fullsize']=st(r,bk)
json.dump(out,open('wf.json','w'),indent=1)
print(json.dumps({k:v for k,v in out.items() if k!='grid'},indent=0))
print('th  qf  | H2test n/totR | H1test n/totR | OOS n win avgR totR addL DD | B+ n totR')
for k,v in grid.items():
  a,b,o,p=v['test_H2'],v['test_H1'],v['oos'],v['bplus']
  print(k.ljust(10),f"{a['n']:3}/{a['totR']:6} | {b['n']:3}/{b['totR']:6} | {o['n']:3} {o['win']} {o['avgR']} {o['totR']:6} {o['added_losers']:3} {o['maxDD']:6} | {p['n']:3} {p['totR']}")
