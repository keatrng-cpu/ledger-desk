"""Structure + features at entry for one normalised trade record."""
import math
import pandas as pd
from . import bars as B, smc

CT = "America/Chicago"

def _iso(x):
    if isinstance(x, pd.Timestamp): return x.tz_convert(CT).isoformat()
    if isinstance(x, dict): return {k: _iso(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)): return [_iso(v) for v in x]
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)): return None
    return x

def window(tr):
    t0 = tr["fill_t"]; t1 = tr["exit_t"] or t0
    return t0, t1

def analyze(tr, sources=None):
    """Return (frames, structure, features). frames: {'1m','5m','15m','1h','4h'} CT frames over the context window."""
    t_in, t_out = window(tr); side = tr["side"]; L = side == "long"; d = 1 if L else -1
    m1, used = B.load_1m(tr["symbol"], t_in - pd.Timedelta(days=6), t_out + pd.Timedelta(minutes=45), sources)
    fr = {"1m": m1, "5m": B.resample(m1, "5min"), "15m": B.resample(m1, "15min"), "1h": B.resample(m1, "1h")}
    fr["4h"] = m1.resample("4h", offset="1h").agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna() if len(m1) else m1
    st = dict(bar_sources=used, symbol=tr["symbol"])
    if len(m1) < 30:
        return fr, st, dict(data_ok=False)
    c5 = smc.closed(fr["5m"], t_in, 5); c1 = smc.closed(m1, t_in, 1); c15 = smc.closed(fr["15m"], t_in, 15)
    a5 = smc.atr(c5); a1 = smc.atr(c1); look = t_in - pd.Timedelta(hours=4)
    tol = max(0.25, 0.1 * a5)
    sw5 = [s for s in smc.swings(c5[c5.index >= t_in - pd.Timedelta(hours=8)]) if s["confirmed"] <= t_in]
    pools = []
    for p in sorted(smc.equal_levels(sw5, tol), key=lambda p: -p["n"]):      # merge near-duplicate pools
        if not any(q["kind"] == p["kind"] and abs(q["px"] - p["px"]) <= 2 * tol for q in pools): pools.append(p)
    fp = tr["fill_px"]
    pools = sorted([p for p in pools if p["px"] >= fp], key=lambda p: p["px"] - fp)[:2] + sorted([p for p in pools if p["px"] < fp], key=lambda p: fp - p["px"])[:2]
    # FVGs over the context window, evaluated on ALL bars (for drawing), then re-evaluated as-of entry for features
    ctx5 = fr["5m"][fr["5m"].index >= look]
    g5_all = smc.fvgs(ctx5, 0.15 * a5); g1_all = smc.fvgs(m1[m1.index >= t_in - pd.Timedelta(minutes=90)], 0.15 * a1)
    g15_all = smc.fvgs(fr["15m"][fr["15m"].index >= look - pd.Timedelta(hours=4)], 0.15 * smc.atr(c15))
    asof = lambda gs, tf: [dict(g, inverted=g["inverted"] if g["inverted"] is not None and g["inverted"] + pd.Timedelta(minutes=tf) <= t_in else None)
                           for g in gs if g["formed"] + pd.Timedelta(minutes=tf) <= t_in]
    g5, g1, g15 = asof(g5_all, 5), asof(g1_all, 1), asof(g15_all, 15)
    obs_all = smc.order_blocks(ctx5, a5); obs = [o for o in obs_all if o["disp_t"] + pd.Timedelta(minutes=5) <= t_in]
    lv = smc.session_levels(m1, t_in); rng = smc.dealing_range(lv, t_in)
    named = [dict(kind="H" if k.endswith("H") else "L", px=v, t=None, name=k) for k, v in lv.items() if not k.startswith("RTH")]
    sw_lv = [dict(kind=s["kind"], px=s["px"], t=s["confirmed"], name=f"swing {s['kind']}") for s in sw5[-8:]]
    sweeps = [s for s in smc.sweeps(c5[c5.index >= look], named + sw_lv + [dict(p, t=p["t1"], name=p["kind"]) for p in pools]) if s["t"] + pd.Timedelta(minutes=5) <= t_in]
    sweeps_1h = [s for s in sweeps if s["t"] >= t_in - pd.Timedelta(minutes=60)]
    fill = tr["fill_px"]; stop = tr["stop"]; risk = abs(fill - stop) if fill and stop else None
    near = lambda g: min(abs(fill - g["lo"]), abs(fill - g["hi"])) <= a5 or g["lo"] <= fill <= g["hi"]
    against_inv = "bull" if not L else "bear"     # a bull FVG inverted is bearish (against a long)
    recent = lambda g: g["inverted"] is not None and g["inverted"] >= t_in - pd.Timedelta(minutes=90)
    ifvg_ag = [g for g in g5 + g1 if g["side"] == against_inv and recent(g) and near(g)]
    ifvg_with = [g for g in g5 + g1 if g["side"] != against_inv and recent(g) and near(g)]
    with_side = "bull" if L else "bear"
    in_fvg = [g for g in g5 + g15 if g["side"] == with_side and g["inverted"] is None and g["lo"] - 0.25 * a5 <= fill <= g["hi"] + 0.25 * a5]
    in_ob = [o for o in obs if o["side"] == with_side and o["broken"] is None and o["lo"] - 0.25 * a5 <= fill <= o["hi"] + 0.25 * a5]
    h1, h4 = smc.bias(smc.closed(fr["1h"], t_in, 60).tail(60)), smc.bias(smc.closed(fr["4h"], t_in, 240).tail(40))
    want = "bull" if L else "bear"; prem = None
    if rng: prem = round(100 * (fill - rng["lo"]) / (rng["hi"] - rng["lo"]), 1)
    # outcome path stats (hindsight; NOT entry features)
    path = m1[(m1.index >= t_in.floor("1min")) & (m1.index <= t_out)]
    mfe = mae = None
    if risk and len(path):
        mfe = round(max(0.0, d * ((path.high.max() if L else path.low.min()) - fill)) / risk, 2)
        mae = round(min(0.0, d * ((path.low.min() if L else path.high.max()) - fill)) / risk, 2)
    t1_hit = bool(tr.get("t1") and len(path) and ((path.high.max() >= tr["t1"]) if L else (path.low.min() <= tr["t1"])))
    inv_after = [g for g in g5_all + g1_all if g["side"] == against_inv and g["inverted"] is not None and t_in <= g["inverted"] <= t_out + pd.Timedelta(minutes=5) and near(g)]
    v = tr.get("verdicts") or {}; gt = tr.get("gates") or {}; desk = v.get("desk") or {}
    ch = v.get("card_htf") or {}
    pools_side = [p for p in pools if (p["kind"] == "EQH" and L and p["px"] > fill) or (p["kind"] == "EQL" and not L and p["px"] < fill)]
    pools_under = [p for p in pools if (p["kind"] == "EQL" and L and p["px"] < fill) or (p["kind"] == "EQH" and not L and p["px"] > fill)]
    f = dict(
        data_ok=True, source=tr["source"], symbol=tr["symbol"], side=side, band=tr.get("band"), q=tr.get("q"),
        session_phase=smc.session_phase(t_in), hour_ct=t_in.hour + t_in.minute / 60,
        ifvg_against=bool(ifvg_ag), ifvg_with=bool(ifvg_with), in_with_fvg=bool(in_fvg), in_with_ob=bool(in_ob),
        premium_pct=prem, side_depth_pct=(None if prem is None else (prem if L else round(100 - prem, 1))),
        wrong_half=(None if prem is None else (prem > 50 if L else prem < 50)), range_name=rng["name"] if rng else None,
        htf_1h=h1, htf_4h=h4, htf_aligned=int(h1 == want) + int(h4 == want),
        card_htf_aligned=(None if not ch else int(ch.get("h1") == want) + int(ch.get("h4") == want)),
        sweep_with_before=any(s["kind"] == ("SSL" if L else "BSL") for s in sweeps_1h),
        sweep_against_before=any(s["kind"] == ("BSL" if L else "SSL") for s in sweeps_1h),
        displacement_atr=smc.displacement(fr["5m"], t_in, side, 5), card_disp=tr.get("card_disp"),
        rr_from_fill=(round(abs(tr["t1"] - fill) / risk, 2) if risk and tr.get("t1") else None),
        stop_atr5=(round(risk / a5, 2) if risk and a5 else None), atr5=round(a5, 2) if a5 == a5 else None,
        eq_pool_toward_target=bool(pools_side), eq_pool_behind_stop=bool(pools_under),
        dist_pdh_atr=(round((lv["PDH"] - fill) / a5, 2) if "PDH" in lv and a5 else None),
        dist_pdl_atr=(round((fill - lv["PDL"]) / a5, 2) if "PDL" in lv and a5 else None),
        brain=v.get("brain"), floor=v.get("floor"), desk_band=desk.get("band") or desk.get("card_band"), desk_q=desk.get("q"),
        actionable=desk.get("actionable"), brain_stand=(v.get("brain") == "STAND") if v.get("brain") else None,
        floor_armed=(v.get("floor") in ("ARMED", "HAND", "TAKE")) if v.get("floor") else None,
        n_live_block=len(gt.get("live_block") or []), n_soft_block=len(gt.get("soft_block") or []), n_shadow_block=len(gt.get("shadow_block") or []),
        shadow_htf_block="shadow:htf" in (gt.get("shadow_block") or []),
        # outcome
        R=tr.get("R"), win=(tr.get("R") or 0) > 0, pnl_usd=tr.get("pnl_usd"), t1_hit=t1_hit, mfe_R=mfe, mae_R=mae,
        hindsight_ifvg_against_after_entry=bool(inv_after),
    )
    st.update(atr5=a5, atr1=a1, levels=lv, range=rng, pools=pools, sweeps=sweeps, swings=sw5[-12:],
              fvg5=g5_all, fvg1=g1_all, fvg15=g15_all, obs=obs_all, ifvg_against=ifvg_ag, in_fvg=in_fvg, in_ob=in_ob,
              htf=dict(h1=h1, h4=h4, card=ch or None))
    return fr, st, f
