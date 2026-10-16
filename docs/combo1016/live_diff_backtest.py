"""Quantify how the desk's existing hard rules change SMC's config1_trail backtest (pnl-push summ.pkl C_70_trail, VAL 2024-01-01..2026-10-09).
Option $ per trade = pnl-push pp4 opt_trade (0DTE SPY/QQQ ATM, BS, round() strike) at the config1 tier ($250 base / $500 A+ per R).
usage: python live_diff_backtest.py [out.json]"""
import pandas as pd, numpy as np, math, json, sys
from scipy.stats import norm
TZ='America/Chicago'; T=lambda s:pd.Timestamp(s,tz=TZ)
V0_,V1_=T('2024-01-01'),T('2026-10-10')
S=pd.read_pickle('/workspace/audits/smc-research/pnl-push/summ.pkl'); tr=S['C_70_trail'].copy()
tr=tr[(tr.t>=V0_)&(tr.t<V1_)].sort_values('t').reset_index(drop=True)
MULT={'ES':10.0,'NQ':41.0}; SPREAD={'ES':0.02,'NQ':0.03}; FEE=0.65
def bs(S_,K,tau,sig,cp):
    if tau<=1e-6: return max(0,(S_-K)*cp)
    d1=(math.log(S_/K)+0.5*sig*sig*tau)/(sig*math.sqrt(tau)); d2=d1-sig*math.sqrt(tau)
    return cp*(S_*norm.cdf(cp*d1)-K*norm.cdf(cp*d2))
def opt(r,risk_usd,ncap=None):
    s=1 if r.side=='long' else -1; m=MULT[r.sym]; S0=r.entry/m; K=round(S0)
    sig=max(0.08,min(0.8,(r.a5/r.entry)*math.sqrt(78*252)*0.9)); ft=r.fill_t; ml=max(5,(15*60)-(ft.hour*60+ft.minute)); Y=525600.0
    V0=bs(S0,K,ml/Y,sig,s)+SPREAD[r.sym]; Vst=bs((r.entry-s*r.risk)/m,K,ml/Y,sig,s)-SPREAD[r.sym]; lossc=(V0-Vst)*100+2*FEE
    if lossc<=0: return None
    n=max(1,math.floor(risk_usd/lossc))
    if ncap is not None: n=min(n,ncap)
    if n<1: return dict(n=0,V0=V0,pnl=0.0,lossc=lossc)
    pnl=-2*FEE*n
    for f,px,dm in r.L_TR: V=bs(px/m,K,max(0,ml-dm)/Y,sig,s)-SPREAD[r.sym]; pnl+=f*n*(max(V,0)-V0)*100
    return dict(n=n,V0=V0,pnl=pnl,lossc=lossc,K=K)
tr['usdR']=np.where(tr.S2>=85,500,250)
tr['exit_t']=[r.fill_t+pd.Timedelta(minutes=max(dm for _,_,dm in r.L_TR)) for r in tr.itertuples()]
tr['day']=tr.t.dt.date
o=[opt(r,r.usdR) for r in tr.itertuples()]
tr['n']=[x['n'] if x else 0 for x in o]; tr['V0']=[x['V0'] if x else np.nan for x in o]; tr['pnl']=[x['pnl'] if x else 0.0 for x in o]
tr['debit']=tr.n*tr.V0*100
NW=len(pd.period_range(V0_.tz_localize(None),(V1_-pd.Timedelta('1D')).tz_localize(None),freq='W-FRI'))
def summ(df,col='pnl'):
    w=df.groupby('wk')[col].sum()
    return dict(n=int(len(df)),usd_wk=round(df[col].sum()/NW,1),wr=round(float((df[col]>0).mean()),3) if len(df) else None,worst_wk=round(float(w.min()),0) if len(w) else 0)
base=summ(tr)
def cap650(df):
    d=df.copy(); nc=[]; p=[]
    for r in d.itertuples():
        c=int(650//(r.V0*100)) if r.V0==r.V0 else 0
        x=opt(r,r.usdR,ncap=c); nc.append(x['n']); p.append(x['pnl'])
    d['n']=nc; d['pnl']=p; return d[d.n>0]
def seq(df,daystop=None,weeklock=None,one_open=False,flat_ct=None):
    keep=[]; day={}; wk={}; busy=None; dropped={}
    for r in df.itertuples():
        if flat_ct is not None and r.fill_t.hour*60+r.fill_t.minute>=flat_ct: dropped['after_flat']=dropped.get('after_flat',0)+1; continue
        if daystop is not None and day.get(r.day,0)<=-daystop: dropped['day_stop']=dropped.get('day_stop',0)+1; continue
        if weeklock is not None and wk.get(r.wk,0)<=-weeklock: dropped['week_lock']=dropped.get('week_lock',0)+1; continue
        if one_open and busy is not None and busy>=r.fill_t: dropped['one_open']=dropped.get('one_open',0)+1; continue
        keep.append(r.Index); day[r.day]=day.get(r.day,0)+r.pnl; wk[r.wk]=wk.get(r.wk,0)+r.pnl; busy=r.exit_t
    return df.loc[keep], dropped
res={'backtest (config1, VAL, option $ at $250/$500 per R)':base}
d=cap650(tr); res['$650 debit cap']={**summ(d),'trades_cut_contracts':int((d.n<tr.set_index(tr.index).loc[d.index,'n']).sum()),'trades_dropped':int(len(tr)-len(d)),'A+_trades':int((tr.S2>=85).sum()),'backtest_debit_over_650':int((tr.debit>650).sum())}
for nm,kw in [('daily stop $150',dict(daystop=150)),('weekly lock -$300',dict(weeklock=300)),('1 open position across ES+NQ (no_position)',dict(one_open=True)),('flat/fills cut at 14:30 CT (FLAT_BY_ET 15:30 default)',dict(flat_ct=870))]:
    k,dr=seq(tr,**kw); res[nm]={**summ(k),'dropped':dr}
late=tr[tr.exit_t.dt.hour*60+tr.exit_t.dt.minute>870]; res['flat/fills cut at 14:30 CT (FLAT_BY_ET 15:30 default)']['open_past_1430_not_resimmed']=dict(n=int(len(late)),pnl=round(float(late.pnl.sum()),0))
lim=tr[(tr.fill_t-tr.t)>pd.Timedelta('1min')]; res['limit fills (filled after the signal bar)']=dict(n=int(len(lim)),pnl_wk=round(float(lim.pnl.sum())/NW,1))
k,dr=seq(cap650(tr),daystop=150,weeklock=300,one_open=True,flat_ct=870); res['ALL quantified rules combined']={**summ(k),'dropped':dr}
k,dr=seq(tr,one_open=True,flat_ct=870); res['REMAINING after Keaton 10/16 bypasses (no_position + 14:30 CT flat)']={**summ(k),'dropped':dr}

# ---- re-simulate the TR exit on real 1m bars with a live cut (research ExitSim: stop first, 50%@1R->BE, trail MFE-1R, close at the last bar)
BARS={k:pd.read_parquet(f'/workspace/bt13w/cache/{k}.parquet') for k in ['ES','NQ']}
def tr_sim(r,cut_tod):
    d=BARS[r.sym]; ft=r.fill_t; i0=d.index.searchsorted(ft); i1=d.index.searchsorted(ft.normalize()+pd.Timedelta(minutes=cut_tod),side='right')
    day=d.iloc[i0:i1]
    if not len(day): return None
    s=1 if r.side=='long' else -1; e=r.entry; rk=r.risk; st=e-s*rk; rem=1.0; R=0.0; t1=False; hw=0.0; legs=[]
    H,L,C=day.high.values,day.low.values,day.close.values
    for k in range(len(day)):
        adv=H[k]-e if s==1 else e-L[k]
        if (s==1 and L[k]<=st) or (s==-1 and H[k]>=st): R+=rem*(st-e)*s/rk; legs.append((rem,st,k)); return R-0.5/rk,legs
        if not t1 and adv>=rk: t1=True; R+=0.5; rem=0.5; legs.append((0.5,e+s*rk,k)); st=e
        if t1: hw=max(hw,adv/rk); st=e+s*max(0,hw-1)*rk
    R+=rem*(C[-1]-e)*s/rk; legs.append((rem,C[-1],len(day)-1)); return R-0.5/rk,legs
def cut_scn(df,fill_block_tod,exit_cut_fn):
    out=[]
    for r in df.itertuples():
        ftod=r.fill_t.hour*60+r.fill_t.minute
        if ftod>=fill_block_tod: continue
        x=tr_sim(r,exit_cut_fn(ftod))
        if x is None: continue
        R,legs=x; rr=r._replace(L_TR=legs); o=opt(rr,r.usdR)
        out.append(dict(wk=r.wk,pnl=o['pnl'] if o else 0.0,R=R))
    return pd.DataFrame(out)
chk=cut_scn(tr,9999,lambda f:895); res['re-sim check (14:55 CT, should equal backtest)']=summ(chk)
# live: entry cutoff 15:40 ET = 14:40 CT; 0DTE opens until 15:25 ET (14:25 CT) flat at zeroDteFlatEt 15:40 ET (14:40 CT); later fills get 1DTE, flat at flatByMaxEt 15:50 ET (14:50 CT)
live=cut_scn(tr,880,lambda f:879 if f<865 else 889)
res['REMAINING (RH/session clocks): entry cutoff 14:40 CT, 0DTE flat 14:40 CT, flatByMaxEt 14:50 CT']=summ(live)
res['loss timing (live counts a loss at close; tests/test_combo1016_live.py replay)']=dict(n_extra=50,R=-9.88,usd_wk_approx=round(-9.88*250/NW,1))
res['_notes']={'weeks':NW,'daily stop 15% leg':'15% of equity binds before $150 only when equity < $1000 (not modelled)'}
print(json.dumps(res,indent=1,default=str))
if len(sys.argv)>1: json.dump(res,open(sys.argv[1],'w'),indent=1,default=str)
