"""Cboe VIX / VIX9D / VIX3M daily history (free CSVs on cdn.cboe.com) -> term-structure ratios. LOG-ONLY.

Closed days only: a row dated today (CT) is used only after vix.settleCt (15:30 CT); otherwise the latest prior
day is the read. Regime labels (shared/free-data.json vix.regime):
  vix_vix3m >= 1.0 -> 'backwardation' (stress), 0.9..1.0 -> 'flat', < 0.9 -> 'contango';
  vix9d_vix >= 1.0 -> front end inverted (near-term stress above 30d).
"""
from __future__ import annotations

import csv
import io
import os
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo

from . import load_config

CT = ZoneInfo("America/Chicago")


def parse_csv(text: str) -> dict[str, float]:
    """{ISO date: close} from a Cboe *_History.csv (DATE,OPEN,HIGH,LOW,CLOSE with MM/DD/YYYY dates)."""
    out = {}
    for row in csv.DictReader(io.StringIO(text)):
        try:
            d = datetime.strptime(row["DATE"].strip(), "%m/%d/%Y").date().isoformat()
            out[d] = float(row["CLOSE"])
        except (KeyError, ValueError):
            continue
    return out


def ratios(vix: float, vix9d: float, vix3m: float, cfg=None) -> dict:
    rg = (cfg or load_config())["vix"]["regime"]
    r93 = vix9d / vix if vix else None
    r3m = vix / vix3m if vix3m else None
    if r3m is None:
        regime = None
    elif r3m >= rg["backwardationAt"]:
        regime = "backwardation"
    elif r3m >= rg["flatFrom"]:
        regime = "flat"
    else:
        regime = "contango"
    return {"vix": vix, "vix9d": vix9d, "vix3m": vix3m,
            "vix9d_vix": round(r93, 4) if r93 is not None else None,
            "vix_vix3m": round(r3m, 4) if r3m is not None else None,
            "regime": regime, "front_inverted": bool(r93 is not None and r93 >= rg["frontInvertedAt"])}


def term_structure(series: dict[str, dict[str, float]], now_ct: datetime, cfg=None) -> dict | None:
    cfg = cfg or load_config()
    hh, mm = map(int, cfg["vix"]["settleCt"].split(":"))
    today = now_ct.astimezone(CT).date().isoformat()
    after_settle = (now_ct.astimezone(CT).hour, now_ct.astimezone(CT).minute) >= (hh, mm)
    common = set(series["VIX"]) & set(series["VIX9D"]) & set(series["VIX3M"])
    days = sorted(d for d in common if d < today or (d == today and after_settle))
    if not days:
        return None
    d = days[-1]
    out = ratios(series["VIX"][d], series["VIX9D"][d], series["VIX3M"][d], cfg)
    out["date"] = d
    if len(days) > 1:
        p = days[-2]
        out["prev"] = {"date": p, **{k: v for k, v in ratios(series["VIX"][p], series["VIX9D"][p], series["VIX3M"][p], cfg).items()
                                     if k in ("vix9d_vix", "vix_vix3m", "regime")}}
    return out


def fetch(cache_dir: str, now: float | None = None, session=None, cfg=None) -> dict[str, dict[str, float]]:
    cfg = cfg or load_config()
    now = now or time.time()
    os.makedirs(cache_dir, exist_ok=True)
    out = {}
    for name, url in cfg["vix"]["urls"].items():
        p = os.path.join(cache_dir, f"{name}_History.csv")
        if not os.path.exists(p) or now - os.path.getmtime(p) >= cfg["vix"]["minFetchIntervalS"]:
            try:
                if session is None:
                    import requests
                    session = requests
                r = session.get(url, timeout=15, headers={"User-Agent": "ledger-desk-free-data/1.0"}, allow_redirects=True)
                if r.status_code == 200 and r.text.startswith("DATE"):
                    with open(p + ".part", "w") as f:
                        f.write(r.text)
                    os.replace(p + ".part", p)
            except Exception:
                pass
        out[name] = parse_csv(open(p).read()) if os.path.exists(p) else {}
    return out
