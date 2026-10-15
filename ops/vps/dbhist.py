"""Databento historical helpers — GLBX.MDP3 ohlcv-1m ONLY (CME history is $0 on the plan).
Every pull is preceded by metadata.get_cost and aborted unless the cost is exactly $0."""
import datetime as D, os
ALLOWED_DATASET = "GLBX.MDP3"; ALLOWED_SCHEMA = "ohlcv-1m"
ROOTS = {"ES": "ES.v.0", "NQ": "NQ.v.0", "MNQ": "MNQ.v.0"}   # volume-ranked continuous front month

class CostAbort(RuntimeError): pass

def guard(dataset, schema):
    if dataset != ALLOWED_DATASET or schema != ALLOWED_SCHEMA:
        raise CostAbort(f"refusing {dataset}/{schema}: only {ALLOWED_DATASET}/{ALLOWED_SCHEMA} is allowed")

def pull(client, symbols, start, end, dataset=ALLOWED_DATASET, schema=ALLOWED_SCHEMA):
    """Return (DataFrame, cost). Raises CostAbort if cost > 0 (nothing is downloaded)."""
    guard(dataset, schema)
    kw = dict(dataset=dataset, schema=schema, symbols=symbols, stype_in="continuous", start=start, end=end)
    cost = float(client.metadata.get_cost(**kw))
    if cost > 0: raise CostAbort(f"get_cost={cost} > 0 for {symbols} {start}..{end}; aborted")
    df = client.timeseries.get_range(**kw).to_df()
    return df, cost

def client():
    import databento as db
    return db.Historical(os.environ["DATABENTO_API_KEY"])

def refresh_history(path, root="NQ", days=60, cl=None):
    """Keep a rolling `days` window of 1m bars for one root at `path` (parquet: UTC index; open/high/low/close/volume)."""
    import pandas as pd
    cl = cl or client(); end = (D.datetime.now(D.timezone.utc) - D.timedelta(minutes=30)).replace(second=0, microsecond=0)
    old = pd.read_parquet(path) if os.path.exists(path) else None
    start = (old.index.max() + pd.Timedelta(minutes=1)).to_pydatetime() if old is not None and len(old) else end - D.timedelta(days=days)
    if start >= end: return old, 0.0
    df, cost = pull(cl, [ROOTS[root]], start.isoformat(), end.isoformat())
    df = df[["open", "high", "low", "close", "volume"]]
    out = pd.concat([old, df]) if old is not None else df
    out = out[~out.index.duplicated(keep="last")].sort_index()
    out = out[out.index >= out.index.max() - pd.Timedelta(days=days)]
    tmp = path + ".tmp"; out.to_parquet(tmp, compression="zstd"); os.replace(tmp, path)
    return out, cost
