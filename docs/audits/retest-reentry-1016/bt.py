"""Retest re-entry (A) + timing.mode live (B) walk-forward, ES/NQ, closed bars only. Times CT.
Data: /workspace/data/databento (GLBX.MDP3 OHLCV, get_cost $0, already on the box). Reuses the
audits/databento-1015 engine (ratio back-adjust, sweep+displacement card, BS 0DTE option model, $500 debit,
$0.03/share each side). Run: python3 bt.py  (needs /workspace/audits/databento-1015 on sys.path)."""
import sys,json,itertools
sys.path.insert(0,"/workspace/audits/databento-1015")
from common import *
import rth
from rth import opt_px,DEBIT,COST
D="/workspace/data/databento/"
CHASE_STEP=0.5;BPLUS=0.60;NEAR=0.5
def closed_series(t,vals_df,mins,col):
    s=vals_df[col].copy();s.index=s.index+pd.Timedelta(minutes=mins)   # known only once the bucket has closed
    return s.reindex(t,method="ffill").values
def prep(sym):
    o=rth.get(sym);t=pd.DatetimeIndex(o["t"])
    df=pd.DataFrame(dict(open=o["o"],high=o["h"],low=o["l"],close=o["c"],volume=0,instrument_id=o["iid"]),index=t)
    b15=resample(df,"15min");b15["atr"]=(b15.high-b15.low).rolling(14).mean()
    o["atr15"]=closed_series(t,b15,15,"atr")
    b3=resample(df,"3min");o["m3"]=bias_at(df,b3,3)
    d1=pd.read_parquet(D+f"{sym}_1d.parquet");d1.index=d1.index.tz_convert("America/Chicago")
    s=bias_series(d1);s.index=s.index+pd.Timedelta(days=1)  # daily bar known after it closes
    o["d1"]=s.reindex(t,method="ffill").fillna(0).astype(int).values
    # 30s rung: only 2026-08-16..2026-10-15 exists. last CLOSED 30s close per 1m bar end.
    s30=pd.read_parquet(D+f"{sym}_30s.parquet");s30.index=s30.index.tz_convert("America/Chicago")
    c30=s30.close.copy();c30.index=c30.index+pd.Timedelta(seconds=30)
    o["c30"]=c30.reindex(t+pd.Timedelta(minutes=1),method="ffill",tolerance=pd.Timedelta(minutes=2)).values
    o["has30"]=np.isfinite(o["c30"])
    return o
def q0_of(s):
    """Quality proxy (the desk q is not reproducible offline): disp, pool sweep, 1h/4h/1D agreement."""
    q=0.55+0.1*min(s["disp"],3.0)+(0.03 if s["pool"] else 0)
    agree=[b==s["side"] for b in (s["h1"],s["h4"],s["d1"])];opp=[b==-s["side"] for b in (s["h1"],s["h4"],s["d1"])]
    q+=0.02*sum(agree)-0.03*sum(opp);return min(q,0.85)
def card(o,s):
    """Card print at the displacement close k. distAtr = how far the CLOSED price is past the entry CE, ATR15."""
    k=s["k"];a15=o["atr15"][k]
    if not(a15>0):return None
    d=max(0.0,s["side"]*(o["c"][k]-s["ce"]))/a15
    q0=q0_of(s);qs=q0*max(0,1-0.5*d)
    return dict(d=d,q0=q0,q_shadow=qs,a15=a15,arm_shadow=qs>=BPLUS and d<=NEAR,arm_live=q0>=BPLUS and d<=NEAR)
def broken_zone(o,s):
    """The level the move broke: the last opposite-close 1m candle (OB) between sweep and displacement, plus the
    displacement 1m FVG; zone = OB body..wick on the trade side, capped inside the sweep extreme."""
    k=s["k"];sg=s["side"];h,l,c,op=o["h"],o["l"],o["c"],o["o"]
    for j in range(k-1,max(k-8,0),-1):
        if (c[j]-op[j])*sg<0:
            lo,hi=l[j],h[j]
            if sg<0 and c[k]<lo: return (lo,min(hi,s["ext"]))
            if sg>0 and c[k]>hi: return (max(lo,s["ext"]),hi)
            return None
    return None
def next_pool(o,s,since_ext,entry):
    sg=s["side"];k=s["k"];dd=o["date"][k]
    c=[p for p in o["pools"].get(dd,[])]
    lo60=o["l"][max(0,k-90):max(1,k-25)].min();hi60=o["h"][max(0,k-90):max(1,k-25)].max()
    c+= [lo60,hi60]
    c=[p for p in c if sg*(p-since_ext)>0 and sg*(p-entry)>0]   # beyond the post-break extreme (untaken)
    return min(c,key=lambda p:abs(p-entry)) if c else None
def retest(o,s,iv,entry_mode="edge",minRR=0.85,wait=90,debit=DEBIT):
    z=broken_zone(o,s)
    if z is None:return None,"no_broken_level"
    sg=s["side"];k=s["k"];h,l,c=o["h"],o["l"],o["c"]
    entry=(z[0] if sg<0 else z[1]) if entry_mode=="edge" else (z[0]+z[1])/2
    far=z[1] if sg<0 else z[0]
    stop=s["ext"]-sg*0.25*s["atr"];R=abs(stop-entry)
    if R<=0 or sg*(entry-stop)<=0:return None,"bad_stop"
    ext=l[k] if sg<0 else h[k];j=None
    for x in range(k+1,min(k+1+wait,len(c))):
        if o["mins"][x]>=840 or o["date"][x]!=o["date"][k]:return None,"expired"
        touched=(h[x]>=entry) if sg<0 else (l[x]<=entry)
        if touched and x>k+1:
            tgt=next_pool(o,s,ext,entry)
            if tgt is None:return None,"no_pool"
            rr=abs(tgt-entry)/R
            if rr<minRR:return None,"rr<min"
            if o["has30"][x-1] and sg*(o["c30"][x-1]-far)<0:return None,"30s_closed_through"
            j=x;break
        ext=min(ext,l[x]) if sg<0 else max(ext,h[x])
        if sg*(c[x]-far)<0:return None,"level_reclaimed"   # closed back through the broken level: void
    if j is None:return None,"no_retest"
    ratio=ETF[o["sym"]][0];S0=entry/ratio;K=round(S0);call=sg>0;cl=900
    p0=opt_px(S0,K,cl-o["mins"][j],iv,call)+COST;n=debit/(p0*100)
    x=j;px=None
    while x<len(c):
        if o["mins"][x]>=890 or o["date"][x]!=o["date"][j]:px,why,xx=c[x-1],"time",x-1;break
        if sg*((l[x] if sg>0 else h[x])-stop)<=0:px,why,xx=stop,"stop",x;break   # stop first on a two-sided bar
        if x>j and sg*((h[x] if sg>0 else l[x])-tgt)>=0:px,why,xx=tgt,"target",x;break
        x+=1
    if px is None:return None,"eod"
    Rr=sg*(px-entry)/R
    usd=(max(opt_px(px/ratio,K,cl-o["mins"][xx],iv,call)-COST,0)-p0)*100*n
    return dict(date=str(o["date"][j]),t=str(o["t"][j]),sym=o["sym"],side=sg,R=Rr,usd=usd,rr=rr,exit=why,end=xx,kind="retest"),"filled"
def run(o,mode,cfg,years):
    res=[];busy=-1;cnt={};funnel={}
    for s in o["sigs"]:
        k=s["k"];yr=o["t"][k].year
        if yr not in years or k<=busy:continue
        dd=o["date"][k]
        if cnt.get(dd,0)>=3:continue
        iv=o["ivs"].get(dd)
        if iv is None or not np.isfinite(iv):continue
        s=dict(s,d1=o["d1"][k],m3=o["m3"][k])
        if s["h1"]==-s["side"] and s["h4"]==-s["side"]:continue   # 1h+4h both oppose: no card
        cd=card(o,s)
        if cd is None:continue
        armed=cd["arm_live"] if mode in("B","AB") else cd["arm_shadow"]
        r=None
        if armed:
            r=rth.trade(o,s,iv)
            if r is not None:r["kind"]="card"
        if r is None and mode in("A","AB"):
            r,why=retest(o,s,iv,**cfg);funnel[why]=funnel.get(why,0)+1
        if r is None:continue
        res.append(r);busy=r["end"];cnt[dd]=cnt.get(dd,0)+1
    return pd.DataFrame(res),funnel
GRID=[dict(entry_mode=e,minRR=m,wait=w) for e,m,w in itertools.product(["edge","ce"],[0.85,1.2],[60,90])]
def wf(objs,mode):
    out=[];picks={};fun={}
    for ty in range(2021,2027):
        tr=list(range(2019,ty))
        if mode in("A","AB"):
            best=max(GRID,key=lambda g:sum(run(o,mode,g,tr)[0].get("usd",pd.Series(dtype=float)).sum() for o in objs))
        else: best=GRID[0]
        picks[ty]=best
        for o in objs:
            df,f=run(o,mode,best,[ty]);out.append(df)
            for a,b in f.items():fun[a]=fun.get(a,0)+b
    return pd.concat(out,ignore_index=True),picks,fun
if __name__=="__main__":
    objs=[]
    for sym in("NQ","ES"):
        o=prep(sym);o["sym"]=sym;objs.append(o)
    t0=pd.Timestamp("2021-01-01",tz="America/Chicago");t1=pd.Timestamp(objs[0]["t"][-1])
    weeks=(t1-t0).days/7
    R={}
    for mode in("base","A","B","AB"):
        df,picks,fun=wf(objs,mode)
        row=summ(df,weeks=weeks) if len(df) else dict(n=0)
        if len(df):
            row["trades_wk"]=round(len(df)/weeks,2);row["R_per_tr"]=row.pop("avgR")
            row["retest_n"]=int((df.kind=="retest").sum()) if "kind" in df else 0
            if row["retest_n"]:
                rt=df[df.kind=="retest"];row["retest"]=dict(n=len(rt),win=round(float((rt.R>0).mean()),3),R=round(float(rt.R.mean()),3),usd_tr=round(float(rt.usd.mean()),1))
            row["by_year"]={str(y):dict(n=int(len(g)),R=round(float(g.R.mean()),3),usd=round(float(g.usd.sum()))) for y,g in df.groupby(pd.to_datetime(df.date).dt.year)}
            for s in("NQ","ES"):
                g=df[df.sym==s];row[s]=dict(n=len(g),win=round(float((g.R>0).mean()),3),R=round(float(g.R.mean()),3),usd_wk=round(float(g.usd.sum())/weeks,1))
        row["picks"]={str(k):v for k,v in picks.items()};row["retest_funnel"]=fun
        R[mode]=row;df.to_csv(f"trades_{mode}.csv",index=False);print(mode,json.dumps(row,default=str))
    R["_meta"]=dict(oos="2021-01-01..%s"%t1.date(),weeks=round(weeks,1),cost_usd=0.0,data="/workspace/data/databento (on box, get_cost 0.0)")
    json.dump(R,open("results.json","w"),indent=1,default=str)
