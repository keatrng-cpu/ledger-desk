"""Shadow learning loop: one row per trade from the JSON sidecars -> features.csv, report.md, and an extra-data feed
for the check-weighting prototype. Nothing here writes desk rules, gates or watcher config."""
import contextlib, csv, fcntl, glob, io, json, math, os, tempfile, datetime as D

BIN = ["ifvg_against", "ifvg_with", "in_with_fvg", "in_with_ob", "wrong_half", "sweep_with_before", "sweep_against_before",
       "eq_pool_toward_target", "eq_pool_behind_stop", "brain_stand", "floor_armed", "actionable", "shadow_htf_block"]
NUM = {"htf_aligned": [(">=1", lambda x: x >= 1), ("==2", lambda x: x == 2)], "card_htf_aligned": [(">=1", lambda x: x >= 1)],
       "premium_pct": [(">60 (deep premium)", lambda x: x > 60), ("<40 (deep discount)", lambda x: x < 40)],
       "side_depth_pct": [("<=50 (correct half)", lambda x: x <= 50)],
       "displacement_atr": [(">=0.8", lambda x: x >= 0.8)], "rr_from_fill": [(">=1.5", lambda x: x >= 1.5)],
       "stop_atr5": [(">=1.0", lambda x: x >= 1.0)], "n_soft_block": [(">=6", lambda x: x >= 6)], "n_live_block": [("==0", lambda x: x == 0)]}
CAT = ["session_phase", "source", "symbol", "side", "brain", "floor", "desk_band"]
COLS = ["date", "chart_id", "signal", "source", "symbol", "side", "fill_t", "exit_t", "session_phase", "band", "q", "ifvg_against", "ifvg_with",
        "in_with_fvg", "in_with_ob", "premium_pct", "side_depth_pct", "wrong_half", "range_name", "htf_1h", "htf_4h", "htf_aligned", "card_htf_aligned",
        "sweep_with_before", "sweep_against_before", "displacement_atr", "card_disp", "rr_from_fill", "stop_atr5", "eq_pool_toward_target",
        "eq_pool_behind_stop", "dist_pdh_atr", "dist_pdl_atr", "brain", "floor", "desk_band", "desk_q", "actionable", "n_live_block",
        "n_soft_block", "n_shadow_block", "shadow_htf_block", "R", "win", "pnl_usd", "t1_hit", "mfe_R", "mae_R", "hindsight_ifvg_against_after_entry", "chart"]
K = 10   # shrinkage pseudo-count (same as proto-weighting SHRINK)
CLIP = (-2.0, 3.0)   # R is clipped for the lift stats so one slipped stop (e.g. -4.1R) cannot carry a feature alone
def _r(r): return min(CLIP[1], max(CLIP[0], float(r["R"])))

def atomic_write(path, text):
    """tmp file in the same dir + fsync + os.replace: a reader (proto-weighting, the desk) never sees a torn file."""
    d = os.path.dirname(path) or "."; os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix="." + os.path.basename(path) + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", newline="") as fh: fh.write(text); fh.flush(); os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError): os.unlink(tmp)
        raise

@contextlib.contextmanager
def locked(root):
    """Exclusive flock on <root>/.learn.lock: the watcher EXIT hook and the nightly run never interleave writes."""
    os.makedirs(root, exist_ok=True)
    with open(os.path.join(root, ".learn.lock"), "a") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try: yield
        finally: fcntl.flock(fh, fcntl.LOCK_UN)

def _key(day, symbol, side, entry):
    try: e = round(float(entry), 2)
    except (TypeError, ValueError): e = None
    return (str(day), str(symbol or "").upper(), str(side or "").lower(), e)

class VoidsUnavailable(RuntimeError):
    """desk_learn_annotation could not be read: learning refuses to run and writes nothing."""

VOIDS_SQL = ("select a.src, a.row_id, coalesce(j.day_key, s.day_key), coalesce(j.symbol, s.symbol), coalesce(j.side, s.side), "
             "coalesce(j.entry, s.entry)::float8 from desk_learn_annotation a "
             "left join desk_card_journal j on a.src = 'desk_card_journal' and j.id = a.row_id "
             "left join desk_card_snap s on a.src = 'desk_card_snap' and s.id = a.row_id where a.exclude_from_learning")
MAX_EXPORT_AGE_H = 26

def _from_rows(rows):
    ids, keys = set(), set()
    for src, row_id, day, sym, side, entry in rows:
        if row_id: ids.add(str(row_id))
        if day and entry is not None: keys.add(_key(day, sym, side, entry))   # journal/snap twin, entry to the cent (snapNotVoided)
    return ids, keys

def load_voids(root, export=None):
    """Voids from the real desk_learn_annotation table (the source annotations.ts / snapNotVoided read):
    1) direct READ ONLY query when psycopg + DATABASE_URL are available (the VPS), else
    2) the export written by `node scripts/export-learn-voids.mjs <out>` (TC_VOIDS_EXPORT or <root>/learn-voids.json),
       which must say ok and be < MAX_EXPORT_AGE_H old. Anything else raises VoidsUnavailable."""
    url = os.environ.get("DATABASE_URL")
    if url:
        try: import psycopg
        except ImportError: psycopg = None
        if psycopg is not None:
            try:
                with psycopg.connect(url, connect_timeout=15) as c:
                    c.read_only = True
                    with c.cursor() as cur: cur.execute(VOIDS_SQL); return _from_rows(cur.fetchall())
            except Exception as ex: raise VoidsUnavailable(f"desk_learn_annotation query failed: {type(ex).__name__}") from None
    path = export or os.environ.get("TC_VOIDS_EXPORT") or os.path.join(root, "learn-voids.json")
    try: doc = json.load(open(path))
    except (OSError, ValueError) as ex: raise VoidsUnavailable(f"no voids export at {path} ({type(ex).__name__}); run scripts/export-learn-voids.mjs") from None
    if not (isinstance(doc, dict) and doc.get("ok") is True and doc.get("source") == "desk_learn_annotation" and isinstance(doc.get("voids"), list)):
        raise VoidsUnavailable(f"voids export {path} is not a valid desk_learn_annotation export")
    try: age = (D.datetime.now(D.timezone.utc) - D.datetime.fromisoformat(doc["exported_at"].replace("Z", "+00:00"))).total_seconds() / 3600
    except Exception: raise VoidsUnavailable("voids export has no valid exported_at") from None
    if age > MAX_EXPORT_AGE_H: raise VoidsUnavailable(f"voids export is {age:.0f}h old (> {MAX_EXPORT_AGE_H}h)")
    return _from_rows([(v.get("src"), v.get("row_id"), v.get("day_key"), v.get("symbol"), v.get("side"), v.get("entry")) for v in doc["voids"]])

def is_voided(s, ids, keys):
    t = s.get("trade") or {}; f = s.get("features") or {}
    if t.get("voided") or t.get("exclude_from_learning") or f.get("exclude_from_learning"): return True
    if str(t.get("signal")) in ids or str(t.get("chart_id")) in ids: return True
    day = str(t.get("fill_t") or "")[:10]
    return _key(day, t.get("symbol"), t.get("side"), t.get("entry")) in keys

def build_table(root, voids=None):
    rows = []; ids, keys = voids if voids is not None else load_voids(root)
    for p in sorted(glob.glob(os.path.join(root, "20??-??-??", "*.json"))):
        try: s = json.load(open(p))
        except Exception: continue
        f = s.get("features") or {}
        if is_voided(s, ids, keys): continue     # snapNotVoided: voided trades never reach the table or the weights
        if not f.get("data_ok") or f.get("R") is None: continue
        t = s["trade"]; r = {c: f.get(c) for c in COLS}
        r.update(date=os.path.basename(os.path.dirname(p)), chart_id=t["chart_id"], signal=t["signal"], fill_t=t["fill_t"], exit_t=t["exit_t"], chart=s.get("chart"))
        rows.append(r)
    rows.sort(key=lambda r: r["fill_t"])
    return rows

def write_table(rows, path):
    buf = io.StringIO(); w = csv.DictWriter(buf, fieldnames=COLS); w.writeheader(); [w.writerow(r) for r in rows]
    atomic_write(path, buf.getvalue())

def _mean(x): return sum(x) / len(x) if x else None

def split_stats(rows, name, pred):
    a = [r for r in rows if r.get(name) is not None and pred(r[name])]; b = [r for r in rows if r.get(name) is not None and not pred(r[name])]
    if not rows: return None
    p0 = _mean([1.0 if r["win"] else 0.0 for r in rows]); m0 = _mean([_r(r) for r in rows])
    def arm(x):
        if not x: return dict(n=0, win=None, win_shrunk=None, R=None, R_shrunk=None)
        w = sum(1 for r in x if r["win"]); R = _mean([_r(r) for r in x])
        return dict(n=len(x), win=round(w / len(x), 2), win_shrunk=round((w + K * p0) / (len(x) + K), 2), R=round(R, 2), R_shrunk=round((sum(_r(r) for r in x) + K * m0) / (len(x) + K), 2))
    A, Bm = arm(a), arm(b)
    lift = (A["R"] - Bm["R"]) if A["n"] and Bm["n"] else None
    nmin = min(A["n"], Bm["n"])
    return dict(feature=name, yes=A, no=Bm, lift_R=None if lift is None else round(lift, 2),
                lift_R_shrunk=None if lift is None else round(lift * nmin / (nmin + K), 2), nmin=nmin)

def all_splits(rows):
    out = []
    if not rows: return out
    for n in BIN: out.append(split_stats(rows, n, lambda x: bool(x) and str(x) not in ("False", "0", "")))
    for n, cuts in NUM.items():
        for lab, fn in cuts:
            s = split_stats(rows, n, lambda x, fn=fn: fn(float(x))); s["feature"] = f"{n} {lab}"; out.append(s)
    for n in CAT:
        for v in sorted({str(r.get(n)) for r in rows if r.get(n) is not None}):
            s = split_stats(rows, n, lambda x, v=v: str(x) == v); s["feature"] = f"{n} = {v}"; out.append(s)
    return [s for s in out if s]

def report(rows, splits, path, proto_note=""):
    n = len(rows); wins = sum(1 for r in rows if r["win"]); srcs = {}
    for r in rows: srcs[r["source"]] = srcs.get(r["source"], 0) + 1
    L = [f"# Trade-chart learning report (SHADOW — nothing here changes live rules)", "",
         f"Generated {D.datetime.now().astimezone():%Y-%m-%d %H:%M %Z}. Trades: **{n}** ({wins} wins / {n - wins} losses; by source: "
         + ", ".join(f"{k} {v}" for k, v in sorted(srcs.items())) + ").", ""]
    if n:
        L += [f"Mean R {(_mean([r['R'] for r in rows])):+.2f}. Shrinkage: every arm is pulled toward the pooled mean with k={K} pseudo-trades "
              f"(win_shrunk = (wins + k·p0)/(n + k)); lift_R_shrunk = lift × n_min/(n_min + k), the same rule as proto-weighting.", ""]
    L += ["## Honesty notes",
          f"- n={n} is far too small to rank features. With n_min < 5 per arm a lift is anecdote; even the largest shrunk lift below is mostly noise.",
          "- Trades are not independent: paper trades share signals, days and regimes (3 sessions), and the live sample is one trade.",
          "- Paper futures rows grade on futures R; the live row grades on underlying R (option $ shown separately).",
          f"- R is clipped to [{CLIP[0]:g}, +{CLIP[1]:g}] for every mean/lift below (one slipped stop at -4R would otherwise decide most rows); the table at the bottom shows raw R.",
          "- `hindsight_*` columns use bars after entry and are excluded from the ranking.",
          "- Shadow only: this feeds proto-weighting as extra data; no gate, weight or watcher rule changes from it automatically.", ""]
    ranked = sorted([s for s in splits if s["lift_R_shrunk"] is not None], key=lambda s: -abs(s["lift_R_shrunk"]))
    L += ["## Features ranked by |shrunk R lift| (yes vs no)", "", "| feature | n yes / no | win% yes / no (shrunk) | mean R yes / no | lift R | shrunk lift |", "|---|---|---|---|---|---|"]
    for s in ranked[:25]:
        y, o = s["yes"], s["no"]
        L.append(f"| {s['feature']} | {y['n']} / {o['n']} | {y['win']} ({y['win_shrunk']}) / {o['win']} ({o['win_shrunk']}) | {y['R']} / {o['R']} | {s['lift_R']:+.2f} | {s['lift_R_shrunk']:+.2f} |")
    nov = [s["feature"] for s in splits if s["lift_R_shrunk"] is None]
    if nov: L += ["", "No variance (all one value, undetermined): " + ", ".join(nov)]
    L += ["", "## Trades", "", "| date | chart_id | src | side | phase | prem% | iFVG ag | sweep | HTF | disp | R:R | brain | Floor | R |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        L.append(f"| {r['date']} | {r['chart_id']} | {r['source']} | {r['side']} | {r['session_phase']} | {r['premium_pct']} | {r['ifvg_against']} | {r['sweep_with_before']} | {r['htf_aligned']} | {r['displacement_atr']} | {r['rr_from_fill']} | {r['brain']} | {r['floor']} | {r['R']:+.2f} |")
    if proto_note: L += ["", "## proto-weighting feed", "", proto_note]
    atomic_write(path, "\n".join(L) + "\n")
    return path

def proto_feed(rows, splits, proto_dir, cap=0.6):
    """Extra data for /workspace/proto-weighting: per-trade chart features + chart-feature weights computed with the
    prototype's own rule (shrunk R lift, floored at 0, capped at 0.6). Written beside — never over — weights.json."""
    if not proto_dir or not os.path.isdir(proto_dir): return None
    out = os.path.join(proto_dir, "extra"); os.makedirs(out, exist_ok=True)
    write_table(rows, os.path.join(out, "chart_features.csv"))
    w = {}
    for s in splits:
        if s["lift_R"] is None: w[s["feature"]] = dict(w=0.0, n_yes=s["yes"]["n"], n_no=s["no"]["n"], lift=None); continue
        w[s["feature"]] = dict(w=round(min(cap, max(0.0, s["lift_R_shrunk"])), 3), n_yes=s["yes"]["n"], n_no=s["no"]["n"], lift=s["lift_R"], lift_shrunk=s["lift_R_shrunk"])
    meta = dict(mode="shadow", n_trades=len(rows), rule="w = clip(lift_R * nmin/(nmin+10), 0, 0.6) — same as proto-weighting fit()",
                generated=D.datetime.now().astimezone().isoformat(timespec="seconds"), note="extra data only; weighting.py/weights.json untouched")
    atomic_write(os.path.join(out, "weights_chart_features.json"), json.dumps(dict(meta=meta, weights=w), indent=1))
    return out

def run(root, proto_dir=None, voids=None):
    voids = voids if voids is not None else load_voids(root)     # raises before anything is written
    with locked(root): return _run(root, proto_dir, voids)

def _run(root, proto_dir, voids):
    rows = build_table(root, voids); learn = os.path.join(root, "learn")
    write_table(rows, os.path.join(learn, "features.csv"))
    splits = all_splits(rows)
    fed = proto_feed(rows, splits, proto_dir)
    note = (f"Wrote `{fed}/chart_features.csv` and `weights_chart_features.json` (shadow; weights.json untouched). "
            "Load with `extra_chart.py` in the prototype.") if fed else "proto-weighting dir not found; skipped."
    report(rows, splits, os.path.join(learn, "report.md"), note)
    atomic_write(os.path.join(learn, "splits.json"), json.dumps(splits, indent=1))
    return rows, splits
