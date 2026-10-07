"""Millisecond log of a ticket: signal, send, fill, and the slip between the intended price and the fill.

The file is local (brainlab/out/). It is not a gate and it is not the floor's journal.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import Float, Integer, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

ROOT = Path(__file__).resolve().parent
DEFAULT_DB = ROOT / "out" / "fills.sqlite"


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
        row.status = "filled"
        row.fill_px = fill_px
        row.filled_at_ms = filled_at_ms
        slip = fill_px - row.intended_px
        s.commit()
        return slip
