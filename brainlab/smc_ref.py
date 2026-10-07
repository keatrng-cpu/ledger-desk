"""An independent reference for the desk's structure detectors. Audit only: it reads bars and a dump, it places and scores nothing.

The desk finds fair value gaps in TypeScript (src/lib/trading/detectors.ts detectFvgs): a three-candle gap whose middle candle is a
real expansion (body >= a share of ATR). The open-source `smartmoneyconcepts` package (Joshua Attridge, MIT) finds the same gap by the
plain three-candle rule with no size filter. So every FVG the desk reports must ALSO be one the library reports, with the same bounds.
A desk gap the library does not see is a bug in one of them, and this reports it by name. The library's extra gaps are expected: they are
the small ones the desk filters out.

    npx tsx scripts/dump-desk-fvgs.mjs MNQ 800 > .cache/desk-fvgs-MNQ.json
    brainlab/.venv/Scripts/python brainlab/smc_ref.py .cache/desk-fvgs-MNQ.json
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

TOL = 1e-6


def _library():
    """Import the library with its stdout swallowed: it prints a banner (with an emoji) that cannot be encoded on a cp1252 console."""
    with contextlib.redirect_stdout(io.StringIO()):
        from smartmoneyconcepts import smc

    return smc


def frame(bars: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(bars).rename(columns={"o": "open", "h": "high", "l": "low", "c": "close"})
    if "volume" not in df.columns:
        df["volume"] = 0.0
    df["at"] = pd.to_datetime(df["t"], unit="ms", utc=True)
    return df.set_index("at")[["open", "high", "low", "close", "volume"]].astype(float)


def library_fvgs(df: pd.DataFrame) -> list[dict]:
    """The library's gaps as the desk names them: kind, the index of the THIRD candle, and the gap bounds."""
    out = _library().fvg(df)
    gaps: list[dict] = []
    for i, row in enumerate(out.itertuples(index=False)):
        if row.FVG != row.FVG or row.FVG == 0:  # NaN or none
            continue
        # The library marks the MIDDLE candle; the desk indexes the third.
        gaps.append({"kind": "bull" if row.FVG > 0 else "bear", "createdIndex": i + 1, "top": float(row.Top), "bottom": float(row.Bottom)})
    return gaps


def crosscheck_fvg(df: pd.DataFrame, desk: list[dict]) -> dict:
    lib = library_fvgs(df)
    key = lambda g: (g["kind"], g["createdIndex"])  # noqa: E731
    by_key = {key(g): g for g in lib}
    missing, wrong_bounds = [], []
    for g in desk:
        mine = by_key.get(key(g))
        if mine is None:
            missing.append(g)
        elif abs(mine["top"] - g["top"]) > TOL or abs(mine["bottom"] - g["bottom"]) > TOL:
            wrong_bounds.append({"desk": g, "library": mine})
    desk_keys = {key(g) for g in desk}
    return {
        "bars": int(len(df)),
        "desk_fvgs": len(desk),
        "library_fvgs": len(lib),
        "agree": len(desk) - len(missing) - len(wrong_bounds),
        "desk_not_in_library": missing,
        "bounds_differ": wrong_bounds,
        "library_only": sum(1 for g in lib if key(g) not in desk_keys),
        "note": "library_only are the small gaps the desk's body-versus-ATR filter drops; desk_not_in_library and bounds_differ are the findings.",
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: smc_ref.py desk-fvgs.json")
        return 2
    dump = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    res = crosscheck_fvg(frame(dump["bars"]), dump["fvgs"])
    print(json.dumps({k: v for k, v in res.items() if k not in ("desk_not_in_library", "bounds_differ")}, indent=2))
    for name in ("desk_not_in_library", "bounds_differ"):
        for g in res[name][:10]:
            print(f"  {name}: {g}")
    return 1 if res["desk_not_in_library"] or res["bounds_differ"] else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main(sys.argv))
