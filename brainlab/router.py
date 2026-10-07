"""Judge a quote. Never place one.

Robinhood on the desk is the only execution path. A quote that passes is logged as usable.
Nothing in this file sends, cancels, or replaces an order.
"""

from __future__ import annotations

import time

from pydantic import ValidationError

from fills import record
from gate import OrderIntent


def review(raw: dict) -> tuple[OrderIntent | None, str]:
    try:
        return OrderIntent.model_validate(raw), ""
    except ValidationError as e:
        errs = e.errors()
        reason = str(errs[0].get("ctx", {}).get("error") or errs[0].get("msg") or "refused")
        reason = reason.removeprefix("Value error, ")
        return None, reason


def judge(raw: dict, db=None) -> dict:
    """Write whether the quote is inside the desk's cuts. The return never includes an order."""
    now = int(raw.get("now_ms") or time.time() * 1000)
    intent, reason = review(raw)
    if intent is None:
        ticket = record(
            symbol=str(raw.get("symbol") or "?"),
            right=str(raw.get("right") or "?"),
            status="unusable",
            reason=reason,
            signal_at_ms=now,
            path=db,
        )
        return {"sent": False, "status": "unusable", "reason": reason, "ticket": ticket}

    ticket = record(
        symbol=intent.symbol,
        right=intent.right,
        status="usable",
        reason="note",
        signal_at_ms=now,
        intended_px=intent.limit_px,
        path=db,
    )
    return {
        "sent": False,
        "status": "usable",
        "reason": "Inside the desk's spread, age, debit, and noise cuts. A note. Not a gate. The desk places.",
        "limit": intent.limit_px,
        "debit": intent.debit_at_limit,
        "ticket": ticket,
    }
