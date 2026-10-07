"""A persistent quote socket. websocket-client is the connection. The URL is not guessed.

Robinhood does not publish a stable options socket in robin_stocks. Set RH_QUOTE_WS to the
stream URL from a logged-in session. With no URL, this refuses. The desk's own feed stays the price.
"""

from __future__ import annotations

import json
import os


def parse_quote(raw: str) -> dict:
    """One socket message. Bid and ask are required. A message without them is not a quote."""
    data = json.loads(raw)
    bid = data.get("bid")
    ask = data.get("ask")
    if bid is None or ask is None:
        raise ValueError("quote message has no bid and ask")
    ts = data.get("ts_ms") or data.get("ts")
    if ts is None:
        raise ValueError("quote message has no timestamp")
    return {"bid": float(bid), "ask": float(ask), "ts_ms": int(ts)}


def connect(on_quote, url: str | None = None):
    """Block on the socket and hand each parsed quote to `on_quote`. No URL, no connection."""
    import websocket

    endpoint = url or os.environ.get("RH_QUOTE_WS")
    if not endpoint:
        raise RuntimeError("RH_QUOTE_WS is not set. No socket URL is invented. The desk feed remains the price.")

    def _on_message(_ws, message: str) -> None:
        on_quote(parse_quote(message))

    ws = websocket.WebSocketApp(endpoint, on_message=_on_message)
    ws.run_forever()
