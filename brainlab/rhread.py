"""A Robinhood read. Chain, greeks, bid, ask, and buying power. No order of any kind.

Login uses ROBINHOOD_USERNAME and ROBINHOOD_PASSWORD. The session is not written to disk.
"""

from __future__ import annotations

import os


def _load_env() -> None:
    """Read brainlab/.env (git-ignored) into the environment, without overriding what is already set. Absent file or package: nothing happens."""
    try:
        from pathlib import Path

        from dotenv import load_dotenv

        load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
    except ImportError:
        pass


def login():
    import robin_stocks.robinhood as rh

    _load_env()
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


#: The desk trades ONE account (docs/RH_LIVE_ROUTINE.md): Agentic ••6158. The default account for this login is the Individual one, whose
#: buying power ($11.56 on 2026-10-06) would read as "no room to trade" and is not the account an order goes to.
TRADE_ACCOUNT = "995386158"


def buying_power(account_number: str | None = None) -> float | None:
    """Option buying power of the TRADE account. An unreadable field is None, not zero."""
    rh = login()
    profile = rh.load_portfolio_profile(account_number=account_number or os.environ.get("RH_ACCOUNT_NUMBER") or TRADE_ACCOUNT) or {}
    raw = profile.get("option_buying_power") or profile.get("buying_power")
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None
