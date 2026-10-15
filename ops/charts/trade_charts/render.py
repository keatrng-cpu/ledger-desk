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
    tf_fvg = {"1m": st.get("fvg1", []), "5m": st.get("fvg5", []), "15m": st.get("fvg15", [])}[tf]
    gs = [g for g in tf_fvg if g["t"] >= a and (inside(g["lo"]) or inside(g["hi"]))]
    keep = sorted(gs, key=lambda g: (g["inverted"] is None and g["filled"] is not None, -g["t"].value))[: (4 if tf == "1m" else 5)]
    for g in keep:
        end = min(b, g["inverted"] or b)
        col = COL["fvg_bull" if g["side"] == "bull" else "fvg_bear"]
        ax.add_patch(Rectangle((md.date2num(g["t"]), g["lo"]), md.date2num(end) - md.date2num(g["t"]), g["hi"] - g["lo"], color=col, alpha=0.16, lw=0, zorder=1))
        zones.append((g["hi"], f"{tf} {g['side']} FVG {g['lo']:.2f}-{g['hi']:.2f}", col))
        if g["inverted"] is not None and g["inverted"] < b:
            ax.add_patch(Rectangle((md.date2num(g["inverted"]), g["lo"]), xb - md.date2num(g["inverted"]), g["hi"] - g["lo"], facecolor="none",
                                   edgecolor=COL["ifvg"], hatch="///", lw=0.6, alpha=0.7, zorder=1))
            zones.append(((g["lo"] + g["hi"]) / 2, f"iFVG ({'bear' if g['side'] == 'bull' else 'bull'}) {_fmt(g['inverted'])}", COL["ifvg"]))
    if tf != "1m":
        for o in [o for o in st.get("obs", []) if o["t"] >= a and (inside(o["lo"]) or inside(o["hi"]))][-3:]:
            col = COL["ob_bull" if o["side"] == "bull" else "ob_bear"]; end = min(b, o["broken"] or b)
            ax.add_patch(Rectangle((md.date2num(o["t"]), o["lo"]), md.date2num(end) - md.date2num(o["t"]), o["hi"] - o["lo"], facecolor="none", edgecolor=col, lw=1.1, ls="-", zorder=1))
            zones.append((o["lo"], f"{o['side']} OB {o['lo']:.2f}-{o['hi']:.2f}", col))
    # swings (small ticks) + equal highs/lows + sweeps
    for s in st.get("swings", []):
        if a <= s["t"] <= b and inside(s["px"]):
            ax.scatter([md.date2num(s["t"] + pd.Timedelta(minutes=TFMIN[tf] / 2))], [s["px"] + (0.012 if s["kind"] == "H" else -0.012) * (yhi - ylo)],
                       marker="v" if s["kind"] == "H" else "^", s=14, color="#757575", zorder=4)
    lines = []
    for p in st.get("pools", []):
        if inside(p["px"]):
            ax.plot([md.date2num(p["t0"]), xb], [p["px"]] * 2, color=COL["pool"], lw=1, ls=(0, (1, 1)), zorder=2)
            lines.append((p["px"], f"{p['kind']} {p['px']:.2f} (liquidity)", COL["pool"]))
    for s in st.get("sweeps", []):
        if a <= s["t"] <= b:
            ax.scatter([md.date2num(s["t"] + pd.Timedelta(minutes=TFMIN[tf] / 2))], [s["px"]], marker="*", s=70, color=COL["sweep"], zorder=6)
    lv = st.get("levels", {})
    for k, col, ls in (("PDH", COL["pd"], "-"), ("PDL", COL["pd"], "-"), ("ONH", COL["on"], "-."), ("ONL", COL["on"], "-."), ("PMH", COL["pm"], ":"), ("PML", COL["pm"], ":")):
        if k in lv and inside(lv[k]):
            ax.axhline(lv[k], color=col, lw=0.9, ls=ls, alpha=0.8, zorder=1); lines.append((lv[k], f"{k} {lv[k]:.2f}", col))
    if rg and inside(rg["eq"]):
        ax.axhline(rg["eq"], color=COL["eq"], lw=0.9, ls="--", zorder=1); lines.append((rg["eq"], f"EQ {rg['eq']:.2f} ({rg['name']})", COL["eq"]))
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
        x = md.date2num(e["t"]); mk = dict(FILL=("^" if tr["side"] == "long" else "v", COL["fill"]), TRIM=("D", COL["trim"]), EXIT=("X", COL["exit"]))[e["what"]]
        if a <= e["t"] <= b:
            ax.scatter([x], [e["px"]], marker=mk[0], s=110 if detail else 80, color=mk[1], edgecolor="white", lw=0.8, zorder=8)
            ax.annotate(str(i), (x, e["px"]), xytext=(6, -12 if e["what"] == "EXIT" else 8), textcoords="offset points", fontsize=9, weight="bold", color=mk[1], zorder=9)
        nums.append((i, e))
    ax.axvline(xin, color=COL["entry"], lw=0.6, alpha=0.4, zorder=0)
    # right-margin labels, de-overlapped
    tr_ = blend(ax.transAxes, ax.transData)
    labs = [l for l in lines + zones if inside(l[0])]
    pri = lambda l: (0 if l[1].split()[0] in ("entry", "stop", "T1", "T2") else 1 if l[1][:2] in ("PD", "ON", "PM", "EQ") and "liquidity" not in l[1]
                     else 2 if "iFVG" in l[1] or "liquidity" in l[1] else 3, abs(l[0] - tr["fill_px"]))
    labs = sorted(labs, key=pri)[:14]
    gap = min((yhi - ylo) * 0.036, (yhi - ylo) * 0.96 / max(1, len(labs)))
    for y, text, col in _spread(labs, gap):
        ax.text(1.006, y, text, transform=tr_, fontsize=7.4, color=col, va="center", clip_on=False)
    span = (b - a).total_seconds() / 60
    step = next(x for x in (5, 10, 15, 30, 60, 120, 180, 240, 360) if span / x <= 10)
    ax.xaxis.set_major_locator(md.MinuteLocator(byminute=range(0, 60, step), tz=CT) if step < 60 else md.HourLocator(byhour=range(0, 24, step // 60), tz=CT))
    ax.xaxis.set_major_formatter(md.DateFormatter("%H:%M" if span < 1200 else "%m/%d %H:%M", tz=CT)); ax.grid(alpha=0.15); ax.tick_params(labelsize=8)
    ax.set_title(f"{tr['symbol']} {tf}  ·  {_fmt(a)}–{_fmt(b)} CT", fontsize=9, loc="left", color="#424242")
    return nums

def legend_text(tr, st, f):
    v = tr.get("verdicts") or {}; g = tr.get("gates") or {}; desk = v.get("desk") or {}
    R = tr.get("R"); res = "WIN" if (R or 0) > 0 else "LOSS" if (R or 0) < 0 else "FLAT"
    L = [f"{res}  {R:+.2f}R" if R is not None else res, f"$ {tr['pnl_usd']:+,.0f}" if tr.get("pnl_usd") is not None else "", ""]
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
    panels = pick_panels(tr)
    fig = plt.figure(figsize=(17, 4.6 * len(panels) + 0.8))
    gsp = fig.add_gridspec(len(panels), 2, width_ratios=[4.6, 1.15], wspace=0.30, hspace=0.32, left=0.045, right=0.985, top=0.9, bottom=0.06)
    nums = []
    for i, (tf, a, b) in enumerate(panels):
        ax = fig.add_subplot(gsp[i, 0]); n = draw_panel(ax, fr, st, tr, tf, a, b, detail=(i == len(panels) - 1)); nums = n or nums
    lax = fig.add_subplot(gsp[:, 1]); lax.axis("off")
    ev = ["EVENTS (CT)"]
    for i, e in nums:
        extra = f" opt {e['opt_px']:.2f}" if e.get("opt_px") is not None else ""
        why = f"\n     {e['why'][:34]}" if e.get("why") else ""
        ev.append(f" {i} {e['what']:<4} {pd.Timestamp(e['t']).tz_convert(CT):%H:%M:%S} {e['px']:.2f}" + (f" x{e['qty']:g}" if isinstance(e.get('qty'), (int, float)) else "") + extra + why)
    lax.text(0, 1, legend_text(tr, st, f) + "\n\n" + "\n".join(ev), va="top", ha="left", family="DejaVu Sans Mono", fontsize=8.1, transform=lax.transAxes)
    key = ("■ FVG bull/bear   ▨ iFVG   □ OB\n★ sweep   ▲▼ swing   ··· EQH/EQL\n"
           "shade: red=premium green=discount\n-- PDH/PDL  -. ON H/L  : PM H/L")
    lax.text(0, 0.0, key, va="bottom", ha="left", fontsize=7.4, color="#616161", transform=lax.transAxes)
    o = tr.get("option"); opt = f"  ·  {o['n']}x {o['underlier']} {o['exp']} {o['strike']:g}{o['cp']} filled {tr.get('opt_fill')}" if o else ""
    R = tr.get("R")
    title = (f"{tr['symbol']} {tr['side'].upper()} {tr.get('band') or ''}  ·  {tr['signal']}  ·  {tr['source']}  ·  "
             f"fill {_fmt(tr['fill_t'])} {tr['fill_px']:.2f} → exit {_fmt(tr['exit_t'])} {tr['exit_px']:.2f}  ·  "
             + (f"{R:+.2f}R" if R is not None else "R n/a") + opt)
    fig.suptitle(title, fontsize=11.5, x=0.045, ha="left", weight="bold", color=UP if (R or 0) > 0 else DN)
    fig.text(0.045, 0.925, f"{tr['fill_t']:%a %Y-%m-%d} CT  ·  entry {tr.get('entry')} stop {tr.get('stop')} T1 {tr.get('t1')} T2 {tr.get('t2')}  ·  bars: {'+'.join(st.get('bar_sources', []))}",
             fontsize=8.5, color="#616161")
    fig.savefig(out_png, dpi=110); plt.close(fig)
    return out_png
