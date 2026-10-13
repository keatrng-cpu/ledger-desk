// Feature dump of the backtest engine trades for scripts/measure-loss-patterns.mts (replays engine.replayDay exactly; read-only use of the engine).
// Input: Yahoo 1m JSON per symbol in $LOSS_DATA (default /workspace/lossdata). Output: $LOSS_DATA/feat.json
// feature dump for the 83 audit trades (replicates engine.replayDay exactly; adds path + context features)
import { readFileSync, writeFileSync } from "node:fs";
import RULES from "../shared/desk-rules.json";
import { mtfArrays } from "@/lib/smc/mtf-arrays";
import { ltfReversalsOf, buildMtfContext, htfBiasOf } from "@/lib/smc/mtf-context";
import { sanePlan, displacementStrength } from "@/lib/smc/exec-context";
import { rollingAtr, fractalSwings } from "@/lib/trading/detectors";
import { et } from "@/lib/smc/day-context";
import { resample, resolve1m, type Bar } from "@/lib/backtest/engine";
const out:any[]=[];
for(const [sym,y] of [["MNQ","NQ=F"],["ES","ES=F"]] as const){
 const all:Bar[]=JSON.parse(readFileSync(`${process.env.LOSS_DATA ?? "/workspace/lossdata"}/${y}.json`,"utf8"));const byDay=new Map<string,Bar[]>();
 for(const b of all){const e=et(b.t);if(e.wd==="Sat"||e.wd==="Sun")continue;const k=new Date(b.t-4*3600000).toISOString().slice(0,10);(byDay.get(k)??byDay.set(k,[]).get(k)!).push(b);}
 for(const d of [...byDay.keys()].sort().filter(d=>d>="2026-09-30"&&d<="2026-10-12")){
  const m1=byDay.get(d)!.filter(b=>{const m=et(b.t).min;return m>=570&&m<=960;});if(m1.length<300)continue;
  const hist=all.filter(b=>b.t<m1[0]!.t&&b.t>m1[0]!.t-3*86400000);const m15hist:Bar[]=[];for(const b of hist){const k=Math.floor(b.t/900000)*900000;const L=m15hist[m15hist.length-1];if(L&&L.t===k){L.h=Math.max(L.h,b.h);L.l=Math.min(L.l,b.l);L.c=b.c;}else m15hist.push({...b,t:k});}
  const seen=new Set<string>();let busy=0;
  for(let i=60;i<m1.length;i+=5){const b=m1[i]!;const e=et(b.t);if(e.min<575||e.min>900)continue;if(b.t<busy)continue;
   const win=m1.slice(Math.max(0,i-400),i+1);const cw=win.concat([{...b,t:b.t+60000}]);
   const b15=[...m15hist,...resample(m1.slice(0,i+1),900000).slice(0,-1)].filter(x=>x.t+900000<=b.t+60000);
   const a=rollingAtr(b15 as never);const atr=a[a.length-1];if(!(atr>0))continue;
   const kills=ltfReversalsOf(mtfArrays(sym,cw as never,[]) as never,cw as never);
   for(const k of kills){const key=`${k.against}:${k.killT}`;if(seen.has(key))continue;seen.add(key);if(k.killT<b.t-300000)continue;
    const side=k.against==="long"?"short":"long";const entry=b.c;const kind=side==="short"?"high":"low";
    const b5=resample(win,300000).slice(0,-1);
    const swings=[...fractalSwings(b5 as never,2),...fractalSwings(b15.slice(-40) as never,2)].filter((x:any)=>x.kind===kind).map((x:any)=>x.price);
    const lv=fractalSwings(b15.slice(-80) as never,2) as any[];const levels=lv.map(x=>x.price);
    const want=side==="long"?levels.filter(l=>l>entry).sort((x,y)=>x-y):levels.filter(l=>l<entry).sort((x,y)=>y-x);
    const floorStop=side==="short"?entry+RULES.minStopAtr*atr:entry-RULES.minStopAtr*atr;
    const near=swings.filter(s=>side==="short"?s>entry:s<entry).sort((x,y)=>Math.abs(x-entry)-Math.abs(y-entry))[0];
    const stop0=near??floorStop;
    const tgt=want.find(t=>sanePlan({side,entry,stop:stop0,t1:t,t2:null},atr,swings,levels).ok);if(tgt==null)continue;
    const sp=sanePlan({side,entry,stop:stop0,t1:tgt,t2:null},atr,swings,levels);
    const r=resolve1m(m1,i,side,entry,sp.stop,tgt,90);const risk=Math.abs(entry-sp.stop);
    const R=r.outcome==="open"?null:+((side==="long"?r.px-entry:entry-r.px)/risk).toFixed(2);
    // path (pts, favourable/adverse per minute, up to 90m, ignoring exit) for re-simulation
    const path=m1.slice(i+1,i+91).map(x=>[x.o,x.h,x.l,x.c]);
    // context at entry (desk functions)
    const b15full=(()=>{const src=all.filter(x=>x.t<=b.t);const o:Bar[]=[];for(const x of src){const kk=Math.floor(x.t/900000)*900000;const L=o[o.length-1];if(L&&L.t===kk){L.h=Math.max(L.h,x.h);L.l=Math.min(L.l,x.l);L.c=x.c;}else o.push({...x,t:kk});}return o.filter(x=>x.t+900000<=b.t+60000);})();
    const minuteAll=all.filter(x=>x.t<=b.t).slice(-400).concat([{...b,t:b.t+60000}]);
    const ctx=buildMtfContext({symbol:sym,minute:minuteAll as never,bars15:b15full as never},{symbol:sym==="MNQ"?"ES":"MNQ",minute:[] ,bars15:[]});
    const hb=htfBiasOf(ctx,sym);const book=ctx.books[0]!;
    const pool=side==="long"?"sellside":"buyside";
    const sweep=book.rungs.some(rg=>["5m","15m"].includes(rg.tf)&&rg.sweep?.side===pool);
    const ds=displacementStrength(minuteAll as never,side);
    const disp=ds!=null&&ds.bodyAtr>=1&&ds.leftFvg;
    const tol=0.1*atr;const touches=lv.filter(x=>Math.abs(x.price-tgt)<=tol).length;
    const prevDay=hist.filter(x=>{const m=et(x.t).min;return m>=570&&m<=960;}).slice(-391);
    const pdh=prevDay.length?Math.max(...prevDay.map(x=>x.h)):null,pdl=prevDay.length?Math.min(...prevDay.map(x=>x.l)):null;
    out.push({day:d,symbol:sym,side,t:b.t,et:e.min,entry,stop:sp.stop,stop0,structural:near??null,target:tgt,rr:sp.rr1,atr,risk,outcome:r.outcome,r:R,minutes:r.j-i,
      killLevel:k.level,why:k.why[0],bias1h:hb?.bias1h??null,bias4h:hb?.bias4h??null,sweep,disp,dispScore:ds?.score??null,tgtTouches:touches,pdh,pdl,
      prior:m1.slice(Math.max(0,i-60),i+1).map(x=>[x.o,x.h,x.l,x.c]),path,
      sessHi:Math.max(...m1.slice(0,i+1).map(x=>x.h)),sessLo:Math.min(...m1.slice(0,i+1).map(x=>x.l))});
    busy=m1[r.j]?.t??b.t;break;}}}}
writeFileSync(`${process.env.LOSS_DATA ?? "/workspace/lossdata"}/feat.json`,JSON.stringify(out));
const d=out.filter(t=>t.r!=null);console.log(out.length,d.filter(t=>t.r>0).length,d.reduce((a,t)=>a+t.r,0).toFixed(2));
