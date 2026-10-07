"""Millisecond log of a ticket: signal, send, fill, and the slip between the intended price and the fill.

The file is local (brainlab/out/). It is not a gate and it is not the floor's journal.
Slippage is in dollars per contract: what Robinhood filled minus the limit we meant (positive is worse for a buy).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from sqlalchemy import Float, Integer, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

ROOT = Path(__file__).resolve().parent
DEFAULT_DB = ROOT / "out" / "fills.sqlite"

#: A ticket may be filled only from one of these. "unusable" never left the lab, and "filled" is filled once.
FILLABLE = ("usable", "sent")
#: Fewer fills than this and no test is run: a z on a handful of fills is noise about noise.
MIN_FILLS_FOR_TEST = 20
RECENT_WINDOW = 10


class Base(DeclarativeBase):
    pass


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(16))
    right: Mapped[str] = mapped_column(String(8))
    status: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str] = mapped_column(String(80), default="")
    intended_px: Mapped[float | None] = mapped_column(Float, nullable=True)
    fill_px: Mapped[float | None] = mapped_column(Float, nullable=True)
    signal_at_ms: Mapped[int] = mapped_column(Integer)
    sent_at_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    filled_at_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)


def _engine(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    return create_engine(f"sqlite:///{path}")


def open_db(path: Path | None = None):
    engine = _engine(path or DEFAULT_DB)
    Base.metadata.create_all(engine)
    return engine


def record(
    *,
    symbol: str,
    right: str,
    status: str,
    reason: str,
    signal_at_ms: int,
    intended_px: float | None = None,
    path: Path | None = None,
) -> int:
    engine = open_db(path)
    with Session(engine) as s:
        row = Ticket(
            symbol=symbol,
            right=right,
            status=status,
            reason=reason,
            intended_px=intended_px,
            signal_at_ms=signal_at_ms,
        )
        s.add(row)
        s.commit()
        return row.id


def mark_sent(ticket_id: int, sent_at_ms: int, path: Path | None = None) -> None:
    engine = open_db(path)
    with Session(engine) as s:
        row = s.get(Ticket, ticket_id)
        if row is None:
            raise RuntimeError(f"no ticket {ticket_id}")
        if row.status not in FILLABLE:
            raise RuntimeError(f"ticket {ticket_id} is {row.status}; only a usable ticket is sent")
        row.status = "sent"
        row.sent_at_ms = sent_at_ms
        s.commit()


def mark_filled(ticket_id: int, fill_px: float, filled_at_ms: int, path: Path | None = None) -> float:
    """Slippage in dollars per contract: what Robinhood filled minus the limit we meant."""
    engine = open_db(path)
    with Session(engine) as s:
        row = s.get(Ticket, ticket_id)
        if row is None or row.intended_px is None:
            raise RuntimeError(f"ticket {ticket_id} has no intended price")
        if row.status not in FILLABLE:
            # An unusable quote never reached the broker, and a filled ticket is not filled twice: either would corrupt the slippage book.
            raise RuntimeError(f"ticket {ticket_id} is {row.status}; it cannot be filled")
        if not fill_px > 0:
            raise RuntimeError("a fill price must be above zero")
        row.status = "filled"
        row.fill_px = fill_px
        row.filled_at_ms = filled_at_ms
        slip = fill_px - row.intended_px
        s.commit()
        return slip


def latency_ms(ticket_id: int, path: Path | None = None) -> dict:
    """Signal to send and send to fill, in milliseconds. A leg that did not happen yet is None, not zero."""
    engine = open_db(path)
    with Session(engine) as s:
        row = s.get(Ticket, ticket_id)
        if row is None:
            raise RuntimeError(f"no ticket {ticket_id}")
        sent = None if row.sent_at_ms is None else row.sent_at_ms - row.signal_at_ms
        fill = None if row.sent_at_ms is None or row.filled_at_ms is None else row.filled_at_ms - row.sent_at_ms
        return {"signal_to_send": sent, "send_to_fill": fill}


def slippage_report(path: Path | None = None) -> dict:
    """What the filled tickets cost against the limit we meant, and whether the latest fills are worse than the ones before.

    The test (Welch's t) runs only with at least MIN_FILLS_FOR_TEST fills and RECENT_WINDOW in each arm. Below that the report says so
    and prints no p-value. It is a note about execution, never a gate and never a reason to move a number in config.ts.
    """
    engine = open_db(path)
    with Session(engine) as s:
        rows = s.execute(select(Ticket).where(Ticket.status == "filled").order_by(Ticket.filled_at_ms)).scalars().all()
        slips = np.array([r.fill_px - r.intended_px for r in rows if r.fill_px is not None and r.intended_px is not None], dtype=float)
    n = int(slips.size)
    if n == 0:
        return {"n": 0, "note": "No fills yet. Nothing to report."}
    out: dict = {
        "n": n,
        "mean": round(float(slips.mean()), 4),
        "median": round(float(np.median(slips)), 4),
        "p90": round(float(np.percentile(slips, 90)), 4),
        "worst": round(float(slips.max()), 4),
        "test": None,
        "note": "",
    }
    if n < MIN_FILLS_FOR_TEST or n - RECENT_WINDOW < RECENT_WINDOW:
        out["note"] = f"{n} fills. A test needs {MIN_FILLS_FOR_TEST}. No p-value is printed."
        return out
    from scipy import stats

    recent, prior = slips[-RECENT_WINDOW:], slips[:-RECENT_WINDOW]
    t = stats.ttest_ind(recent, prior, equal_var=False)
    out["test"] = {
        "recent_mean": round(float(recent.mean()), 4),
        "prior_mean": round(float(prior.mean()), 4),
        "p": round(float(t.pvalue), 4),
    }
    out["note"] = "Welch test of the last 10 fills against the rest. A p near 0.05 on this few fills is not a finding."
    return out
