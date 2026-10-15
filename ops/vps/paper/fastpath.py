"""Memoised drop-in for trend_paper.rth(). trend_paper.context() calls rth(bars, day) once per BAR inside a set
comprehension (O(n^2): ~3.6e9 ops on 40 days of 1m bars, minutes of CPU on a 1-vCPU box). This returns exactly the same
list for (bars, day) by grouping the bar list once. Rule logic is untouched. install(tp) wraps tp.step so the cache is
reset per step (it holds strong refs, so an id() can't be recycled within a step)."""
_cache = {}

def install(tp):
    orig_rth, orig_step = tp.rth, tp.step
    def rth(bars, d):
        k = id(bars); ent = _cache.get(k)
        if ent is None or ent[0] is not bars or ent[1] != len(bars):
            g = {}
            for b in bars:
                if 510 <= tp.mins(b["t"]) < 900: g.setdefault(b["t"].date(), []).append(b)
            ent = _cache[k] = (bars, len(bars), g)
        return list(ent[2].get(d, []))
    def step(*a, **k):
        _cache.clear()
        try: return orig_step(*a, **k)
        finally: _cache.clear()
    tp.rth, tp.step = rth, step
    tp._orig_rth = orig_rth
