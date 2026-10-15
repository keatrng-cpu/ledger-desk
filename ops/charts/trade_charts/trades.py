"""Normalise closed trades from the live RH watcher and the paper futures lanes into one record shape.

record = dict(signal, chart_id, source, symbol (ES|NQ), side, band, q, entry, stop, t1, t2, fill_px, fill_t,
              exit_px, exit_t, events=[dict(t, what, px, qty, pnl, opt_px)], R, pnl_usd, verdicts, gates, option)
Prices on the record are UNDERLYING futures prices (ES/NQ points); option prices ride along in events[*].opt_px."""
import csv, json, os, re
import pandas as pd

CT = "America/Chicago"
def ts(x):
    if x is None or x == "": return None
    if isinstance(x, (int, float)): return pd.Timestamp(x, unit="s", tz="UTC").tz_convert(CT)
    t = pd.Timestamp(x); return (t.tz_localize(CT) if t.tz is None else t.tz_convert(CT))

def _f(x):
    try: return float(x)
    except Exception: return None

def r_multiple(side, fill, stop, legs):
    """qty-weighted R on the underlying: sum(q * dir*(px-fill)) / (sum(q) * |fill-stop|)."""
    d = 1 if side == "long" else -1; risk = abs(fill - stop) if fill is not None and stop is not None else 0
    q = sum(l["qty"] for l in legs) or 0
    if not risk or not q: return None
    return round(sum(l["qty"] * d * (l["px"] - fill) for l in legs) / (q * risk), 2)

# ---------------- live RH options (desk-watcher) ----------------
FIRE = re.compile(r"FIRE (?P<band>[A-C][+-]?) (?P<sym>\w+) (?P<side>long|short) q=(?P<q>[\d.]+) entry=(?P<entry>[\d.]+) stop=(?P<stop>[\d.]+) tgt=(?P<tgt>[\d.]+)(?: rr=(?P<rr>[\d.]+))?(?: disp=(?P<disp>[\d.]+))?")
OPT = re.compile(r"(?P<n>\d+)x (?P<und>[A-Z]+) (?P<exp>\d{4}-\d{2}-\d{2}) (?P<k>[\d.]+)(?P<cp>[CP]) @ (?P<px>[\d.]+)")
FILLED = re.compile(r"^FILLED (?P<qty>\d+) @ (?P<px>[\d.]+)")
MANAGE = re.compile(r"^(?P<act>EXIT|TRIM) (?P<qty>\d+) @ (?P<px>[\d.]+): (?P<why>.*?)(?:\(px (?P<upx>[\d.]+)\))?\s*$", re.S)

def _gates_for(gates_log, signal, before):
    """Last gates.log evaluation of `signal` at/before the FIRE: desk band/q, brain/HTF text, Floor verdict, decisive gates."""
    best = None
    if not gates_log or not os.path.exists(gates_log): return None
    with open(gates_log) as f:
        for line in f:
            if signal not in line: continue
            try: r = json.loads(line)
            except Exception: continue
            if r.get("signal") != signal or r.get("manage") or ts(r["ts"]) > before + pd.Timedelta(seconds=5): continue
            best = r
    return best

def _parse_gates(r):
    if not r: return {}, {}
    g = {x[0]: x for x in r.get("gates", [])}; txt = lambda n: str(g.get(n, ["", "", ""])[2])
    agree = txt("fast:agree"); m = re.search(r"brain (\w+)", agree); htf = re.search(r"1h (\w+) 4h (\w+)", agree)
    fv = re.search(r"floor verdict (\w+)", txt("soft:verdict"))
    t2 = re.search(r"T2 ([\d.]+)", txt("fast:geometry"))
    hard_fail = [n for n, x in g.items() if not x[1]]
    soft = [n for n, x in g.items() if str(x[2]).startswith("WOULD")]
    shadow = [n for n in g if n.startswith("shadow:") and "block" in txt(n).lower()]
    verdicts = dict(desk=dict(band=r.get("band"), q=r.get("q")), brain=m.group(1) if m else None,
                    floor=fv.group(1) if fv else ("ok" if "soft:verdict" in g else None),
                    card_htf=dict(h1=htf.group(1), h4=htf.group(2)) if htf else None)
    gates = dict(live_block=hard_fail, soft_block=soft, shadow_block=shadow, t2=_f(t2.group(1)) if t2 else None,
                 rules=r.get("rules_hash"), n_gates=len(g))
    return verdicts, gates

def underlying_at(ticks_dirs, sym, t, window=120):
    """Nearest watcher tick price for sym (ES or MNQ->NQ) within `window` seconds of t."""
    names = ("ES", "MES") if sym == "ES" else ("NQ", "MNQ"); best = None; tt = t.timestamp()
    for d in ticks_dirs:
        for q in sorted({os.path.join(d, f"{t + pd.Timedelta(days=k):%Y-%m-%d}.jsonl") for k in (-1, 0, 1)}):
            if not os.path.exists(q): continue
            with open(q) as f:
                for line in f:
                    try: x = json.loads(line)
                    except Exception: continue
                    if x.get("s") in names and abs(x["t"] - tt) <= window and (best is None or abs(x["t"] - tt) < best[0]): best = (abs(x["t"] - tt), x["c"])
    return best[1] if best else None

def load_live(watcher_dir, since=None, until=None):
    al = os.path.join(watcher_dir, "alerts.log"); out = []; cur = None
    if not os.path.exists(al): return out
    ticks = [os.path.join(watcher_dir, "ticks")]
    with open(al) as f:
        rows = [json.loads(l) for l in f if l.strip().startswith("{")]
    for r in rows:
        text = str(r.get("text", "")); t = ts(r["ts"])
        m = FIRE.match(text)
        if m:
            o = OPT.search(text); d = m.groupdict()
            cur = dict(signal=r.get("signal"), chart_id=r.get("signal"), source="live_rh", symbol="NQ" if d["sym"] in ("MNQ", "NQ") else d["sym"],
                       side=d["side"], band=d["band"], q=_f(d["q"]), entry=_f(d["entry"]), stop=_f(d["stop"]), t1=_f(d["tgt"]), t2=None,
                       card_rr=_f(d["rr"]), card_disp=_f(d["disp"]), fire_t=t, fill_t=None, fill_px=None, events=[],
                       option=(dict(n=int(o["n"]), underlier=o["und"], exp=o["exp"], strike=float(o["k"]), cp=o["cp"], ask=float(o["px"])) if o else None))
            cur["events"].append(dict(t=t, what="FIRE", px=None, qty=None))
            continue
        if cur is None: continue
        m = FILLED.match(text)
        if m:
            cur["fill_t"] = t; cur["opt_fill"] = float(m["px"]); cur["qty"] = int(m["qty"])
            cur["events"].append(dict(t=t, what="FILL", qty=int(m["qty"]), opt_px=float(m["px"]), px=None)); continue
        m = MANAGE.match(text)
        if m and cur.get("fill_t") is not None:
            cur["events"].append(dict(t=t, what=m["act"], qty=int(m["qty"]), opt_px=float(m["px"]), px=_f(m["upx"]), why=m["why"].strip().rstrip(":")))
            if m["act"] == "EXIT": out.append(cur); cur = None
            continue
        if re.match(r"entry order (cancelled|rejected|failed)|entry unfilled|limit walk stopped", text) and cur.get("fill_t") is None:
            cur = None
    res = []
    for c in out:
        if since and c["fill_t"] < since: continue
        if until and c["fill_t"] > until: continue
        sym = c["symbol"]
        g = _gates_for(os.path.join(watcher_dir, "gates.log"), c["signal"], c["fire_t"])
        c["verdicts"], c["gates"] = _parse_gates(g); c["t2"] = c["gates"].get("t2")
        c["fill_px"] = underlying_at(ticks, sym, c["fill_t"]) or c["entry"]
        for e in c["events"]:
            if e["px"] is None and e["what"] in ("FILL", "TRIM", "EXIT"): e["px"] = underlying_at(ticks, sym, e["t"])
            if e["what"] == "FILL": e["px"] = c["fill_px"]
        ex = [e for e in c["events"] if e["what"] in ("TRIM", "EXIT")]
        c["exit_t"], c["exit_px"] = ex[-1]["t"], ex[-1]["px"]
        c["R"] = r_multiple(c["side"], c["fill_px"], c["stop"], [e for e in ex if e["px"] is not None])
        c["pnl_usd"] = round(sum((e["opt_px"] - c["opt_fill"]) * 100 * e["qty"] for e in ex), 2)
        res.append(c)
    return res

# ---------------- paper futures (/workspace/paper-futures trades.csv) ----------------
def load_paper_futures(path, since=None, until=None):
    if not os.path.exists(path): return []
    rows = {}
    with open(path) as f:
        for r in csv.DictReader(f): rows[r["id"]] = r          # file has duplicate rows: last write wins
    out = []
    for r in rows.values():
        if r.get("status") != "closed": continue
        try: ev = json.loads(r["exit_events"] or "[]")
        except Exception: continue
        ent = next((e for e in ev if e.get("what") == "entry"), None)
        if not ent: continue
        fill_t = ts(ent["at"]); exits = [e for e in ev if e.get("what") != "entry"]
        if not exits or (since and fill_t < since) or (until and fill_t > until): continue
        ch = ent.get("chain") or {}; sym = "NQ" if r["symbol"] in ("NQ", "MNQ") else r["symbol"]
        side = r["side"]; fill = float(ent["px"]); stop = float(r["stop"])
        legs = [dict(qty=float(e.get("qty") or 0), px=float(e["px"])) for e in exits]
        rec = dict(signal=ch.get("signal") or r["id"], chart_id=f"{r['id']}", source="paper_futures", symbol=sym, side=side,
                   band=r.get("band"), q=_f(r.get("q")), entry=_f(r["entry"]), stop=stop, t1=_f(r["t1"]), t2=_f(r["t2"]),
                   fire_t=ts(r["alerted"]), fill_t=fill_t, fill_px=fill, qty=float(ent.get("qty") or 0),
                   exit_t=ts(exits[-1]["at"]), exit_px=float(exits[-1]["px"]),
                   events=[dict(t=ts(r["alerted"]), what="ALERT", px=None, qty=None), dict(t=fill_t, what="FILL", px=fill, qty=ent.get("qty"))] +
                          [dict(t=ts(e["at"]), what=("EXIT" if i == len(exits) - 1 else "TRIM"), px=float(e["px"]), qty=e.get("qty"), pnl=e.get("pnl"), why=e.get("what")) for i, e in enumerate(exits)],
                   R=r_multiple(side, fill, stop, legs), pnl_usd=_f(r.get("pnl$")), option=None)
        rec["verdicts"] = dict(desk=ch.get("desk"), brain=(ch.get("brain") or {}).get("word"), floor=(ch.get("floor") or {}).get("verdict"), card_htf=None)
        rec["gates"] = dict(live_block=ch.get("live_would_block", []), soft_block=ch.get("soft_would_block", []),
                            shadow_block=ch.get("shadow_would_block", []), rules=ch.get("rules_sha"))
        out.append(rec)
    return sorted(out, key=lambda x: x["fill_t"])

# ---------------- paper-trend lane (box /workspace/paper-trend, VPS /var/lib/ledger-paper) ----------------
def load_paper_trend(events_path, source="paper_trend", since=None, until=None):
    if not os.path.exists(events_path): return []
    out = []
    with open(events_path) as f:
        for line in f:
            try: r = json.loads(line)
            except Exception: continue
            if r.get("ev") != "paper_exit": continue
            day = r["date"]; side = "long" if int(r["side"]) > 0 else "short"
            fill_t = ts(f"{day} {r['signal_time_ct']}") + pd.Timedelta(minutes=1); exit_t = ts(f"{day} {r['exit_time_ct']}")
            if (since and fill_t < since) or (until and fill_t > until): continue
            fill, stop = float(r["entry"]), float(r["stop"])
            out.append(dict(signal=f"trend-{day}", chart_id=f"{source}-{day}", source=source, symbol="NQ", side=side, band=None, q=None,
                            entry=fill, stop=stop, t1=_f(r.get("target")), t2=None, fire_t=fill_t, fill_t=fill_t, fill_px=fill, qty=1,
                            exit_t=exit_t, exit_px=float(r["exit_px"]),
                            events=[dict(t=fill_t, what="FILL", px=fill, qty=1), dict(t=exit_t, what="EXIT", px=float(r["exit_px"]), qty=1, why=r.get("exit_reason"))],
                            R=_f(r.get("R")), pnl_usd=_f(r.get("usd_1mnq")), option=None,
                            verdicts=dict(desk=dict(score=r.get("score")), brain=None, floor=None, card_htf=None),
                            gates=dict(live_block=[], soft_block=[], shadow_block=[], features=r.get("features"))))
    return out

def load_all(cfg, since=None, until=None):
    tr = load_live(cfg["watcher_dir"], since, until) if cfg.get("watcher_dir") else []
    tr += load_paper_futures(cfg["paper_futures_csv"], since, until) if cfg.get("paper_futures_csv") else []
    for src, p in (("paper_trend", cfg.get("paper_trend_events")), ("vps_paper", cfg.get("vps_paper_events"))):
        if p: tr += load_paper_trend(p, src, since, until)
    seen = set(); res = []
    for t in sorted(tr, key=lambda x: x["fill_t"]):
        k = (t["source"], t["chart_id"])
        if k not in seen: seen.add(k); res.append(t)
    return res
