"""The order schema. A bad quote, a wide spread, a debit outside the envelope, or a noisy print never becomes an order.

Numbers are the desk's, not new ones:
  spread 0.15 and the 2 cent marketable limit — src/lib/room/exec/limits.ts
  debit $150 to $550 — src/lib/execution/rh-autofire-gates.ts
  a last-print |z| of 2 or more is the desk's own measurement cut, applied to the tape
"""

from __future__ import annotations

from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator
from scipy import stats

MAX_SPREAD_FRAC = 0.15
ENTRY_SLIP_USD = 0.02
MIN_DEBIT = 150.0
MAX_DEBIT = 550.0
MAX_QUOTE_AGE_MS = 15_000
NOISE_Z = 2.0


def noise_z(closes: list[float] | np.ndarray) -> float:
    """|z| of the last return against the ones before it. Too few prints, or a flat window, is not a pass."""
    px = np.asarray(closes, dtype=float)
    if px.size < 9 or np.any(px <= 0):
        return float("inf")
    rets = np.diff(np.log(px))
    if rets.size < 8 or not np.all(np.isfinite(rets)):
        return float("inf")
    prior = rets[:-1]
    scored = stats.zscore(prior, ddof=1)
    if not np.all(np.isfinite(scored)):
        return float("inf")
    sigma = float(np.std(prior, ddof=1))
    if sigma == 0:
        return float("inf")
    return float((rets[-1] - float(np.mean(prior))) / sigma)


class OrderIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    expiration: str
    strike: float = Field(gt=0)
    right: Literal["call", "put"]
    qty: int = Field(ge=1)
    debit: float = Field(gt=0)
    buying_power: float = Field(ge=0)
    bid: float
    ask: float
    quote_ts_ms: int
    now_ms: int
    closes: list[float]

    @model_validator(mode="after")
    def desk_gates(self) -> "OrderIntent":
        if self.bid <= 0 or self.ask <= 0 or self.bid > self.ask:
            raise ValueError("bad_quote")
        mid = (self.bid + self.ask) / 2
        if (self.ask - self.bid) / mid > MAX_SPREAD_FRAC:
            raise ValueError("wide_spread")
        if self.now_ms - self.quote_ts_ms > MAX_QUOTE_AGE_MS:
            raise ValueError("stale_quote")
        if self.debit < MIN_DEBIT:
            raise ValueError("debit_floor")
        if self.debit > MAX_DEBIT:
            raise ValueError("debit_cap")
        if self.debit > self.buying_power:
            raise ValueError("buying_power")
        z = noise_z(self.closes)
        if abs(z) >= NOISE_Z:
            raise ValueError("noise")
        return self

    @property
    def limit_px(self) -> float:
        """Ask plus the desk's 2 cents. A marketable limit, not a market order."""
        return round(self.ask + ENTRY_SLIP_USD, 2)
