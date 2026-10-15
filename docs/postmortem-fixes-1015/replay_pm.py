"""Post-mortem 13:02 fixes, each gated by the 10/13-10/15 replay (stacked on docs/unblock-2-1015/replay_unblock2.py).
Read-only: gates.log/cards.log of desk-watcher + cached 1m bars (Databento GLBX, $0 get_cost, + Supabase tail from the post-mortem).
Fix toggles (each single and cumulative):
 F1 ifvg1m   : hard on B+/A-: a 1m CLOSE through a same-side 5m/15m FVG (formed <= 60 min) within 15 min, not reclaimed; partner (NQ<->ES) did the same -> -0.10 q
 F3 htfq     : any 1h/4h opposition -> -0.05 q AND needs sweep | displacement | brain TAKE (replaces the half-size path)
 F4 standgap : B+ hard block when brain STAND AND the Floor note 'gaps are not this side' appear together
 F5 pmq      : B+ at/after 13:00 ET -> -0.05 q (soft)
 F6 pdq      : long above 0.75 of the RTH range -> -0.03 q (-0.06 when T1 is the session high = swept pool); mirrored for shorts
 F7 rrfill   : R:R measured from the fill price, min 1.0 (hard)
 F8 eqlstop  : stop beyond the equal-low pool (desk shadow:desk:stop: swing + max(0.1xATR15, MAE p90)), R:R re-checked
q penalties re-band: band = min(logged band, band(q - penalty)) with the unchanged edges."""
import sys, re, json, bisect, collections, pandas as pd
sys.path.insert(0, '../unblock-2-1015'); sys.path.insert(0, '../fire-bugs-1015'); sys.path.insert(0, '/workspace/audits/fire-fail-1015')
import replay_unblock2 as U
L = U.L; RP = U.RP; RANK = U.RANK; LAD = U.LAD
EDGES = [('A+', .75), ('A', .68), ('A-', .65), ('B+', .60), ('B', .50)]
def band_of(q): return next((b for b, e in EDGES if q >= e - 1e-9), 'C')
PM = '/workspace/audits/postmortem-1302/'
b = pd.read_parquet(PM + 'bars1m.parquet'); b.index = b.index.tz_convert('America/Chicago')
BARS = {}
for s, k in (('ES', 'ES.c.0'), ('MNQ', 'NQ.c.0')):
    x = b[b.symbol == k][['open', 'high', 'low', 'close']]; t = pd.read_pickle(PM + f"{k[:2]}_1m.pkl")[['open', 'high', 'low', 'close']]
    x = pd.concat([x, t[t.index > x.index[-1]]]); BARS[s] = x[~x.index.duplicated()].sort_index()
PART = {'ES': 'MNQ', 'MNQ': 'ES'}
def tf(df, m): return df.resample(f'{m}min', label='left', closed='left').agg({'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last'}).dropna()
TF = {s: {m: tf(BARS[s], m) for m in (5, 15)} for s in BARS}
import functools
def ifvg1m(sym, side, ts): return _ifvg1m(sym, side, int(ts // 60) * 60)
def n5(sym, side, ts): return _ifvg1m(sym, side, int(ts // 60) * 60, True)
@functools.lru_cache(None)
def _ifvg1m(sym, side, ts, count5=False):
    """(hit, why): a 1m close through a same-side 5m/15m FVG formed within 60 min, within the last 15 min, not reclaimed."""
    t = pd.Timestamp(ts, unit='s', tz='UTC').tz_convert('America/Chicago'); one = BARS[sym]
    c1 = one[(one.index + pd.Timedelta(minutes=1) <= t) & (one.index >= t - pd.Timedelta(minutes=60))]
    n = 0
    for m, df in TF[sym].items():
        if count5 and m != 5: continue
        df = df[(df.index + pd.Timedelta(minutes=m) <= t) & (df.index >= t - pd.Timedelta(minutes=60 + m))]
        for i in range(2, len(df)):
            a, c = df.iloc[i - 2], df.iloc[i]; end = df.index[i] + pd.Timedelta(minutes=m)
            lo, hi = (a.high, c.low) if side == 'long' else (c.high, a.low)
            if lo >= hi: continue
            aft = c1[c1.index >= end]
            thr = aft[(aft.close < lo) if side == 'long' else (aft.close > hi)]
            if not len(thr): continue
            t0 = thr.index[0]
            if t0 < t - pd.Timedelta(minutes=16): continue
            rec = aft[(aft.index > t0) & ((aft.close > hi) if side == 'long' else (aft.close < lo))]
            if len(rec): continue
            n += 1
            if count5: continue
            return True, f"{m}m {'bull' if side=='long' else 'bear'} FVG {lo}-{hi} closed through on 1m {t0:%H:%M}"
    return (n if count5 else (False, ''))
def rth_pd(sym, ts, px):
    t = pd.Timestamp(ts, unit='s', tz='UTC').tz_convert('America/Chicago'); d = BARS[sym]
    d = d[(d.index >= t.normalize() + pd.Timedelta(hours=8, minutes=30)) & (d.index + pd.Timedelta(minutes=1) <= t)]
    if len(d) < 5: return None, None
    hi, lo = d.high.max(), d.low.min(); return (px - lo) / (hi - lo) if hi > lo else None, (hi, lo)
def gtxt(g, k): return (g.get(k) or [None, None, ''])[2] or ''
DBG = None
def run(fx=frozenset(), base=True, t_from=0):
    fires = []; by = {}; last = None; busy = 0; hist = {}; spent = set()
    for r in RP.rows:
        d = RP.parse(r)
        if not d or r['ts'] < t_from: continue
        d = dict(d); g = d['g']; sid = f"{d['sym']}:{d['side']}:{d['e']}"; Lg = d['side'] == 'long'; k = f"{d['sym']}:{d['side']}"
        if 'F8' in fx:
            m = re.search(r'stop ([\d.]+) → ([\d.]+)', gtxt(g, 'shadow:desk:stop'))
            if m and float(m.group(1)) == d['s']: d['s'] = float(m.group(2))
        if (d['s'] is not None and (d['px'] <= d['s'] if Lg else d['px'] >= d['s'])) or (d['t1'] is not None and (d['px'] >= d['t1'] if Lg else d['px'] <= d['t1'])):
            by.pop(sid, None); last = None; spent.add((RP.ct(r['ts']).date(), sid)); continue
        ga = gtxt(g, 'soft:grok_agree'); bw = re.search(r'brain (?:word )?(\w+)', ga + ' ' + gtxt(g, 'soft:bplus_caution')); brain = bw.group(1) if bw else None
        sw, dp, ch, arr = U.evid(d['sym'], d['side'], r['ts'])
        at = gtxt(g, 'fast:agree'); opp = 'OPPOSITE' in at; m = re.search(r'1h (\w+) 4h (\w+)', at); want = 'bull' if Lg else 'bear'
        nopp = sum(1 for x in (m.groups() if m else ()) if x not in ('None', want))
        pen = 0.0; hard = []; band0 = r['band']
        if 'F3' in fx and nopp >= 1:
            pen += 0.05
            if not (sw or dp or brain in ('TAKE', 'GO')): hard.append('htf')
        if 'F5' in fx and band0 == 'B+' and 'WOULD block' in gtxt(g, 'shadow:fx:bplusWindow'): pen += 0.05   # B+ cards only
        if 'F6' in fx:
            p, hl = rth_pd(d['sym'], r['ts'], d['px'])
            if p is not None and (p > .75 if Lg else p < .25): pen += 0.06 if (hl and d['t1'] is not None and abs(d['t1'] - (hl[0] if Lg else hl[1])) < 1e-6) else 0.03
        q = r['q'] if r['q'] is not None else None
        band = r['band']
        if pen and q is not None:
            nb = band_of(q - pen); band = nb if RANK.get(nb, -1) < RANK.get(band, -1) else band
        if 'F1' in fx:
            hit, _ = ifvg1m(d['sym'], d['side'], r['ts'])
            if hit and band0 in ('B+', 'A-'): hard.append('ifvg1m')   # the card's own grade
            if ifvg1m(PART[d['sym']], d['side'], r['ts'])[0] and q is not None:
                nb = band_of(q - pen - 0.10); band = nb if RANK.get(nb, -1) < RANK.get(band, -1) else band
        if 'F12' in fx and n5(d['sym'], d['side'], r['ts']) >= 2: hard.append('readprio')
        if 'F4' in fx and band == 'B+' and 'STAND' in ga and 'gaps are not this side' in ga: hard.append('standgap')
        if 'F7' in fx:
            rrf = abs(d['t1'] - d['px']) / abs(d['px'] - d['s']) if d['t1'] is not None and d['s'] is not None and d['px'] != d['s'] else 0
            if rrf < 1.0: hard.append('rrfill')
        if 'F8' in fx and d['t1'] is not None and d['s'] is not None:
            if abs(d['t1'] - d['e']) / abs(d['e'] - d['s']) < 1.0: hard.append('rr_after_stop')
        h = hist.setdefault(k, []); h.append((q, band)); del h[:-3]
        for kk in [kk for kk in hist if kk.split(':')[0] == d['sym'] and kk != k]: hist.pop(kk)
        for kk in [kk for kk in by if kk.split(':')[0] == d['sym'] and kk.split(':')[1] != d['side']]: by.pop(kk)
        bok = RANK.get(band, -1) >= RANK['B+']; smoothed = False
        if not bok:
            good = sum(1 for _, bb in h if RANK.get(bb, -1) >= RANK['B+']); prev = h[-2][0] if len(h) >= 2 else None
            if (len(h) >= 2 and good >= 2) or (q is not None and prev is not None and 0.59 - 1e-9 <= q - pen < 0.6 and q > prev): bok = smoothed = True
        both = nopp >= 1; half = False
        if U.FCW.ifvg_against([a for a in arr if a.get('symbol') in (None, d['sym'])], d['side'], d['px'])[0]: both = True
        elif 'F3' in fx: both = False          # F3 replaces the htf half-size path (q penalty + requireOneOf above)
        elif both and sw and (dp or ch) and bok: both = False; half = True
        if DBG and DBG(d, r): print('DBG', RP.ct(r['ts']).strftime('%H:%M:%S'), band, bok, hard, g['fast:plan'][1], g['fast:entry'][1], opp, both, nopp, (sw, dp, ch), brain, RP.geom_fixed(d), [x[0] for x in RP.hard_fails(r)], 'busy' if r['ts'] <= busy else '')
        ok = bok and not hard and g['fast:plan'][1] and g['fast:entry'][1] and not opp and not both and RP.geom_fixed(d)
        cur = by.get(sid)
        if not ok:
            if cur:
                cur['n'] = 0; mm = re.search(r'0\.5xATR ([\d.]+)', g['fast:entry'][2])
                if not g['fast:entry'][1] and mm and abs(d['px'] - d['e']) > 0.5 * float(mm.group(1)): cur['ooz'] = True
            last = None; continue
        if cur and cur.get('ooz'): cur = by[sid] = {'first': r['ts'], 'n': 0, 'fired': cur.get('fired')}; last = None
        cur = by.setdefault(sid, {'first': r['ts'], 'n': 0}); cur['n'] = cur['n'] + 1 if last == sid else 1; last = sid
        other = [x[0] for x in RP.hard_fails(r) if x[0] not in ('band', 'fast:persist', 'fast:plan', 'fast:entry', 'fast:agree', 'fast:velocity', 'fast:geometry', 'entries_day', 'second_entry_band')]   # second_entry_band removed (Keaton 13:26 CT)
        day = RP.ct(r['ts']).date()
        if cur['n'] < 2 or r['ts'] - cur['first'] > 90 or other or r['ts'] <= busy or cur.get('fired'): continue
        if (day, sid) in spent: continue
        R, why, te = RP.outcome(d, r['ts']); evs, lab = L.path(d, r['ts']); busy = te or 9e18; cur['fired'] = True; spent.add((day, sid))
        kq = L.ratio[d['sym']]; S0 = d['px'] * kq; K = round(S0); v = L.IV[d['sym']]; p0 = L.bs(S0, K, L.yrs(r['ts']), v, Lg) + L.COST
        n_cap = int(L.DEBIT // (p0 * 100)); eff = 'B+' if smoothed else band
        mv = L.vel(g); n0 = min(n_cap, LAD.get(eff, 0)); n = n0 if (mv is not None and mv <= 30) else (1 if (mv is None or mv > 60) else max(1, n0 // 2)); n = min(n, n0)
        if half: n = max(1, n // 2) if n0 else 0
        qq = []; left = n
        for i, (ts, px, frac) in enumerate(evs):
            c = left if i == len(evs) - 1 else (n if n == 1 else n // 2); c = min(c, left); left -= c
            if c: qq.append((c, L.bs(px * kq, K, L.yrs(ts), v, Lg) - L.COST))
            if not left: break
        usd = round(sum(c * (p - p0) * 100 for c, p in qq)) if n else 0
        fut = round(R * abs(d['px'] - d['s']) * (5 if d['sym'] == 'ES' else 2) * max(n, 1))   # MES $5/pt, MNQ $2/pt, 1 micro per contract
        fires.append(dict(t=RP.ct(r['ts']).strftime('%m-%d %H:%M:%S'), sym=d['sym'], side=d['side'], band=band, q=q, pen=round(pen, 2), fill=d['px'], stop=d['s'], t1=d['t1'], outcome=lab, R=round(R, 2), ct=n, usd=usd, fut_usd=fut))
    return fires
def S(f): return dict(fires=len(f), sumR=round(sum(a['R'] for a in f), 2), usd=sum(a['usd'] for a in f), fut=sum(a['fut_usd'] for a in f))
if __name__ == '__main__':
    out = {}; base = run(); out['base (unblock-2 rebased)'] = base
    print('base', S(base)); [print('  ', a) for a in base]
    keys = ['F1', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F12']
    SHIP = frozenset(['F1', 'F3', 'F5', 'F12']); sh = run(SHIP); out['SHIPPED F1+F3+F5+F12 (+second-entry removed)'] = sh; print('SHIPPED F1+F3+F5+F12', S(sh)); [print('  ', a) for a in sh]
    for kk in keys:
        f = run(frozenset([kk])); out[kk] = f; bt = {a['t'] for a in base}; ft = {a['t'] for a in f}
        print(kk, S(f), 'cut:', sorted(bt - ft), 'new:', sorted(ft - bt))
    cum = set()
    for kk in ['F1', 'F3', 'F5', 'F6', 'F8', 'F12']:
        cum.add(kk); f = run(frozenset(cum)); out['cum+' + kk] = f; print('cum', '+'.join(sorted(cum)), S(f))
    for a in out['cum+F12']: print('  ', a)
    import datetime as _D; T0 = _D.datetime(2026, 10, 15, 13, 5).timestamp()   # live state after the 13:02 ES long stopped at 13:04:55 CT: flat, 1 entry today
    for nm, kw in [('live-state 13:05 base', {}), ('live-state 13:05 SHIPPED', dict(fx=SHIP))]:
        f = run(t_from=T0, **kw); out[nm] = f; print(nm, S(f)); [print('  ', a) for a in f]
    json.dump({k: dict(summary=S(v), fires=v) for k, v in out.items()}, open('replay-pm-results.json', 'w'), indent=1, default=str)
