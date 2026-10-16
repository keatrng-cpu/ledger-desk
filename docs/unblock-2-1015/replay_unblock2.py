"""unblock-2 10/15 replay (read-only on desk-watcher gates.log/cards.log 10/13 -> 10/15). Stacked on #22's replay_live.py:
same price series / outcome model / 0DTE Black-Scholes pricing, plus the unblock-2 rules:
  1) no 2-trade daily entry cap; re-fire handled by #22's fix (a setup id is SPENT for the session after a fire, a stop or a T1 touch)
  2) gradeSmoothing: B+ if >= B+ on 2 of the last 3 polls of the symbol:side, or q within 0.01 of 0.60 and rising (edges unchanged)
  3) htfReversal: 1h+4h both oppose -> allowed at half size with sweep AND (displacement OR CHoCH) and band >= B+, else blocked
Contracts: whole contracts within the $650 debit, capped by the grade ladder (A+4/A2/A-1/B+1), then the velocity cut, then htf half.
Also reported: #22's method (no ladder) for comparison."""
import sys, re, json, bisect, collections, datetime as D
sys.path.insert(0, '../fire-bugs-1015'); sys.path.insert(0, '/workspace/audits/fire-fail-1015')
import replay_live as L
import os; sys.path.insert(0, os.environ.get('WATCHER_DIR', '/workspace/desk-watcher')); from watcher import fastchain as FCW   # ifvg_against twin
RP = L.RP
LAD = {'A+': 4, 'A': 2, 'A-': 1, 'B+': 1}
RANK = {b: i for i, b in enumerate(['C', 'B', 'B+', 'A-', 'A', 'A+'])}
# card evidence (sweep / displacement / choch) by symbol+side, nearest card at or before the row
ev = collections.defaultdict(list)
for l in open(RP.W + 'cards.log'):
    try: j = json.loads(l)
    except Exception: continue
    s = ((j['card'].get('wire') or {}).get('strategy') or {})
    arr = [a for a in ((j['card'].get('wire') or {}).get('arrays') or []) if isinstance(a, dict)]
    if s.get('symbol') and s.get('side'): ev[(s['symbol'], s['side'])].append((j['ts'], s.get('sweep') is True, s.get('displacement') is True, (s.get('choch') or s.get('mss')) is True, arr))
for k in ev: ev[k].sort()
def evid(sym, side, ts):
    a = ev.get((sym, side)) or []; i = bisect.bisect_right([x[0] for x in a], ts) - 1
    return a[i][1:] if i >= 0 and ts - a[i][0] < 30 else (False, False, False, [])
def run(cap_day=None, spent_fix=True, smooth=True, htfrev=True, ladder=True, any_oppose=True, ifvg=True):
    fires = []; by = {}; last = None; day_n = collections.Counter(); busy = 0; hist = {}; spent = set()
    for r in RP.rows:
        d = RP.parse(r)
        if not d: continue
        g = d['g']; sid = f"{d['sym']}:{d['side']}:{d['e']}"; Lg = d['side'] == 'long'; k = f"{d['sym']}:{d['side']}"
        h = hist.setdefault(k, []); h.append((r['q'], r['band'])); del h[:-3]
        for kk in [kk for kk in hist if kk.split(':')[0] == d['sym'] and kk != k]: hist.pop(kk)
        for kk in [kk for kk in by if kk.split(':')[0] == d['sym'] and kk.split(':')[1] != d['side']]: by.pop(kk)
        if (d['s'] is not None and (d['px'] <= d['s'] if Lg else d['px'] >= d['s'])) or (d['t1'] is not None and (d['px'] >= d['t1'] if Lg else d['px'] <= d['t1'])):
            by.pop(sid, None); last = None
            if spent_fix: spent.add((RP.ct(r['ts']).date(), sid))
            continue
        band = r['band']; bok = RANK.get(band, -1) >= RANK['B+']; smoothed = False
        if not bok and smooth:
            good = sum(1 for _, b in h if RANK.get(b, -1) >= RANK['B+']); q = r['q']; prev = h[-2][0] if len(h) >= 2 else None
            if (len(h) >= 2 and good >= 2) or (q is not None and prev is not None and 0.59 - 1e-9 <= q < 0.6 and q > prev): bok = smoothed = True
        at = g['fast:agree'][2]; opp = 'OPPOSITE' in at; m = re.search(r'1h (\w+) 4h (\w+)', at); want = 'bull' if Lg else 'bear'
        nopp = sum(1 for x in (m.groups() if m else ()) if x not in ('None', want))
        both = (nopp >= 1) if (htfrev and any_oppose) else (bool(m) and nopp == 2); half = False
        sw, dp, ch, arr = evid(d['sym'], d['side'], r['ts'])
        if ifvg and FCW.ifvg_against([a for a in arr if a.get('symbol') in (None, d['sym'])], d['side'], d['px'])[0]: both = True   # fast:ifvg (hard)
        elif both and htfrev:
            if sw and (dp or ch) and bok: both = False; half = True
        ok = bok and g['fast:plan'][1] and g['fast:entry'][1] and not opp and not both and RP.geom_fixed(d)
        cur = by.get(sid)
        if not ok:
            if cur:
                cur['n'] = 0
                mm = re.search(r'0\.5xATR ([\d.]+)', g['fast:entry'][2])
                if not g['fast:entry'][1] and mm and abs(d['px'] - d['e']) > 0.5 * float(mm.group(1)): cur['ooz'] = True
            last = None; continue
        if cur and cur.get('ooz'): cur = by[sid] = {'first': r['ts'], 'n': 0, 'rearm': cur.get('rearm', 0) + 1, 'fired': cur.get('fired')}; last = None
        cur = by.setdefault(sid, {'first': r['ts'], 'n': 0}); cur['n'] = cur['n'] + 1 if last == sid else 1; last = sid
        other = [x[0] for x in RP.hard_fails(r) if x[0] not in ('band', 'fast:persist', 'fast:plan', 'fast:entry', 'fast:agree', 'fast:velocity', 'fast:geometry', 'entries_day')]
        day = RP.ct(r['ts']).date()
        if cur['n'] < 2 or r['ts'] - cur['first'] > 90 or other or r['ts'] <= busy or cur.get('fired'): continue
        if cap_day is not None and day_n[day] >= cap_day: continue
        if spent_fix and (day, sid) in spent:
            if not cur.get('noted'): fires.append(dict(t=RP.ct(r['ts']).strftime('%m-%d %H:%M:%S CT'), sym=d['sym'], side=d['side'], blocked=f'setup {sid} spent for the session (#22)')); cur['noted'] = True
            continue
        R, why, te = RP.outcome(d, r['ts']); evs, lab = L.path(d, r['ts']); day_n[day] += 1; busy = te or 9e18; cur['fired'] = True
        if spent_fix: spent.add((day, sid))
        kq = L.ratio[d['sym']]; S0 = d['px'] * kq; K = round(S0); v = L.IV[d['sym']]; p0 = L.bs(S0, K, L.yrs(r['ts']), v, Lg) + L.COST
        n_cap = int(L.DEBIT // (p0 * 100)); eff_band = 'B+' if smoothed else band
        def size(n0):
            mv = L.vel(g); n = n0 if (mv is not None and mv <= 30) else (1 if (mv is None or mv > 60) else max(1, n0 // 2)); n = min(n, n0)
            if half: n = max(1, n // 2) if n0 else 0
            return n
        def pnl(n):
            if n == 0: return None
            q = []; left = n
            for i, (ts, px, frac) in enumerate(evs):
                c = left if i == len(evs) - 1 else (n if n == 1 else n // 2); c = min(c, left); left -= c
                if c: q.append((c, L.bs(px * kq, K, L.yrs(ts), v, Lg) - L.COST))
                if not left: break
            return round(sum(c * (p - p0) * 100 for c, p in q))
        n_l = size(min(n_cap, LAD.get(eff_band, 0))); n_22 = size(n_cap)
        fires.append(dict(t=RP.ct(r['ts']).strftime('%m-%d %H:%M:%S CT'), sym=d['sym'], side=d['side'], band=band, eff_band=eff_band, smoothed=smoothed, htf_half=half,
                          entry_card=d['e'], fill_px=d['px'], stop=d['s'], t1=d['t1'], outcome=lab, R=round(R, 2), exit=RP.ct(te).strftime('%H:%M') if te else '-',
                          prem=round(p0, 2), contracts=n_l, opt_pnl=pnl(n_l), contracts_22method=n_22, opt_pnl_22method=pnl(n_22),
                          risk_pts=round(abs(d['px'] - d['s']), 2), sig=r['signal']))
    return fires
def summ(f):
    x = [a for a in f if 'R' in a]
    return dict(fires=len(x), sumR=round(sum(a['R'] for a in x), 2), usd=sum(a['opt_pnl'] or 0 for a in x), usd_22method=sum(a['opt_pnl_22method'] or 0 for a in x), blocked=[a for a in f if 'blocked' in a])
if __name__ == '__main__':
    out = {}
    for name, kw in [('unblock2', {}), ('pr22 (cap 2, no refire/smooth/htfrev)', dict(cap_day=2, spent_fix=False, smooth=False, htfrev=False)),
                     ('only 1) cap off (+#22 spent fix)', dict(smooth=False, htfrev=False)), ('only 2) smoothing', dict(cap_day=2, htfrev=False)),
                     ('only 3) htf reversal', dict(cap_day=2, smooth=False)), ('#22 + spent fix, cap 2', dict(cap_day=2, smooth=False, htfrev=False)), ('unblock2 without the spent fix', dict(spent_fix=False)), ('unblock2 before the 13:02 lesson (no fast:ifvg, both-oppose only)', dict(any_oppose=False, ifvg=False))]:
        f = run(**kw); out[name] = dict(summary={k: v for k, v in summ(f).items() if k != 'blocked'}, fires=f)
        print(name, {k: v for k, v in summ(f).items() if k != 'blocked'})
    for a in out['unblock2']['fires']: print(a)
    json.dump(out, open('replay-unblock2-results.json', 'w'), indent=1)
