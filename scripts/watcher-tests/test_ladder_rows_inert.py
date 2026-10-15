"""deskSeq.rows 'ladder' entries (desk wire.deskSeq.ladder, PR #17) are display-only: the watcher must log them as
shadow:seq:ladder and never let them change a gate, the decision or the size."""
import copy
from watcher import gates
from tests.test_gates import load, broker, NOW, CAL, cfg  # noqa: F401

LADDER_ROWS = [
    {"rule": "ladder", "would": "MNQ LTF flip → long promoted (entry 29681.25, stop 29616.25), short demoted"},
    {"rule": "ladder", "would": "MNQ short target pool 1h swing low 29638.75 was just swept — no grade upgrade on the short side into it (card short band A+)"},
    {"rule": "ladder", "would": "ES card plan long invalid: price 7736 has already crossed the stop 7741.5 — plan invalidated"},
]

def _with_rows(card, rows):
    c = copy.deepcopy(card)
    c["wire"].setdefault("deskSeq", {})["rows"] = rows
    return c

def _hard(g): return [(n, ok) for n, ok, _ in g if not n.startswith("shadow:")]

def test_ladder_rows_never_gate(cfg):
    for fx in ("card_aplus_armed.json", "card_live_watch.json"):
        base = gates.snapshot(load(fx))
        lad = gates.snapshot(_with_rows(load(fx), LADDER_ROWS))
        assert [r["rule"] for r in lad["desk_seq_rows"]] == ["ladder"] * 3
        for b in (broker(), None):
            g0 = gates.evaluate_fire(copy.deepcopy(base), cfg, NOW, {"entries": 0}, b, CAL)
            g1 = gates.evaluate_fire(copy.deepcopy(lad), cfg, NOW, {"entries": 0}, b, CAL)
            assert _hard(g0) == _hard(g1), fx
            assert gates.all_pass(g0) == gates.all_pass(g1)
            rows = [x for x in g1 if x[0] == "shadow:seq:ladder"]
            assert len(rows) == 3 and all(ok is True for _, ok, _ in rows)

def test_ladder_rows_cannot_rescue_a_refused_card(cfg):
    s = gates.snapshot(_with_rows(load("card_live_watch.json"), LADDER_ROWS))
    assert not gates.all_pass(gates.evaluate_fire(s, cfg, NOW, {}, broker(), CAL))
