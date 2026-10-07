"""Turn an opened GitHub issue into a note. Reads only what was written. Does not file an order."""

from __future__ import annotations

import argparse
import json
import re
import sys

SYMBOLS = ("MNQ", "MES", "NQ", "ES")


def parse_issue(title: str, body: str) -> dict:
    text = f"{title}\n{body}"
    upper = text.upper()
    symbol = next((s for s in SYMBOLS if re.search(rf"\b{s}\b", upper)), None)
    side = None
    if re.search(r"\b(short|put|puts|sell)\b", text, re.I):
        side = "short"
    elif re.search(r"\b(long|call|calls|buy)\b", text, re.I):
        side = "long"
    note = " ".join((body or "").split())
    return {"symbol": symbol, "side": side, "title": (title or "").strip(), "note": note[:2000]}


def render(parsed: dict) -> str:
    if not parsed["symbol"]:
        return "No symbol in the issue. Nothing was added to the book. This is not an order.\n"
    side = parsed["side"] or "no side written"
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
