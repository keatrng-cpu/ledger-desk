"""Swing legs from the bars themselves. ATR is only the measuring stick. No RSI, no MACD, no lagging overlay."""

from __future__ import annotations

import pandas as pd


def atr(df: pd.DataFrame, length: int = 14) -> pd.Series:
    import pandas_ta_classic as ta

    series = ta.atr(df["high"], df["low"], df["close"], length=length)
    if series is None:
        raise RuntimeError("pandas-ta returned no ATR.")
    return series


def swings(df: pd.DataFrame, left: int = 2, right: int = 2) -> list[dict]:
    """A swing is confirmed only once `right` bars have printed past it. A wick that is still the high is not a swing yet."""
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    index = df.index
    found: list[dict] = []
    for i in range(left, len(df) - right):
        h, l = float(high[i]), float(low[i])
        if h > float(high[i - left : i].max()) and h > float(high[i + 1 : i + 1 + right].max()):
            found.append({"kind": "high", "i": i, "px": h, "at": str(index[i])})
        if l < float(low[i - left : i].min()) and l < float(low[i + 1 : i + 1 + right].min()):
            found.append({"kind": "low", "i": i, "px": l, "at": str(index[i])})
    found.sort(key=lambda s: s["i"])
    return found


def legs(df: pd.DataFrame, left: int = 2, right: int = 2) -> list[dict]:
    """One leg is a confirmed high and the next confirmed low, or the reverse. The range is their distance, also in ATR."""
    points = swings(df, left, right)
    scale = atr(df)
    out: list[dict] = []
    for a, b in zip(points, points[1:]):
        if a["kind"] == b["kind"]:
            continue
        hi = a if a["kind"] == "high" else b
        lo = b if b["kind"] == "low" else a
        span = hi["px"] - lo["px"]
        unit = scale.iloc[b["i"]]
        atrs = None if unit is None or pd.isna(unit) or unit == 0 else round(span / float(unit), 2)
        out.append(
            {
                "from": a["kind"],
                "to": b["kind"],
                "high": hi["px"],
                "low": lo["px"],
                "points": round(span, 2),
                "atrs": atrs,
                "from_at": a["at"],
                "to_at": b["at"],
            }
        )
    return out


def say(symbol: str, df: pd.DataFrame) -> str:
    """One sentence. Prices in it are prints from `df`. If there is no leg, the sentence says so."""
    found = legs(df)
    last = float(df["close"].iloc[-1])
    if not found:
        return f"{symbol}: no confirmed swing leg in these bars. Last close {last:.2f}."
    leg = found[-1]
    unit = f"{leg['atrs']} ATR" if leg["atrs"] is not None else "ATR not ready"
    return (
        f"{symbol}: last confirmed leg is a {leg['from']} at {leg['from_at']} to a {leg['to']} at {leg['to_at']}. "
        f"High {leg['high']:.2f}, low {leg['low']:.2f}, {leg['points']:.2f} points, {unit}. Last close {last:.2f}."
    )
