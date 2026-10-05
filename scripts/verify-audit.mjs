/**
 * The desk audit (src/lib/room/audit.ts) against its contract.
 *
 *   npx tsx scripts/verify-audit.mjs
 *
 * WHY: the trader wants the five "analyzing the ledger desk and looking for fixes it needs". The honest form is a ranked list
 * of findings that each rest on a number the desk already holds, with an owner, the evidence line and a proposal addressed
 * to the TRADER — and nothing that can change a rule. This pins that down:
 *
 *   - every finding has a fixed trigger (a synthetic feed, a late Yahoo tape, a goal collision the trader owns, a refusing
 *     gate that cost money on a sample worth quoting, an odds gap over ten points on thirty plans, an idle seat, ...);
 *   - below its sample or threshold it says nothing; when the evidence goes the finding goes;
 *   - the list is ranked high → low and is a pure function of its input (no clock, no model, no randomness);
 *   - the module imports no config, no gate and no size: it cannot write a rule.
 */
const A = await import("../src/lib/room/audit.ts");
const fs = await import("node:fs");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const ids = (xs) => xs.map((x) => x.id);

const feed = (kind, lagSec = 0.5) => ({ kind, lagSec });
const goal = (over = {}) => ({
  status: "running",
  pTarget: 0.3,
  pNoCard: 0.1,
  needed: { pStar: 0.5, pWin: null, lambdaMultiple: null, winPct: null },
  collisions: [],
  ...over,
});
const lab = (over = {}) => ({ refusals: [], calibration: null, twins: { n: 0 }, ...over });
const empty = { feed: feed("live_gateway"), goal: null, lab: null, rnd: null, seats: null };

console.log("The feed");
check("a real-time feed raises nothing about data", !ids(A.deskAudit(empty)).some((i) => i.startsWith("feed")));
{
  const out = A.deskAudit({ ...empty, feed: feed("synthetic", null) });
  const it = out.find((x) => x.id === "feed_dark");
  check("a synthetic feed is the one finding that matters first", out[0]?.id === "feed_dark" && it?.severity === "high" && it.owner === "Vince" && it.area === "data");
  check("…and a missing feed says the same", A.deskAudit({ ...empty, feed: feed("none", null) }).some((x) => x.id === "feed_dark"));
  check("the finding goes when the feed becomes real", !ids(A.deskAudit(empty)).includes("feed_dark"));
}
{
  const late = A.deskAudit({ ...empty, feed: feed("yahoo", 600) }).find((x) => x.id === "feed_late");
  check("a Yahoo tape ten minutes late is named, with the lag in the evidence", late && /10 min/.test(late.evidence) && late.severity === "med", JSON.stringify(late));
  check("a Yahoo tape under five minutes is not a finding", !A.deskAudit({ ...empty, feed: feed("yahoo", 120) }).some((x) => x.id === "feed_late"));
}

console.log("The goal");
{
  const col = (id, severity, ask, decision = "A number the trader owns.") => ({ id, severity, title: id, detail: `${id} detail`, decision, ask });
  const out = A.deskAudit({
    ...empty,
    goal: goal({ collisions: [col("cap_vs_contract", "blocker", true), col("frequency", "warn", true), col("floor", "info", true), col("edge", "warn", false)] }),
  });
  check("a collision the trader owns becomes a finding, one each", ids(out).includes("goal_cap_vs_contract") && ids(out).includes("goal_frequency"), JSON.stringify(ids(out)));
  check("information-only and not-the-trader's collisions do not", !ids(out).includes("goal_floor") && !ids(out).includes("goal_edge"));
  check("a blocker is high, a warning medium; Sterling owns them", out.find((x) => x.id === "goal_cap_vs_contract")?.severity === "high" && out.find((x) => x.id === "goal_frequency")?.severity === "med" && out.find((x) => x.id === "goal_frequency")?.owner === "Sterling");
  check("the proposal is the collision's own decision text", out.find((x) => x.id === "goal_frequency")?.proposal === "A number the trader owns.");
}
{
  const hopeless = A.deskAudit({ ...empty, goal: goal({ pTarget: 0.0000003, pNoCard: 0.14, needed: { pStar: 0.6, pWin: 0.62, lambdaMultiple: 7.5, winPct: 40 } }) }).find((x) => x.id === "goal_odds");
  check("odds under 0.1% are called out, with what it would take", hopeless && /under 0.001%/.test(hopeless.evidence) && /62%/.test(hopeless.proposal) && /7\.5×/.test(hopeless.proposal) && /not the gates/.test(hopeless.proposal), JSON.stringify(hopeless));
  check("…and say the chance that nothing prints at all", /14%/.test(hopeless?.evidence ?? ""));
  const impossible = A.deskAudit({ ...empty, goal: goal({ pTarget: 0, winsNeed: 16, tradeBudget: 9 }) }).find((x) => x.id === "goal_odds");
  check("odds of exactly zero say so, with the straight-line arithmetic (16 winners needed, 9 tickets allowed)", /exact odds zero/.test(impossible?.evidence ?? "") && /16 winners in a row/.test(impossible?.evidence ?? "") && /9 tickets/.test(impossible?.evidence ?? ""), JSON.stringify(impossible));
  check("…and when the budget is enough the straight-line clause is left out", !/winners in a row/.test(A.deskAudit({ ...empty, goal: goal({ pTarget: 0.0001, winsNeed: 5, tradeBudget: 9 }) }).find((x) => x.id === "goal_odds")?.evidence ?? ""));
  check("odds of 5% are not a finding", !A.deskAudit({ ...empty, goal: goal({ pTarget: 0.05 }) }).some((x) => x.id === "goal_odds"));
  check("a goal that is over (hit, floor, expired) is not audited for odds", !A.deskAudit({ ...empty, goal: goal({ status: "hit", pTarget: 0 }) }).some((x) => x.id === "goal_odds"));
}

console.log("The ghost room and the card's odds");
{
  const gate = (n, pnlUsd) => ({ gate: "ev", n, wins: 1, pnlUsd });
  check("a gate whose refusals would have made money on 5+ tickets is a low finding", A.deskAudit({ ...empty, lab: lab({ refusals: [gate(5, 120)] }) }).find((x) => x.id === "gate_ev")?.severity === "low");
  check("four tickets, or a refusal that saved money, is not", !A.deskAudit({ ...empty, lab: lab({ refusals: [gate(4, 300), gate(9, -50)] }) }).some((x) => x.id.startsWith("gate_")));
  const odds = (n, meanP, hitRate) => lab({ calibration: { n, meanP, hitRate } });
  check("odds said 40% and printed 22% over 30 plans is a finding for Nova", A.deskAudit({ ...empty, lab: odds(30, 0.4, 0.22) }).find((x) => x.id === "odds_gap")?.owner === "Nova");
  check("a gap of exactly ten points is not (the bar is over ten)", !A.deskAudit({ ...empty, lab: odds(40, 0.4, 0.3) }).some((x) => x.id === "odds_gap"));
  check("29 plans is not enough however large the gap", !A.deskAudit({ ...empty, lab: odds(29, 0.5, 0.1) }).some((x) => x.id === "odds_gap"));
}

console.log("Execution, the R&D board and the seats");
check("the missing server runner is named while the flag is false", A.deskAudit(empty).some((x) => x.id === "runner" && x.owner === "Vince" && x.area === "execution"));
{
  const exp = (status, n = 3, nNeeded = 10) => ({ id: `e${n}${status}`, owner: "Nova", title: "t", status, n, nNeeded, read: "r", proposal: null });
  check("no experiment decided yet is a low note about the window, not about a rule", A.deskAudit({ ...empty, rnd: { experiments: [exp("collecting", 3), exp("collecting", 5)] } }).find((x) => x.id === "rnd_empty")?.severity === "low");
  check("once one has decided the note goes", !A.deskAudit({ ...empty, rnd: { experiments: [exp("collecting", 3), exp("supported", 12)] } }).some((x) => x.id === "rnd_empty"));
  const row = (id, took, declined) => ({ id, name: id, taken: { n: took }, declined: { n: declined } });
  const seats = (touches, rows) => ({ touches, rows });
  check("two seats that never took or declined anything, after 3 touches, are named", A.deskAudit({ ...empty, seats: seats(3, [row("protect", 0, 0), row("press", 0, 0), row("edge", 2, 0), row("room", 0, 0)]) }).find((x) => x.id === "idle_seats")?.evidence.includes("protect and press"));
  check("The Room is never counted idle", !/room/.test(A.deskAudit({ ...empty, seats: seats(5, [row("protect", 0, 0), row("press", 0, 0), row("room", 0, 0)]) }).find((x) => x.id === "idle_seats")?.evidence ?? ""));
  check("two touches is too early to call a seat idle", !A.deskAudit({ ...empty, seats: seats(2, [row("protect", 0, 0), row("press", 0, 0)]) }).some((x) => x.id === "idle_seats"));
}

console.log("Ranking and purity");
{
  const full = {
    feed: feed("synthetic", null),
    goal: goal({ pTarget: 0.00001, collisions: [{ id: "x", severity: "warn", title: "A collision", detail: "A detail line.", decision: "A number the trader owns.", ask: true }] }),
    lab: lab({ refusals: [{ gate: "ev", n: 6, wins: 3, pnlUsd: 80 }] }),
    rnd: { experiments: [{ id: "a", owner: "Nova", title: "t", status: "collecting", n: 1, nNeeded: 5, read: "r", proposal: null }] },
    seats: null,
  };
  const out = A.deskAudit(full);
  const rank = { high: 0, med: 1, low: 2 };
  check("ranked high → medium → low", out.every((x, i) => i === 0 || rank[out[i - 1].severity] <= rank[x.severity]), JSON.stringify(out.map((x) => `${x.severity}:${x.id}`)));
  check("a pure function: the same input, the same list", JSON.stringify(A.deskAudit(full)) === JSON.stringify(out));
  check("every finding has an owner among the five, an evidence line and a proposal", out.every((x) => ["Jax", "Nova", "Gemma", "Sterling", "Vince"].includes(x.owner) && x.evidence.length > 3 && x.proposal.length > 3));
  check("ids are unique (a finding is raised once)", new Set(ids(out)).size === out.length);
}

console.log("It cannot write a rule");
{
  const src = fs.readFileSync(new URL("../src/lib/room/audit.ts", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]);
  check("it imports only the exec flags, two type modules and nothing that sets a number", imports.every((i) => ["./exec/limits", "./orchestrator", "./live-types"].includes(i)), JSON.stringify(imports));
  check("and no config.ts, no gate, no size anywhere in it", !/aplus\/config|sleeve|mandate|setGoal|saveGoal|writeFile|fetch\(|Math\.random|Date\.now/.test(src));
}

console.log(`\naudit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
