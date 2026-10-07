"""Local audit board. Run: streamlit run brainlab/app.py

Shows Yahoo bars, confirmed swing legs, and notes remembered in Chroma. Does not talk to Robinhood.
"""

from __future__ import annotations

import streamlit as st

from bars import mt5_bars, yahoo_bars
from router import judge
from intake import parse_issue, render
from legs import say
from memory import index_notes, recall, remember

st.set_page_config(page_title="Desk lab", layout="wide")
st.title("Desk lab")
st.caption("Audit only. The floor's price is still the desk. Nothing on this page places a trade.")

src = st.radio("Bars", ["Yahoo", "MetaTrader 5"], horizontal=True)
symbol = st.selectbox("Symbol", ["MNQ", "ES", "NQ"])
if st.button("Read the bars"):
    try:
        if src == "Yahoo":
            frame = yahoo_bars(symbol)
        else:
            ticker = st.session_state.get("mt5") or {"MNQ": "MNQ", "ES": "ES", "NQ": "NQ"}[symbol]
            frame = mt5_bars(ticker)
        st.session_state["frame"] = frame
        st.session_state["line"] = say(symbol, frame)
    except Exception as e:
        st.error(str(e))

frame = st.session_state.get("frame")
if frame is not None:
    st.write(st.session_state.get("line"))
    st.line_chart(frame["close"])
    st.dataframe(frame.tail(12), use_container_width=True)

st.subheader("Memory")
q = st.text_input("Ask the stored notes", placeholder="sweep then inverse")
c1, c2 = st.columns(2)
if c1.button("Index the book"):
    try:
        n = index_notes()
        st.write(f"{n} notes indexed.")
    except Exception as e:
        st.error(str(e))
if c2.button("Search") and q:
    try:
        hits = recall(q)
        if not hits:
            st.write("Nothing stored yet.")
        for h in hits:
            st.markdown(f"**{h['id']}**")
            st.write(h["text"][:500])
    except Exception as e:
        st.error(str(e))

st.subheader("Issue intake")
title = st.text_input("Issue title")
body = st.text_area("Issue body")
if st.button("Parse"):
    st.session_state["parsed"] = parse_issue(title, body)
parsed = st.session_state.get("parsed")
if parsed:
    st.markdown(render(parsed))
    if parsed["symbol"] and st.button("Remember this note"):
        remember(f"issue-{parsed['symbol']}-{parsed['side'] or 'na'}", render(parsed))
        st.write("Stored in the local book. The floor was not told to trade it.")

st.subheader("Quote")
st.caption("Checks the desk's own cuts. The debit is worked out from the ask plus the 2 cent limit, never typed. Robinhood on the desk is the only place an order can go.")
bid = st.number_input("Bid", value=1.95, step=0.01)
ask = st.number_input("Ask", value=1.98, step=0.01)
qty = st.number_input("Contracts", min_value=1, max_value=4, value=1, step=1)
bp = st.number_input("Buying power of the trade account", value=800.0, step=10.0)
if st.button("Judge the quote"):
    calm = [100 + i * 0.02 for i in range(40)]
    st.write(judge({
        "symbol": "QQQ",
        "expiration": "2026-10-08",
        "strike": 500,
        "right": "put",
        "qty": int(qty),
        "buying_power": float(bp),
        "bid": bid,
        "ask": ask,
        "quote_ts_ms": 1_000,
        "now_ms": 1_000,
        "closes": calm,
    }))

st.subheader("Bars audit")
st.caption("Yahoo's 15 minute bars against the bars the desk graded on (src/data/history-4y.json). A gap that is a large share of a bar is a reason to doubt a card built there.")
if st.button("Compare Yahoo with the desk's bars"):
    try:
        from bars import compare_bars, desk_bars

        st.write(compare_bars(yahoo_bars(symbol, period="5d", interval="15m"), desk_bars(symbol)))
    except Exception as e:
        st.error(str(e))

st.subheader("Slippage")
st.caption("Fill minus the limit we meant, per contract. A test needs 20 fills; below that the page prints no p-value.")
try:
    from fills import slippage_report

    st.write(slippage_report())
except Exception as e:
    st.error(str(e))

st.subheader("High-alert ledger")
st.caption("Paste the Brain tab's Copy JSON. Graded cards are stored as notes. Similarity is not evidence and never changes a score.")
ledger = st.text_area("Ledger JSON", height=120)
if st.button("Index the ledger") and ledger.strip():
    try:
        import json
        import tempfile
        from pathlib import Path

        from memory import index_ledger

        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "ledger.json"
            p.write_text(ledger, encoding="utf-8")
            st.write(f"{index_ledger(p)} graded cards indexed.")
    except Exception as e:
        st.error(str(e))
