"""Copy rendered charts into the desk site's static dir (public/trade-charts) for the read-only Charts tab.
Whitelisted sidecar fields only (no option account, no gate internals beyond the counts, no env, no paths), PNGs over
the per-file cap are skipped, and the total is capped so the deploy stays light. Atomic writes; stale files pruned."""
import glob, json, os, shutil
from .learn import atomic_write

MAX_PNG = 450_000          # bytes per chart
MAX_TOTAL = 20_000_000     # bytes for the whole folder (newest trades win)
TRADE_KEYS = ("signal", "chart_id", "source", "symbol", "side", "band", "q", "entry", "stop", "t1", "t2", "fill_t", "fill_px", "exit_t", "exit_px", "R", "pnl_usd")
FEAT_KEYS = ("session_phase", "premium_pct", "range_name", "ifvg_against", "ifvg_with", "in_with_fvg", "in_with_ob", "wrong_half", "htf_1h", "htf_4h",
             "htf_aligned", "sweep_with_before", "sweep_against_before", "displacement_atr", "rr_from_fill", "stop_atr5", "brain", "floor",
             "t1_hit", "mfe_R", "mae_R", "R", "win")
SAFE = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")

def _ok(name): return bool(name) and set(name) <= SAFE and not name.startswith(".")

def publish(src_root, dest):
    items = []
    for p in sorted(glob.glob(os.path.join(src_root, "20??-??-??", "*.json"))):
        day = os.path.basename(os.path.dirname(p)); stem = os.path.basename(p)[:-5]; png = p[:-5] + ".png"
        if not _ok(stem) or stem.endswith(".tmp") or not os.path.exists(png): continue
        try: s = json.load(open(p))
        except ValueError: continue
        t = s.get("trade") or {}; f = s.get("features") or {}
        if not f.get("data_ok") or t.get("exit_t") is None: continue
        if os.path.getsize(png) > MAX_PNG: continue
        items.append((str(t.get("fill_t")), day, stem, png, t, f, s.get("summary")))
    items.sort(key=lambda x: x[0], reverse=True)
    total = 0; rows = []; keep = {"index.json"}
    for fill_t, day, stem, png, t, f, summ in items:
        side = dict(schema=1, summary=summ, trade={k: t.get(k) for k in TRADE_KEYS}, features={k: f.get(k) for k in FEAT_KEYS})
        js = json.dumps(side, default=str)
        sz = os.path.getsize(png) + len(js)
        if total + sz > MAX_TOTAL: break
        total += sz; os.makedirs(os.path.join(dest, day), exist_ok=True)
        shutil.copyfile(png, os.path.join(dest, day, stem + ".png.tmp")); os.replace(os.path.join(dest, day, stem + ".png.tmp"), os.path.join(dest, day, stem + ".png"))
        atomic_write(os.path.join(dest, day, stem + ".json"), js)
        keep |= {f"{day}/{stem}.png", f"{day}/{stem}.json"}
        rows.append(dict(id=stem, day=day, symbol=t.get("symbol"), side=t.get("side"), source=t.get("source"), band=t.get("band"),
                         fill_t=t.get("fill_t"), exit_t=t.get("exit_t"), fill_px=t.get("fill_px"), exit_px=t.get("exit_px"),
                         R=t.get("R"), pnl_usd=t.get("pnl_usd"), summary=summ, png=f"{day}/{stem}.png", json=f"{day}/{stem}.json"))
    for p in glob.glob(os.path.join(dest, "**", "*"), recursive=True):     # prune what is no longer published
        rel = os.path.relpath(p, dest)
        if os.path.isfile(p) and rel not in keep: os.unlink(p)
    import datetime as D
    atomic_write(os.path.join(dest, "index.json"), json.dumps(dict(schema=1, generated=D.datetime.now().astimezone().isoformat(timespec="seconds"), trades=rows), indent=1, default=str))
    return dict(dest=dest, n=len(rows), bytes=total)
