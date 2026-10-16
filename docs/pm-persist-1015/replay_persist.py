"""10/15 PM persist + STAND fix replay (read-only: desk-watcher gates.log/cards.log + post-mortem 1m bars, $0).
Base = post-mortem shipped set (F1+F3+F5+F12, second_entry_band removed) from ../postmortem-fixes-1015/replay_pm.py.
New:  P  persist: clock from the first qualifying card; A-+ with fresh sweep/displacement fires on the 2nd poll (no hold);
         otherwise 2 polls AND >= 20 s since the first qualifying card; <= 90 s (stale).
      S  brain STAND: -0.03 q weight, not a veto; STAND + iFVG flip against the side (ifvgAgainst / 1m close-through / read-priority) blocks.
Run from this dir: WATCHER_DIR=/workspace/desk-watcher python3 replay_persist.py"""
import sys, os, re, inspect, json
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(os.path.join(HERE, '../postmortem-fixes-1015')); sys.path.insert(0, '.')
import replay_pm as P
src = inspect.getsource(P.run)
def sub(a, b):
    global src; assert a in src, a; src = src.replace(a, b)
sub("def run(fx=frozenset(), base=True, t_from=0):", "def run_new(fx=frozenset(), base=True, t_from=0, persist=True, stand=True, log=None):")
sub("at = gtxt(g, 'fast:agree'); opp = 'OPPOSITE' in at;", "at = gtxt(g, 'fast:agree'); opp = 'OPPOSITE' in at\n        bw2 = re.search(r'brain (\\w+)', at); brain = brain or (bw2.group(1) if bw2 else None);")
sub("        q = r['q'] if r['q'] is not None else None\n", "        if stand and brain == 'STAND': pen += 0.03\n        q = r['q'] if r['q'] is not None else None\n")
sub("        both = nopp >= 1; half = False\n", "        flip_against = U.FCW.ifvg_against([a for a in arr if a.get('symbol') in (None, d['sym'])], d['side'], d['px'])[0] or ifvg1m(d['sym'], d['side'], r['ts'])[0] or n5(d['sym'], d['side'], r['ts']) >= 2\n        if stand and brain == 'STAND': opp = flip_against\n        both = nopp >= 1; half = False\n")
sub("if cur['n'] < 2 or r['ts'] - cur['first'] > 90 or other", "ev = RANK.get(band, -1) >= RANK['A-'] and (sw or dp)\n        if log is not None: log.append((r, d, band, 'pass-rows'))\n        if (cur['n'] < 2 if (not persist or ev) else (cur['n'] < 2 or r['ts'] - cur['first'] < 20)) or r['ts'] - cur['first'] > 90 or other")
ns = dict(vars(P)); exec(src, ns); run_new = ns['run_new']
SHIP = frozenset({'F1', 'F3', 'F5', 'F12'})
if __name__ == '__main__':
    import datetime as D
    day = D.datetime(2026, 10, 15).timestamp()
    base = [f for f in P.run(SHIP, t_from=day)]
    new = run_new(SHIP, t_from=day)
    onlyP = run_new(SHIP, t_from=day, stand=False); onlyS = run_new(SHIP, t_from=day, persist=False)
    for n, f in (('base (shipped #24)', base), ('+persist', onlyP), ('+STAND weight', onlyS), ('+persist +STAND', new)): print(n, P.S(f))
    json.dump(dict(base=base, new=new, onlyP=onlyP, onlyS=onlyS), open(os.path.join(HERE, 'replay_persist.json'), 'w'), indent=1, default=str)
