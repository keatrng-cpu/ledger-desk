"""A Robinhood read. Chain, greeks, bid, ask, and buying power. No order of any kind.

Login uses ROBINHOOD_USERNAME and ROBINHOOD_PASSWORD. The session is not written to disk.
"""

from __future__ import annotations

import os


def login():
    import robin_stocks.robinhood as rh

    user = os.environ.get("ROBINHOOD_USERNAME")
    password = os.environ.get("ROBINHOOD_PASSWORD")
    if not user or not password:
        raise RuntimeError("Robinhood login env is missing. Nothing was read.")
    rh.login(user, password, mfa_code=os.environ.get("ROBINHOOD_MFA") or None, store_session=False)
    return rh


def option_quote(symbol: str, expiration: str, strike: float, right: str) -> dict:
    """Bid, ask, and the greeks robin_stocks returns for that contract. Missing fields stay missing."""
    rh = login()
    rows = rh.find_options_by_expiration_and_strike(symbol, expiration, str(strike), right) or []
    if not rows:
        raise RuntimeError(f"no {symbol} {right} at {strike} for {expiration}")
    oid = rows[0].get("id")
    data = rh.get_option_market_data_by_id(oid) if oid else None
    row = data[0] if isinstance(data, list) and data else data if isinstance(data, dict) else {}
    def num(key: str):
        raw = row.get(key) if isinstance(row, dict) else None
        try:
            return float(raw)
        except (TypeError, ValueError):
            return None
    return {
        "symbol": symbol,
        "expiration": expiration,
        "strike": strike,
        "right": right,
        "bid": num("bid_price"),
        "ask": num("ask_price"),
        "delta": num("delta"),
        "gamma": num("gamma"),
        "theta": num("theta"),
        "vega": num("vega"),
        "iv": num("implied_volatility"),
        "volume": num("volume"),
        "open_interest": num("open_interest"),
    }


def buying_power() -> float | None:
    rh = login()
    profile = rh.load_portfolio_profile() or {}
    raw = profile.get("option_buying_power") or profile.get("buying_power")
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None
