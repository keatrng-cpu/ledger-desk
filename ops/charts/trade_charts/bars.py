"""Bar loading for ES/NQ from free local sources only (no network, no paid data).

Priority (first source wins on overlapping minutes):
  1. GLBX ohlcv-1m parquet cache (box: /workspace/data/databento/{ES,NQ}_1m.parquet, already pulled at $0)
  2. VPS archive day files ($0, get_cost-checked by ops/vps/archive.py): ARCHIVE_DIR/YYYY/MM/DD/glbx_ohlcv1m.parquet, live_bars_1m.parquet
  3. extra CT-indexed 1m pickles/parquets (e.g. a postmortem folder)
  4. desk-watcher ticks/*.jsonl snapshots aggregated to 1m (MNQ is mapped to NQ: same index points)
"""
import glob, json, os
import pandas as pd

CT = "America/Chicago"
COLS = ["open", "high", "low", "close"]
ALIAS = {"ES": ("ES", "MES"), "NQ": ("NQ", "MNQ")}

def _env_list(name, default):
    v = os.environ.get(name)
    return [x for x in (v.split(os.pathsep) if v else default) if x]

def default_sources():
    return dict(
        glbx=_env_list("TC_GLBX_DIRS", ["/workspace/data/databento"]),
        archive=_env_list("TC_ARCHIVE_DIRS", ["/var/lib/ledger-archive"]),
        extra=_env_list("TC_EXTRA_BAR_DIRS", []),
        ticks=_env_list("TC_TICK_DIRS", ["/workspace/desk-watcher/ticks"]),
    )

def root(sym):
    s = str(sym).upper()
    return "NQ" if s in ("NQ", "MNQ", "QQQ") else "ES" if s in ("ES", "MES", "SPY") else s

def _norm(df):
    if df is None or not len(df): return None
    df = df.rename(columns={"o": "open", "h": "high", "l": "low", "c": "close"})
    if "bar_time" in df.columns: df = df.set_index("bar_time")
    idx = pd.DatetimeIndex(df.index)
    idx = idx.tz_localize("UTC") if idx.tz is None else idx
    df = df.copy(); df.index = idx.tz_convert(CT)
    return df[COLS].astype(float).sort_index()

def _clip(df, t0, t1):
    return None if df is None else df[(df.index >= t0) & (df.index <= t1)]

def pa_ts(t, typ):
    import pyarrow as pa
    return pa.scalar(t.to_pydatetime(), type=typ)

def _read_window(p, t0, t1):
    """Read only the row groups whose ts_event range overlaps [t0, t1] (keeps the big cache file under ~60 MB RSS)."""
    import pyarrow.parquet as pq
    f = pq.ParquetFile(p); names = f.schema_arrow.names; ti = names.index("ts_event"); u0, u1 = t0.tz_convert("UTC"), t1.tz_convert("UTC")
    parts = []
    for i in range(f.metadata.num_row_groups):
        st = f.metadata.row_group(i).column(ti).statistics
        if st is not None and st.has_min_max:
            lo, hi = pd.Timestamp(st.min), pd.Timestamp(st.max)
            lo = lo.tz_localize("UTC") if lo.tz is None else lo; hi = hi.tz_localize("UTC") if hi.tz is None else hi
            if hi < u0 or lo > u1: continue
        import pyarrow.compute as pc
        for bt in f.iter_batches(batch_size=50_000, row_groups=[i], columns=COLS + ["ts_event"]):
            ts = bt.column("ts_event")
            m = pc.and_(pc.greater_equal(ts, pa_ts(u0, ts.type)), pc.less_equal(ts, pa_ts(u1, ts.type)))
            if not pc.any(m).as_py(): continue
            tb = bt.filter(m).to_pandas()
            parts.append(tb.set_index("ts_event") if "ts_event" in tb.columns else tb)
    out = pd.concat(parts) if parts else None
    try:
        import pyarrow as pa; pa.default_memory_pool().release_unused()
    except Exception: pass
    return out

def from_glbx(dirs, r, t0, t1):
    for d in dirs:
        p = os.path.join(d, f"{r}_1m.parquet")
        if os.path.exists(p):
            try: df = _read_window(p, t0, t1)
            except Exception: continue
            df = _clip(_norm(df), t0, t1)
            if df is not None and len(df): return df
    return None

def from_archive(dirs, r, t0, t1):
    out = []
    for d in dirs:
        for day in pd.date_range(t0.normalize() - pd.Timedelta(days=1), t1.normalize() + pd.Timedelta(days=1), freq="D"):
            dd = os.path.join(d, f"{day:%Y/%m/%d}")
            g = os.path.join(dd, "glbx_ohlcv1m.parquet")
            if os.path.exists(g):
                try:
                    df = pd.read_parquet(g)
                    if "symbol" in df.columns: df = df[df["symbol"].astype(str).str.startswith(r + ".")]
                    out.append(_norm(df))
                except Exception: pass
            lv = os.path.join(dd, "live_bars_1m.parquet")
            if os.path.exists(lv):
                try:
                    df = pd.read_parquet(lv); df = df[df["symbol"].astype(str).str.upper().isin(ALIAS.get(r, (r,)))]
                    out.append(_norm(df.drop(columns=["symbol"])))
                except Exception: pass
    out = [x for x in out if x is not None and len(x)]
    if not out: return None
    df = pd.concat(out); df = df[~df.index.duplicated(keep="first")]
    return _clip(df.sort_index(), t0, t1)

def from_extra(dirs, r, t0, t1):
    out = []
    for d in dirs:
        for p in [os.path.join(d, f"{r}_1m.pkl"), os.path.join(d, f"supa_{r}.parquet")]:
            if os.path.exists(p):
                try: out.append(_norm(pd.read_pickle(p) if p.endswith(".pkl") else pd.read_parquet(p)))
                except Exception: pass
    out = [x for x in out if x is not None and len(x)]
    if not out: return None
    df = pd.concat(out); df = df[~df.index.duplicated(keep="first")]
    return _clip(df.sort_index(), t0, t1)

def from_ticks(dirs, r, t0, t1):
    names = ALIAS.get(r, (r,)); rows = []
    days = {f"{x:%Y-%m-%d}" for x in pd.date_range(t0.normalize() - pd.Timedelta(days=1), t1.normalize() + pd.Timedelta(days=1), freq="D")}
    lo, hi = t0.timestamp(), t1.timestamp()
    for d in dirs:
        for p in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
            if os.path.basename(p)[:10] not in days: continue
            with open(p) as f:
                for line in f:
                    try: x = json.loads(line)
                    except Exception: continue
                    if x.get("s") in names and lo <= x.get("t", 0) <= hi + 60:
                        rows.append((x["t"], x["o"], x["h"], x["l"], x["c"]))
    if not rows: return None
    df = pd.DataFrame(rows, columns=["t"] + COLS); df.index = pd.to_datetime(df.pop("t"), unit="s", utc=True).dt.tz_convert(CT)
    df = df.sort_index()
    m = df.resample("1min").agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
    return _clip(m, t0, t1)

def load_1m(sym, t0, t1, sources=None):
    """1m CT bars for [t0, t1] merged across sources; returns (df, [source names used])."""
    s = sources or default_sources(); r = root(sym)
    t0 = pd.Timestamp(t0).tz_convert(CT); t1 = pd.Timestamp(t1).tz_convert(CT)
    parts, used = [], []
    for name, fn in (("glbx", from_glbx), ("archive", from_archive), ("extra", from_extra), ("ticks", from_ticks)):
        df = fn(s.get(name, []), r, t0, t1)
        if df is not None and len(df): parts.append(df); used.append(name)
    if not parts: return pd.DataFrame(columns=COLS), used
    df = pd.concat(parts); df = df[~df.index.duplicated(keep="first")].sort_index()
    return df, used

def resample(df, rule):
    if not len(df): return df
    return df.resample(rule, label="left", closed="left").agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
