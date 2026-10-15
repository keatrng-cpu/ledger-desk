"""Matplotlib renderer, styled after audits/postmortem-1302/es_5m.png (TradingView-ish candles, translucent zones,
dashed plan lines) but with labels pushed into a right margin and de-overlapped, a compact legend column, CT times."""
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt, matplotlib.dates as md
from matplotlib.patches import Rectangle
from matplotlib.transforms import blended_transform_factory as blend

CT = "America/Chicago"
UP, DN = "#26a69a", "#ef5350"
COL = dict(fvg_bull="#2e7d32", fvg_bear="#c62828", ifvg="#7b1fa2", ob_bull="#1565c0", ob_bear="#ef6c00",
           entry="#1e88e5", stop="#d32f2f", t1="#2e7d32", t2="#1b5e20", fill="#0d47a1", exit="#000000", trim="#f9a825",
           pd="#455a64", on="#6d4c41", pm="#8d6e63", eq="#9e9e9e", pool="#5d4037", sweep="#ad1457")
EVCOL = dict(FILL=COL["fill"], TRIM=COL["trim"], EXIT=COL["exit"])
MAX_LABELS = 9
TFMIN = {"1m": 1, "5m": 5, "15m": 15}

def pick_panels(tr):
    t0, t1 = tr["fill_t"], tr["exit_t"] or tr["fill_t"]; dur = (t1 - t0).total_seconds() / 60
    if dur <= 45: return [("5m", t0 - pd.Timedelta(minutes=150), t1 + pd.Timedelta(minutes=20)), ("1m", t0 - pd.Timedelta(minutes=30), t1 + pd.Timedelta(minutes=10))]
    if dur <= 240: return [("15m", t0 - pd.Timedelta(hours=8), t1 + pd.Timedelta(minutes=60)), ("5m", t0 - pd.Timedelta(minutes=60), t1 + pd.Timedelta(minutes=20))]
    return [("15m", t0 - pd.Timedelta(hours=3), t1 + pd.Timedelta(minutes=60)), ("5m", t0 - pd.Timedelta(minutes=60), t0 + pd.Timedelta(minutes=90))]

def _candles(ax, b, tf):
    w = tf / 1440 * 0.7
    for t, r in b.iterrows():
        c = UP if r.close >= r.open else DN; x = md.date2num(t + pd.Timedelta(minutes=tf / 2))
        ax.plot([x, x], [r.low, r.high], color=c, lw=0.8, zorder=2)
        ax.add_patch(Rectangle((x - w / 2, min(r.open, r.close)), w, max(abs(r.close - r.open), 1e-9), color=c, zorder=3, lw=0))

def _spread(items, gap):
    """items: [(y, text, color)] -> same with y nudged so neighbours are >= gap apart (keeps order)."""
    items = sorted(items, key=lambda x: x[0]); out = []
    for y, t, c in items:
        if out and y - out[-1][0] < gap: y = out[-1][0] + gap
        out.append((y, t, c))
    # re-centre so the stack doesn't drift upward
    if out:
        shift = (sum(i[0] for i in items) - sum(o[0] for o in out)) / len(out)
        out = [(y + shift, t, c) for y, t, c in out]
        for i in range(1, len(out)):
            if out[i][0] - out[i - 1][0] < gap: out[i] = (out[i - 1][0] + gap, out[i][1], out[i][2])
    return out

def is_live(tr): return str(tr.get("source") or "").startswith("live")

def inside_any(z, inside): return inside(z['lo']) or inside(z['hi'])

def _fmt(t): return pd.Timestamp(t).tz_convert(CT).strftime("%H:%M")

def draw_panel(ax, fr, st, tr, tf, a, b, detail):
    bars = fr[tf][(fr[tf].index >= a) & (fr[tf].index <= b)]
    if not len(bars): ax.text(0.5, 0.5, f"no {tf} bars", transform=ax.transAxes, ha="center"); return
    plan = [tr.get(k) for k in ("entry", "stop", "t1", "fill_px", "exit_px") if tr.get(k)]
    lo = min(bars.low.min(), *plan); hi = max(bars.high.max(), *plan)
    t2 = tr.get("t2")
    if t2 and abs(t2 - tr["fill_px"]) < 1.6 * (hi - lo): lo, hi = min(lo, t2), max(hi, t2)
    pad = (hi - lo) * 0.06; ylo, yhi = lo - pad, hi + pad; xa, xb = md.date2num(a), md.date2num(b)
    ax.set_xlim(xa, xb); ax.set_ylim(ylo, yhi)
    inside = lambda y: ylo <= y <= yhi
    # premium / discount shading of the dealing range
    rg = st.get("range")
    if rg:
        ax.axhspan(max(rg["eq"], ylo), min(rg["hi"], yhi), color=DN, alpha=0.045, zorder=0, lw=0)
        ax.axhspan(max(rg["lo"], ylo), min(rg["eq"], yhi), color=UP, alpha=0.045, zorder=0, lw=0)
    _candles(ax, bars, TFMIN[tf])
    zones = []
    # only the structure that matters to THIS trade: the entry FVG / OB and the iFVGs against it
    ez, eo = st.get("entry_zone"), st.get("entry_ob")
    if ez and inside_any(ez, inside):
        col = COL["fvg_bull" if ez["side"] == "bull" else "fvg_bear"]; end = min(b, ez["inverted"] or b)
        ax.add_patch(Rectangle((md.date2num(max(a, ez["t"])), ez["lo"]), md.date2num(end) - md.date2num(max(a, ez["t"])), ez["hi"] - ez["lo"], color=col, alpha=0.18, lw=0, zorder=1))
        zones.append((ez["hi"], f"entry FVG {ez['lo']:.2f}-{ez['hi']:.2f}", col))
    if eo and inside_any(eo, inside):
        col = COL["ob_bull" if eo["side"] == "bull" else "ob_bear"]; end = min(b, eo["broken"] or b)
        ax.add_patch(Rectangle((md.date2num(max(a, eo["t"])), eo["lo"]), md.date2num(end) - md.date2num(max(a, eo["t"])), eo["hi"] - eo["lo"], facecolor="none", edgecolor=col, lw=1.4, zorder=1))
        zones.append((eo["lo"], f"entry OB {eo['lo']:.2f}-{eo['hi']:.2f}", col))
    seen = set()
    for g in list(st.get("ifvg_against", [])) + list(st.get("ifvg_after", [])):
        key = (g["lo"], g["hi"], str(g["inverted"]))
        tc = g.get("inv_close", g["inverted"])
        if key in seen or g["inverted"] is None or not inside_any(g, inside) or tc is None or tc > b or len(seen) >= 3: continue
        seen.add(key); x0 = md.date2num(max(a, g["inverted"]))
        ax.add_patch(Rectangle((x0, g["lo"]), xb - x0, g["hi"] - g["lo"], facecolor=COL["ifvg"], edgecolor=COL["ifvg"], hatch="///", alpha=0.18, lw=0.8, zorder=1))
        zones.append(((g["lo"] + g["hi"]) / 2, f"iFVG {g['lo']:.2f}-{g['hi']:.2f} @{_fmt(tc)}", COL["ifvg"]))
    lines = []
    swept = st.get("levels_swept", {})
    def level(y, name, col, ls, x0, sw):
        is_sw = sw is not None and sw <= b
        if is_sw:   # swept: dim + dashed after the sweep, labelled with the CT time
            xs = md.date2num(sw)
            if xs > x0: ax.plot([x0, min(xs, xb)], [y, y], color=col, lw=1.1, ls=ls, alpha=0.8, zorder=2)
            ax.plot([max(x0, xs), xb], [y, y], color=col, lw=0.9, ls=(0, (4, 3)), alpha=0.35, zorder=2)
            if a <= sw: ax.scatter([xs + TFMIN[tf] / 2880], [y], marker="*", s=90, color=COL["sweep"], zorder=6)
            lines.append((y, f"{name} {y:.2f} swept {_fmt(sw)} CT", COL["sweep"]))
        else:       # resting: drawn faint, not labelled (doesn't matter to the trade until it's taken)
            ax.plot([x0, xb], [y, y], color=col, lw=0.7, ls=ls, alpha=0.35, zorder=1)
    for p in st.get("pools", []):
        if inside(p["px"]): level(p["px"], f"{p['kind']} (liquidity)", COL["pool"], (0, (1, 1)), max(xa, md.date2num(p["t0"])), p.get("swept"))
    lv = st.get("levels", {})
    for k, col, ls in (("PDH", COL["pd"], "-"), ("PDL", COL["pd"], "-"), ("ONH", COL["on"], "-."), ("ONL", COL["on"], "-."), ("PMH", COL["pm"], ":"), ("PML", COL["pm"], ":")):
        if k in lv and inside(lv[k]): level(lv[k], k, col, ls, xa, swept.get(k))
    if rg and inside(rg["eq"]):
        ax.axhline(rg["eq"], color=COL["eq"], lw=1.0, ls="--", zorder=1); lines.append((rg["eq"], f"EQ {rg['eq']:.2f}", COL["eq"]))
    # the plan
    t_in = tr["fill_t"]; xin = md.date2num(t_in)
    for k, col, name in (("entry", COL["entry"], "entry"), ("stop", COL["stop"], "stop"), ("t1", COL["t1"], "T1"), ("t2", COL["t2"], "T2")):
        y = tr.get(k)
        if y and inside(y):
            ax.plot([xin - (xb - xa) * 0.04, xb], [y, y], color=col, lw=1.4 if k != "entry" else 1.1, ls="--", zorder=5)
            lines.append((y, f"{name} {y:.2f}", col))
    # events
    nums = []
    for i, e in enumerate([e for e in tr["events"] if e.get("px") is not None and e["what"] in ("FILL", "TRIM", "EXIT")], 1):
        x = md.date2num(e["t"]); col = EVCOL[e["what"]]
        if a <= e["t"] <= b:
            ax.scatter([x], [e["px"]], marker="o", s=300 if detail else 230, color=col, edgecolor="white", lw=1.2, zorder=8)
            ax.annotate(str(i), (x, e["px"]), ha="center", va="center", fontsize=10, weight="bold", color="white", zorder=9)
        nums.append((i, e))
    ax.axvline(xin, color=COL["entry"], lw=0.6, alpha=0.4, zorder=0)
    # right-margin labels, de-overlapped
    tr_ = blend(ax.transAxes, ax.transData)
    labs = [l for l in lines + zones if inside(l[0])]
    pri = lambda l: (0 if l[1].split()[0] in ("entry", "stop", "T1", "T2") else 1 if "swept" in l[1] or "iFVG" in l[1] or l[1].startswith("entry ") else 2, abs(l[0] - tr["fill_px"]))
    labs = sorted(labs, key=pri)[:MAX_LABELS]
    gap = min((yhi - ylo) * 0.055, (yhi - ylo) * 0.96 / max(1, len(labs)))
    for y, text, col in _spread(labs, gap):
        ax.text(1.006, y, text, transform=tr_, fontsize=10, color=col, va="center", clip_on=False, weight="bold")
    span = (b - a).total_seconds() / 60
    step = next(x for x in (5, 10, 15, 30, 60, 120, 180, 240, 360) if span / x <= 10)
    ax.xaxis.set_major_locator(md.MinuteLocator(byminute=range(0, 60, step), tz=CT) if step < 60 else md.HourLocator(byhour=range(0, 24, step // 60), tz=CT))
    ax.xaxis.set_major_formatter(md.DateFormatter("%H:%M" if span < 1200 else "%m/%d %H:%M", tz=CT)); ax.grid(alpha=0.15); ax.tick_params(labelsize=10)
    ax.set_title(f"{tr['symbol']} {tf}  ·  {_fmt(a)}–{_fmt(b)} CT", fontsize=11, loc="left", color="#424242")
    return nums

def legend_text(tr, st, f):
    v = tr.get("verdicts") or {}; g = tr.get("gates") or {}; desk = v.get("desk") or {}
    R = tr.get("R"); res = "WIN" if (R or 0) > 0 else "LOSS" if (R or 0) < 0 else "FLAT"
    usd = tr.get("pnl_usd")   # live account dollars are never drawn (charts are published); paper is labelled as such
    L = [f"{res}  {R:+.2f}R" if R is not None else res, f"paper $ {usd:+,.0f}" if usd is not None and not is_live(tr) else "", ""]
    L += ["VERDICTS", f" desk  {desk.get('band') or desk.get('card_band') or tr.get('band') or '-'} q={desk.get('q') or tr.get('q') or '-'}"
          + (" actionable" if desk.get("actionable") else ""), f" brain {v.get('brain') or '-'}", f" Floor {v.get('floor') or '-'}", ""]
    lb, sb, hb = g.get("live_block") or [], g.get("soft_block") or [], g.get("shadow_block") or []
    import textwrap
    L += ["DECISIVE GATES"] + textwrap.wrap("live-block: " + (", ".join(lb) if lb else "none"), 40, initial_indent=" ", subsequent_indent="   ")[:3]
    s = ", ".join(x.replace("soft:", "") for x in sb) or "none"
    L += textwrap.wrap("soft: " + s, 40, initial_indent=" ", subsequent_indent="   ")[:4]
    if hb: L += textwrap.wrap("shadow: " + ", ".join(x.replace("shadow:", "") for x in hb), 40, initial_indent=" ", subsequent_indent="   ")[:2]
    h = st.get("htf", {}); card = h.get("card") or {}
    L += ["", "HTF BIAS", f" calc 1h {h.get('h1')} · 4h {h.get('h4')}"] + ([f" card 1h {card.get('h1')} · 4h {card.get('h4')}"] if card else [])
    if f.get("data_ok"):
        yn = lambda x: "yes" if x else "no"
        L += ["", "AT ENTRY", f" phase {f['session_phase']}", f" premium {f['premium_pct']}% of {f['range_name']}" + ("  (wrong half)" if f.get("wrong_half") else ""),
              f" iFVG against {yn(f['ifvg_against'])} · sweep first {yn(f['sweep_with_before'])}",
              f" in FVG {yn(f['in_with_fvg'])} · in OB {yn(f['in_with_ob'])}",
              f" displacement {f['displacement_atr']}×ATR5", f" R:R from fill {f['rr_from_fill']} · stop {f['stop_atr5']}×ATR5",
              f" MFE {f['mfe_R']}R · MAE {f['mae_R']}R"]
    return "\n".join(L)

def render(tr, fr, st, f, out_png):
    from .analyze import summary
    import textwrap, os
    panels = pick_panels(tr)
    fig = plt.figure(figsize=(19, 5.0 * len(panels) + 2.0))
    top = 1 - 1.9 / (5.0 * len(panels) + 2.0)
    gsp = fig.add_gridspec(len(panels), 2, width_ratios=[4.0, 1.4], wspace=0.62, hspace=0.30, left=0.045, right=0.985, top=top, bottom=0.05)
    nums = []
    for i, (tf, a, b) in enumerate(panels):
        ax = fig.add_subplot(gsp[i, 0]); n = draw_panel(ax, fr, st, tr, tf, a, b, detail=(i == len(panels) - 1)); nums = n or nums
    lax = fig.add_subplot(gsp[:, 1]); lax.axis("off")
    ev = ["EVENTS (CT)"]
    for i, e in nums:
        why = f"  {e['why'][:24]}" if e.get("why") else ""
        ev.append(f" ({i}) {e['what']:<4} {pd.Timestamp(e['t']).tz_convert(CT):%H:%M:%S} {e['px']:.2f}" + why)
    lax.text(0, 1, legend_text(tr, st, f), va="top", ha="left", family="DejaVu Sans Mono", fontsize=9.6, transform=lax.transAxes)
    y = 0.30
    for line in ev:
        col = "#212121"
        for k, c in EVCOL.items():
            if f" {k}" in line: col = c
        lax.text(0, y, line, va="top", ha="left", family="DejaVu Sans Mono", fontsize=10, color=col, weight="bold", transform=lax.transAxes); y -= 0.035
    key = [("entry / fill", COL["entry"]), ("stop", COL["stop"]), ("targets T1/T2", COL["t1"]), ("swept liquidity ★ (dim dashed)", COL["sweep"]),
           ("iFVG (hatched)", COL["ifvg"]), ("entry FVG / OB", COL["fvg_bull"]), ("EQ (0.25 tick)", COL["eq"])]
    for j, (txt, c) in enumerate(key):
        lax.text(0, 0.0 + 0.032 * (len(key) - 1 - j), "■ " + txt, va="bottom", ha="left", fontsize=10, color=c, transform=lax.transAxes)
    R = tr.get("R")
    title = (f"{tr['symbol']} {tr['side'].upper()} {tr.get('band') or ''}  ·  {tr['signal']}  ·  {tr['source']}  ·  "
             f"fill {_fmt(tr['fill_t'])} {tr['fill_px']:.2f} → exit {_fmt(tr['exit_t'])} {tr['exit_px']:.2f} CT  ·  "
             + (f"{R:+.2f}R" if R is not None else "R n/a"))   # R only: no option contract / option fill
    fig.suptitle(title, fontsize=14, x=0.045, y=0.995, ha="left", va="top", weight="bold", color=UP if (R or 0) > 0 else DN)
    summ = summary(tr, st, f)
    fig.text(0.045, 1 - 0.75 / (5.0 * len(panels) + 2.0), "\n".join(textwrap.wrap(summ, 150)), fontsize=12.5, va="top", ha="left", color="#212121",
             bbox=dict(boxstyle="round,pad=0.5", facecolor="#fff8e1", edgecolor="#f9a825"))
    tmp = out_png[:-4] + ".tmp.png"
    fig.savefig(tmp, dpi=100); plt.close(fig); os.replace(tmp, out_png)   # atomic: readers never see a half PNG
    return out_png
