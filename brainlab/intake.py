"""Turn an opened GitHub issue into a note. Reads only what was written. Does not file an order.

The comment it produces is posted on a PUBLIC repo, so the text is made inert first: no @mention, no link, no HTML.
When the issue names both a long and a short, the side is left unwritten instead of guessing the first one.
"""

from __future__ import annotations

import argparse
import json
import re
import sys

SYMBOLS = ("MNQ", "MES", "NQ", "ES")
_URL = re.compile(r"https?://\S+", re.I)
_SHORT = re.compile(r"\b(short|shorts|shorted)\b", re.I)
_LONG = re.compile(r"\b(long|longs)\b", re.I)
# "put" and "call" are ordinary words ("call me at 5pm", "put it back"). They count only with an option word, a dollar amount or a
# three-digit-plus strike within the same short clause ("puts at 500", "calls 24500", "ATM puts"), never a lone digit.
_NEAR = r"(?:\$\d|\d{3,}|\b(?:atm|otm|itm|strike|spread|option|options|contract|contracts|debit|expiry|expiration|dte)\b)"
_PUT = re.compile(rf"(?:\b(?:atm|otm|itm)\s+)?\bputs?\b(?:(?<=\b(?:atm|otm|itm) put)|(?<=\b(?:atm|otm|itm) puts)|(?=[^.!?\n]{{0,25}}?{_NEAR}))", re.I)
_CALL = re.compile(rf"(?:\b(?:atm|otm|itm)\s+)?\bcalls?\b(?:(?<=\b(?:atm|otm|itm) call)|(?<=\b(?:atm|otm|itm) calls)|(?=[^.!?\n]{{0,25}}?{_NEAR}))", re.I)


def safe_text(text: str, limit: int = 2000) -> str:
    """Collapse whitespace, drop links, and break @mentions and HTML so the comment cannot ping anyone or render markup."""
    flat = " ".join((text or "").split())
    flat = _URL.sub("[link removed]", flat)
    flat = flat.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    flat = flat.replace("@", "@​")
    return flat[:limit]


def parse_issue(title: str, body: str) -> dict:
    text = f"{title}\n{body}"
    upper = text.upper()
    symbol = next((s for s in SYMBOLS if re.search(rf"\b{s}\b", upper)), None)
    says_short = bool(_SHORT.search(text) or _PUT.search(text))
    says_long = bool(_LONG.search(text) or _CALL.search(text))
    side = None
    if says_short and not says_long:
        side = "short"
    elif says_long and not says_short:
        side = "long"
    return {
        "symbol": symbol,
        "side": side,
        "both_sides": says_short and says_long,
        "title": safe_text(title, 200),
        "note": safe_text(body or "", 2000),
    }


def render(parsed: dict) -> str:
    if not parsed["symbol"]:
        return "No symbol in the issue. Nothing was added to the book. This is not an order.\n"
    side = "both a long and a short were written; no side taken" if parsed.get("both_sides") else (parsed["side"] or "no side written")
    note = parsed["note"] or "(no body)"
    return (
        "### Brain intake\n\n"
        f"Symbol: {parsed['symbol']}\n\n"
        f"Side: {side}\n\n"
        f"Note: {note}\n\n"
        "A note for the book. Paste it into the lab if you want it remembered. This is not an order.\n"
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--json")
    p.add_argument("--title", default="")
    p.add_argument("--body", default="")
    args = p.parse_args(argv)
    if args.json:
        raw = json.loads(open(args.json, encoding="utf-8").read())
        title, body = raw.get("title") or "", raw.get("body") or ""
    else:
        title, body = args.title, args.body
    sys.stdout.write(render(parse_issue(title, body)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
