"""Local audit board. Run: streamlit run brainlab/app.py

Shows Yahoo bars, confirmed swing legs, and notes remembered in Chroma. Does not talk to Robinhood.
"""

from __future__ import annotations

import streamlit as st

from bars import mt5_bars, yahoo_bars
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
