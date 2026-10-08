"""Write a research note from a measured desk snapshot.

This is not a crew and it is not an execution path. PATH, the entry, the
stop, and T1 are numbers the caller already computed. The note never sends.
A print the desk would not fill is not written up as an entry.

The PATH floor, the quote-age cut, and the discretion clamp are copies of
the desk. scripts/verify-research-retain.mjs fails if they drift.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict

PATH_FLOOR = 0.65
QUOTE_MAX_LAG_SEC = 120
FACTOR_FLOOR = 0.6
FACTOR_CEILING = 1.15


class ResearchFacts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: str
    symbol: str
    side: str
    confluence: float
    path_band: str = "—"
    smc_word: str = "—"
    smc_missing: str = ""
    retrace: str = "none"
    entry: float | None = None
    stop: float | None = None
    t1: float | None = None
    draw: str | None = None
    quote_source: str
    quote_lag_sec: float
    quote_price: float
    discretion_mult: float | None = None
    discretion_verdict: str | None = None


def _px(n: float) -> str:
    return f"{n:.2f}"


def _discretion(mult: float | None, verdict: str | None) -> str:
    if mult is None:
        return "Discretion has no measured sample, so size stays ×1.00. It is not a veto."
    clamped = min(FACTOR_CEILING, max(FACTOR_FLOOR, mult))
    word = (verdict or "").strip() or "measured"
    return (
        f"Discretion is {word}, size ×{clamped:.2f} "
        f"(clamped {FACTOR_FLOOR:.2f}–{FACTOR_CEILING:.2f}). "
        "It does not veto and it does not change the floor."
    )


def classify(raw: dict) -> dict:
    """The same branches as src/lib/trading/research-retain.ts. `sent` is always false."""
    f = ResearchFacts.model_validate(raw)
    key = "|".join(
        [
            f.day,
            f.symbol,
            f.side,
            f.path_band or "—",
            f.smc_word,
            f.retrace,
            f.quote_source,
            "none" if f.discretion_mult is None else f"{f.discretion_mult:.2f}",
        ]
    )
    title = f"Research {f.symbol} {f.side}"

    def stand(summary: str) -> dict:
        return {"status": "stand", "sent": False, "key": f"{key}|stand", "title": title, "summary": summary}

    lag = f.quote_lag_sec
    print_ok = (
        f.quote_source not in ("synthetic", "")
        and f.quote_price > 0
        and lag <= QUOTE_MAX_LAG_SEC
    )
    if not print_ok:
        shown = "—" if lag != lag else str(round(lag))  # NaN is not equal to itself
        return stand(
            f"No entry. The print is {f.quote_source or 'missing'} {shown}s. Research does not invent a fill."
        )
    if not (f.confluence >= PATH_FLOOR):
        return stand(
            f"{f.symbol} {f.side} PATH {f.confluence:.2f} is under {PATH_FLOOR:.2f}. "
            "Kept as research. No entry and no exit to manage."
        )
    if f.smc_word != "TAKE":
        return stand(
            f"{f.symbol} {f.side} SMC {f.smc_word or '—'}. "
            f"Missing: {f.smc_missing or 'the sequence'}. The entry is not confirmed."
        )
    priced = (
        f.entry is not None
        and f.stop is not None
        and f.t1 is not None
        and f.entry > 0
        and f.stop > 0
        and f.t1 > 0
    )
    if not priced:
        return stand(f"{f.symbol} {f.side} is TAKE and the plan has no entry, stop, and T1. Nothing to manage.")
    draw = f" ({f.draw})" if f.draw else ""
    disc = _discretion(f.discretion_mult, f.discretion_verdict)
    levels = f"Entry {_px(f.entry)}. Stop {_px(f.stop)}. First exit {_px(f.t1)}{draw}."
    if f.retrace != "pass":
        return stand(
            f"{f.symbol} {f.side} is armed. {levels} The touch has not printed, so this is not a fill. "
            f"{disc} Quote {f.quote_source} {round(lag)}s."
        )
    return {
        "status": "note",
        "sent": False,
        "key": f"{key}|note",
        "title": title,
        "summary": (
            f"{f.symbol} {f.side} {f.path_band or '—'} PATH {f.confluence:.2f}. {levels} {disc} "
            f"Quote {f.quote_source} {round(lag)}s. The desk places. This note does not."
        ),
    }


def write_note(raw: dict, folder: Path) -> dict:
    """Markdown into `folder`. The return is the classification plus the path. Still not an order."""
    note = classify(raw)
    folder.mkdir(parents=True, exist_ok=True)
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in note["key"])[:120]
    path = folder / f"{safe}.md"
    body = (
        "---\n"
        "type: research-note\n"
        f"status: {note['status']}\n"
        "sent: false\n"
        "tags: [research, entry, exit, discretion]\n"
        "---\n"
        f"# {note['title']}\n\n"
        f"{note['summary']}\n\n"
        "The desk places. This note does not.\n"
    )
    path.write_text(body, encoding="utf-8")
    return {**note, "path": str(path)}


def main() -> None:
    import sys

    raw = json.load(sys.stdin)
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("graphify-out/obsidian/brain")
    print(json.dumps(write_note(raw, folder)))
