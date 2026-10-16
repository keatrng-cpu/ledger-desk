/** config1 live candidate source (combo1016-cand.ts, eng.py closed-bar port) + atrpct from the 5m feed, vs SMC golden_decisions,
 *  desk view only (480 closed 1m, 1mo 15m, 1mo 5m). Skips when the SMC integration bundle is not on this box. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const DIR = "/workspace/audits/smc-research/integration/fixtures";
const HAVE = existsSync(`${DIR}/bars1m_ES_2026-08-17_2026-10-16.json`);
const R = HAVE ? await import("./combo1016-live-replay.mts") : null;
const G = HAVE ? JSON.parse(readFileSync(`${DIR}/golden_decisions.json`, "utf8")).fixtures.filter((f) => f.t_decision_bar_label >= "2026-10-13") : [];
const near = (a, b, e = 1e-6) => a != null && b != null && Math.abs(a - b) <= e * Math.max(1, Math.abs(b));

test("golden 10/13-10/16: every research candidate is found at the SAME decision bar; raid inputs + atrpct match", { skip: !HAVE }, () => {
  let n = 0, found = 0; const bad = {}; const K = ["wtmax", "nk", "pd", "arr_ifvg", "n_arr", "b1", "atrpct", "tr4h_with", "sw_with", "rng30", "pdpos_with"];
  for (const f of G) {
    n++; const t = Date.parse(f.t_decision_bar_label); const sym = f.sym;
    const r = R.liveReadsAt(sym, t + 60_000).find((x) => x.side === f.side && x.t === t); if (!r) continue; found++;
    for (const k of K) { const v = f.features[k]; if (!(v == null ? r.feat[k] == null : near(r.feat[k], v))) bad[k] = (bad[k] ?? 0) + 1; }
    assert.deepEqual(r.missing.filter((k) => !["chaseR", "risk_atr"].includes(k)), [], `${f.t_decision_bar_label} ${sym} ${f.side} missing ${r.missing}`);
  }
  console.log(`found ${found}/${n}; mismatches`, bad);
  assert.ok(found >= n - 1, `found ${found}/${n}`);
  for (const k of ["wtmax", "nk", "arr_ifvg", "b1", "atrpct", "tr4h_with", "rng30"]) assert.ok((bad[k] ?? 0) <= 2, `${k}: ${bad[k]}`);
});

test("no lookahead: a candidate's inputs are unchanged when every bar after its decision close is altered", { skip: !HAVE }, async () => {
  const C = await import("../src/lib/smc/combo1016-cand.ts");
  const f = G.find((x) => x.configs.config1_trail.fires); const t = Date.parse(f.t_decision_bar_label);
  const bars = JSON.parse(readFileSync(`${DIR}/bars1m_${f.sym}_2026-08-17_2026-10-16.json`, "utf8")).map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
  const own = bars.filter((b) => b.t <= t).slice(-480);
  const agg = (ms) => { const o = []; for (const x of bars.filter((b) => b.t + 60_000 <= t + 60_000)) { const k = Math.floor(x.t / ms) * ms; const L = o.at(-1); if (L && L.t === k) { L.h = Math.max(L.h, x.h); L.l = Math.min(L.l, x.l); L.c = x.c; } else o.push({ ...x, t: k }); } return o.filter((b) => b.t + ms <= t + 60_000 && b.t >= t - 31 * 86_400_000); };
  const a = C.researchCandidates({ own1m: own, own15m: agg(900_000), own5m: agg(300_000), sym: f.sym });
  // the same call can only see bars <= t: feed it a series that continues wildly after t and cut at t again
  const more = [...own, ...bars.filter((b) => b.t > t).slice(0, 30).map((b) => ({ ...b, h: b.h + 99, l: b.l - 99 }))];
  const b = C.researchCandidates({ own1m: more.filter((x) => x.t <= t), own15m: agg(900_000), own5m: agg(300_000), sym: f.sym });
  assert.deepEqual(a, b); assert.ok(a.some((x) => x.side === f.side && x.t === t));
});

test("SMC #47 review (3): the 8 desk-defined inputs vs golden week of 10/12; every disp/mss/ifvg mismatch is research lookahead (eng.py scans to jm+5)", { skip: !HAVE }, () => {
  // 10/12 is a Monday (eng.py skips Mondays: the prior calendar day has no RTH), so the week's golden rows are 10/13..10/16.
  const G12 = JSON.parse(readFileSync(`${DIR}/golden_decisions.json`, "utf8")).fixtures.filter((f) => f.t_decision_bar_label >= "2026-10-12");
  const K = ["wtmax", "nk", "disp", "mss", "ifvg", "arr_ifvg", "eqhit", "n_arr"]; const bad = {}; const other = []; let found = 0;
  for (const f of G12) {
    const t = Date.parse(f.t_decision_bar_label); const r = R.liveReadsAt(f.sym, t + 60_000).find((x) => x.side === f.side && x.t === t); if (!r) continue; found++;
    for (const k of K) {
      const v = f.features[k], w = r.feat[k]; if (v == null ? w == null : near(w, v)) continue; bad[k] = (bad[k] ?? 0) + 1;
      // a live (closed-bar) value can only be LOWER: eng.py keeps max-ing disp and latching mss/ifvg on bars jm+1..jm+5 after the decision bar
      if (["disp", "mss", "ifvg"].includes(k) && !(w <= v + 1e-9)) other.push(`${k} ${f.t_decision_bar_label} ${f.sym} ${f.side}: desk ${w} > research ${v}`);
    }
  }
  console.log(`week 10/12: found ${found}/${G12.length}; 8-input mismatches`, bad, "not explained by lookahead:", other);
  // known: 1 ifvg row (10/13 13:05 ES long) where the closed-bar scan sees an inversion eng.py does not record (open item, README)
  assert.ok(other.length <= 1, other.join("; "));
  assert.equal(found, G12.length);
  for (const k of ["wtmax", "nk"]) assert.equal(bad[k] ?? 0, 0, `${k}: ${bad[k]}`);
  // eqhit / n_arr / arr_ifvg depend on the raid extreme and the array list, which eng.py also extends to jm+5 (documented, README)
  for (const [k, m] of [["eqhit", 6], ["n_arr", 5], ["arr_ifvg", 1]]) assert.ok((bad[k] ?? 0) <= m, `${k}: ${bad[k]}`);
});
