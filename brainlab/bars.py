"""Bars for the lab. Same Yahoo symbols the desk already uses. MetaTrader 5 is the Windows terminal, or nothing."""

from __future__ import annotations

import pandas as pd

# Matches src/lib/market/yahoo.ts YAHOO_MAP. Do not invent a fourth symbol.
YAHOO = {"MNQ": "MNQ=F", "ES": "ES=F", "NQ": "NQ=F"}


def _flatten(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    if isinstance(out.columns, pd.MultiIndex):
        out.columns = [str(c[0]).lower() for c in out.columns]
    else:
        out.columns = [str(c).lower() for c in out.columns]
    need = ["open", "high", "low", "close"]
    missing = [c for c in need if c not in out.columns]
    if missing:
        raise RuntimeError(f"bar frame is missing {missing}")
    out = out[need].apply(pd.to_numeric, errors="coerce").dropna()
    if out.empty:
        raise RuntimeError("bar frame was empty after the drop")
    return out


def yahoo_bars(symbol: str = "MNQ", period: str = "5d", interval: str = "60m") -> pd.DataFrame:
    """Historical bars from Yahoo. `symbol` is MNQ, ES, or NQ — the desk's names, not a broker ticker."""
    import yfinance as yf

    key = symbol.upper()
    ticker = YAHOO.get(key)
    if ticker is None:
        raise RuntimeError(f"{symbol} is not a desk symbol. Use MNQ, ES, or NQ.")
    df = yf.download(ticker, period=period, interval=interval, progress=False, auto_adjust=False)
    if df is None or len(df) == 0:
        raise RuntimeError(f"Yahoo returned no bars for {ticker}.")
    return _flatten(df)


def mt5_bars(symbol: str, timeframe: str = "H1", count: int = 200) -> pd.DataFrame:
    """Same columns as yahoo_bars. Only works on Windows with the MT5 terminal installed and logged in."""
    try:
        import MetaTrader5 as mt5
    except ImportError as e:
        raise RuntimeError(
            "MetaTrader5 is not installed. The library is Windows-only and needs the terminal running. This host uses Yahoo."
        ) from e
    tf = {
        "M1": mt5.TIMEFRAME_M1,
        "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15,
        "H1": mt5.TIMEFRAME_H1,
        "D1": mt5.TIMEFRAME_D1,
    }.get(timeframe)
    if tf is None:
        raise RuntimeError(f"{timeframe} is not a terminal timeframe this lab asks for.")
    if not mt5.initialize():
        raise RuntimeError(f"MetaTrader5 terminal did not start: {mt5.last_error()}")
    rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
    mt5.shutdown()
    if rates is None or len(rates) == 0:
        raise RuntimeError(f"MetaTrader5 returned no bars for {symbol}.")
    df = pd.DataFrame(rates)
    df["at"] = pd.to_datetime(df["time"], unit="s", utc=True)
    df = df.set_index("at")
    return _flatten(df)
