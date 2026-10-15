"""Every 10/15 card at B+ or better (logged band) and whether it fires under persist+STAND (replay_persist.run_new). Read-only."""
import sys, os, json, collections, datetime as D
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import replay_persist as X
P = X.P; RP = P.RP
day = D.datetime(2026, 10, 15).timestamp(); log = []
new = X.run_new(X.SHIP, t_from=day, log=log)
passed = collections.defaultdict(list)
for r, d, band, _ in log: passed[f"{d['sym']}:{d['side']}:{d['e']}"].append(r['ts'])
fired = {f"{f['sym']}:{f['side']}"+':'+str(f.get('e', '')): f for f in new}
fire_by = [(f['sym'], f['side'], f['t']) for f in new]
cards = {}
for r in RP.rows:
    if r['ts'] < day or r['band'] not in ('B+', 'A-', 'A', 'A+'): continue
    d = RP.parse(r)
    if not d: continue
    sid = f"{d['sym']}:{d['side']}:{d['e']}"
    c = cards.setdefault(sid, dict(first=r['ts'], sym=d['sym'], side=d['side'], e=d['e'], s=d['s'], t1=d['t1'], best=r['band'], n=0, fails=collections.Counter(), d=d))
    c['n'] += 1
    if P.RANK[r['band']] > P.RANK[c['best']]: c['best'] = r['band']
    for g in RP.hard_fails(r): c['fails'][g[0]] += 1
out = []
for sid, c in sorted(cards.items(), key=lambda kv: kv[1]['first']):
    ft = lambda f: D.datetime.strptime('2026-' + f['t'], '%Y-%m-%d %H:%M:%S').timestamp()
    own = lambda f: max((cc for cc in cards.values() if cc['sym'] == f['sym'] and cc['side'] == f['side'] and abs((cc['s'] or 0) - f['stop']) < 1e-6 and cc['t1'] == f['t1'] and cc['first'] <= ft(f) + 1), key=lambda cc: cc['first'], default=None)
    f = next((f for f in new if own(f) is c), None)
    rr = None
    R, why, _ = RP.outcome(c['d'], c['first'])
    if f: status = f"FIRES {f['t'][6:]} ({f['outcome']})"; rr = f['R']
    elif passed.get(sid): status = 'rows pass; held by one-position slot / persist / spent'; rr = None
    else:
        ex = [k for k, _ in c['fails'].most_common(3) if k != 'fast:persist']
        if P.ifvg1m(c['sym'], c['side'], c['first'])[0]: ex.append('F1 1m close through same-side FVG')
        if P.n5(c['sym'], c['side'], c['first']) >= 2: ex.append('F12 read-priority flip')
        status = 'blocked: ' + (', '.join(ex) or 'rows fail on later polls')
    out.append(dict(t=D.datetime.fromtimestamp(c['first']).strftime('%H:%M:%S'), sym=c['sym'], side=c['side'], grade=c['best'], entry=c['e'], stop=c['s'], t1=c['t1'], rows=c['n'], new_rules=status, fired_R=rr, R_if_filled_at_first_card=round(R, 2), why=why))
for o in out: print(o['t'], o['sym'], o['side'], o['grade'], o['entry'], o['stop'], o['t1'], '|', o['new_rules'], '| R', o['fired_R'], '| R@first', o['R_if_filled_at_first_card'], o['why'])
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cards_1015.json'), 'w'), indent=1)
