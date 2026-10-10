/**
 * What the five say when the room is the firm — the standing reviews an investment firm holds that are not about a price.
 *
 * Same rules as live-voices-invest.ts (and the same reasons): fixed phrase banks, every number through `Facts` as it is printed,
 * a bank with nothing new to say drops the line instead of repeating it, narration only. The builders are handed the answers
 * invest-firm.ts already computed by calling the Invest tab's own functions on the cost-valued book; they decide the WORDS and never
 * the facts. Nothing here quotes a price, a performance, an unrealised figure, a drawdown or a trend — the Floor holds no marks, and a
 * review that would need one says so. Nothing here carries a verdict word, a size, an order or a recommendation.
 *
 * Each review is one exchange of five or six lines across the people in their investing hats:
 *   Sterling  the chair: the rule, whose call it is, what the number is not.
 *   Nova      the arithmetic: the weights, the waterfall, the lots, the valuation read.
 *   Jax       the scout: the thesis, the examples, the IPO watch.
 *   Gemma     the evidence: the journal, the sources, the ages of the data, the risks on file.
 *   Vince     the structure: who holds what inside the funds, the next name in a sleeve, the catalysts.
 *
 * Spots are the investment wing's own (ANNEX): the people walk to the desk or the screen the review belongs to.
 */

import { ANIM, hash32, type InvestLite, type Line, type LedgerProblemKind, type TalkMove } from "./live-types";
import { clip, compact, line, pick, type Ctx, type Ex } from "./live-voices";
import { dateSay, dayPhrase, macroRead, monthSay, sentencesWithin, whenPhrase } from "./invest-read";

const AT = (spot: string): TalkMove => ({ zone: "ANNEX", spot });
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const stop = (t: string): string => (/[.!?…]$/.test(t) ? t : `${t}.`);
const list = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** Recorded dollars as they are: with cents when they have cents, whole otherwise. */
const cash = (f: Ctx["f"], n: number): string => f.usd(n, Number.isInteger(n) ? 0 : 2);
/** A realised gain or loss, said in words — a minus sign is never left to the speech engine. */
const gainLoss = (f: Ctx["f"], n: number): string => (n < 0 ? `a loss of ${cash(f, n)}` : n > 0 ? `a gain of ${cash(f, n)}` : "zero");
const pc1 = (f: Ctx["f"], fraction: number): string => f.pct(fraction * 100, 1);
const SLEEVE_SAY: Record<string, string> = { building: "buildings" };
const sleeveSay = (s: string): string => SLEEVE_SAY[s] ?? s;
/** A deterministic rotation: the same date always picks the same item, a different date a different one. */
const rot = <T,>(key: string, xs: T[]): T | null => (xs.length ? xs[hash32(key) % xs.length]! : null);

/** What the replay could not apply, said as a person would, singular and plural. */
const PROBLEM_SAY: Record<LedgerProblemKind, [string, string]> = {
  duplicate: ["entry with a repeated id", "entries with a repeated id"],
  "void-missing": ["void naming an entry that is not in the ledger", "voids naming an entry that is not in the ledger"],
  "void-void": ["void aimed at another void", "voids aimed at another void"],
  "sale-short": ["sale larger than the shares open then", "sales larger than the shares open then"],
  "month-twice": ["month logged twice", "months logged twice"],
  other: ["problem of another kind", "problems of another kind"],
};

/** What an aged snapshot does to the reading, by dataset — each sentence is true of the Invest tab's own use of it. */
const FRESH_EFFECT: Record<string, string> = {
  universe: "Past that line a growth name reads wait for its age alone, and every ratio drawn from the snapshot is that old.",
  "oldest-row": "Past that line the name on that row reads wait for its age alone, and its ratios are that old.",
  durability: "The price-versus-record comparison sets today's requirement beside a record captured that long ago.",
  "fund-profiles": "Look-through and overlap are drawn from fund holdings captured that long ago.",
  "ipo-watch": "The lock-up dates and the upcoming list are that old, and a lock-up date can move.",
};

/** Where the five stand for the investment wing's closed-hours study: the research desks, not the Mead Hall. */
export const INVEST_STUDY_MOVES: Ex["moves"] = {
  Gemma: AT("inv_news"),
  Vince: AT("inv_struct"),
  Nova: AT("inv_cio"),
  Jax: AT("inv_scout"),
  Sterling: AT("inv_wall"),
};

/* ── Risk committee: look-through, the name cap, the sleeve cap ─────────── */

export function exFirmRisk(c: Ctx, d: { inv: InvestLite }): Ex | null {
  const f = c.f;
  const firm = d.inv.firm;
  const r = firm?.risk;
  if (!firm || !r) return null;
  const today = d.inv.dayKey;
  const over = r.overlapQQQ >= r.overlapWarn;
  const lines: (Line | null)[] = [];

  lines.push(
    line(
      "Vince",
      ANIM.Vince.watch!,
      pick(c, "firm-risk-mech", [
        () => "Look-through, for the risk committee. Overlap with QQQ is, company by company, the smaller of its weight in our book and in QQQ, added up.",
        () => "Risk committee, look-through first. We open every fund and add up, company by company, the smaller of its weight here and in QQQ. That sum is the overlap.",
      ]),
    ),
  );
  lines.push(
    line(
      "Nova",
      ANIM.Nova.analyze!,
      r.preview
        ? pick(c, "firm-risk-num-preview", [
            () => `Nothing is held yet, so take the first dollar. It lands in VTI, which overlaps QQQ by ${f.frac(r.overlapQQQ)} and is ${f.frac(r.techWeight)} tech and communication services once it is opened.`,
          ])
        : pick(c, "firm-risk-num", [
            () => `Opened up, this book overlaps QQQ by ${f.frac(r.overlapQQQ)} and is ${f.frac(r.techWeight)} tech and communication services. The tab warns at ${f.frac(r.overlapWarn)}; we are ${over ? "over" : "inside"} it.${r.overlapPartial ? " One fund's list is partial, so read that as a floor." : ""}`,
            () => `At cost and opened up: ${f.frac(r.overlapQQQ)} overlap with QQQ, ${f.frac(r.techWeight)} tech and communication. The warning line is ${f.frac(r.overlapWarn)}, and we are ${over ? "past" : "under"} it.`,
          ]),
    ),
  );
  const top = r.names[0];
  if (top && !r.preview) {
    const direct = top.direct < 0.0005 ? "all of it through the funds" : top.viaFunds < 0.0005 ? "all of it held directly" : `${pc1(f, top.direct)} held directly and ${pc1(f, top.viaFunds)} through the funds`;
    lines.push(
      line(
        "Jax",
        ANIM.Jax.point!,
        pick(c, "firm-risk-top", [
          () =>
            `Biggest single line is ${top.ticker} at ${pc1(f, top.weight)}, ${direct}. The name cap is ${f.frac(r.nameCap)}${r.namesOverCap.length ? `, and ${list(r.namesOverCap.map((n) => n.ticker))} ${plural(r.namesOverCap.length, "is", "are")} over it` : ", and no name is over it"}.`,
        ]),
      ),
    );
  } else if (top) {
    lines.push(
      line("Jax", ANIM.Jax.point!, pick(c, "firm-risk-top-preview", [() => `The biggest line inside VTI is ${top.ticker} at ${pc1(f, top.weight)} of the first dollar. The name cap is ${f.frac(r.nameCap)}, and the tab counts what the funds hold toward it.`])),
    );
  }
  // The safety sleeve is the net the funnel puts 42% of every swept dollar into, so the one-bet cap is read about the others
  // (the Invest tab itself flags a book that is mostly VTI and SGOV as "safety over the cap" — see the report).
  const growth = r.sleeves.filter((s) => s.sleeve !== "safety");
  const growthOver = growth.filter((s) => s.over);
  const biggest = [...growth].sort((a, b) => b.weight - a.weight)[0];
  lines.push(
    line(
      "Sterling",
      ANIM.Sterling.tablet!,
      growthOver.length
        ? pick(c, "firm-risk-sleeve-over", [
            () => `A sleeve over ${f.frac(r.sleeveCap)} of the book is one bet. ${list(growthOver.map((s) => `${sleeveSay(s.sleeve)} at ${f.frac(s.weight)}`))} ${plural(growthOver.length, "is", "are")} past it. Safety is the net, so the cap is about the others.`,
          ])
        : biggest
          ? pick(c, "firm-risk-sleeve-in", [
              () => `A sleeve over ${f.frac(r.sleeveCap)} of the book is one bet. Our largest of the others is ${sleeveSay(biggest.sleeve)} at ${f.frac(biggest.weight)}, so none is past it. Safety is the net, so the cap is about the others.`,
            ])
          : pick(c, "firm-risk-sleeve-none", [
              () => `A sleeve over ${f.frac(r.sleeveCap)} of the book is one bet. We hold none of the long board's growth names yet, so the cap has nothing to bind. Safety is the net.`,
            ]),
    ),
  );
  if (r.computeNames.length) {
    lines.push(
      line(
        "Vince",
        ANIM.Vince.thumbs!,
        pick(c, "firm-risk-compute", [
          () => `The funnel gives compute ${f.frac(r.computeShare)} of a swept dollar. ${f.raw(stop(clip(r.computeWhy, 130)))} ${list(r.computeNames)} are the same bet as the sleeve.`,
        ]),
      ),
    );
  }
  const prof = firm.fresh.items.find((x) => x.id === "fund-profiles");
  lines.push(
    line(
      "Gemma",
      ANIM.Gemma.explain!,
      pick(c, "firm-risk-cost", [
        () =>
          `All of this is at cost. The Floor holds no prices, so nothing here is a gain or a drawdown.${!r.preview && r.feeUsdYear > 0 ? ` The funds charge ${cash(f, r.feeUsdYear)} a year, ${f.pct(r.feeBlended * 100, 2)} of the book.` : ""}${prof ? ` Fund profiles were captured ${f.raw(dateSay(prof.asOf, today))}.` : ""}`,
      ]),
    ),
  );
  const out = compact(lines);
  return out.length >= 3 ? { lines: out, moves: { Vince: AT("inv_struct"), Nova: AT("inv_cio"), Jax: AT("inv_scout"), Sterling: AT("inv_wall"), Gemma: AT("inv_news") } } : null;
}

/* ── Compliance: the restricted list and the add gate ───────────────────── */

export function exFirmCompliance(c: Ctx, d: { inv: InvestLite }): Ex | null {
  const f = c.f;
  const x = d.inv.firm?.compliance;
  if (!x) return null;
  const today = d.inv.dayKey;
  const lines: (Line | null)[] = [];
  if (x.heldBanned.length) {
    lines.push(
      line("Sterling", ANIM.Sterling.arms!, pick(c, "firm-comp-held", [() => `First, a flag. The book holds ${list(x.heldBanned.map((h) => h.ticker))}, and that is on the restricted list while the sleeve trades the same index.`])),
    );
  }
  lines.push(
    line(
      "Sterling",
      ANIM.Sterling.tablet!,
      pick(c, "firm-comp-list", [
        () => `Compliance, the restricted list. While the sleeve trades ${list(x.traded)} options, ${f.int(x.banned.length)} funds are off limits to the book: ${list(x.banned)}.`,
        () => `The restricted list stands at ${f.int(x.banned.length)} funds, because the sleeve trades ${list(x.traded)} options: ${list(x.banned)}.`,
      ]),
    ),
  );
  const dyn = x.dynamic[0];
  lines.push(
    line(
      "Gemma",
      ANIM.Gemma.explain!,
      x.journalFills == null
        ? pick(c, "firm-comp-nojournal", [() => "I cannot read the options journal from here, so only the fixed list is certain today."])
        : dyn
          ? pick(c, "firm-comp-dyn", [
              () =>
                `The options journal adds ${list(x.dynamic.map((u) => u.underlier))}. ${dyn.underlier} last traded ${f.raw(dateSay(dyn.lastAt.slice(0, 10), today))}, so it stays off through ${f.raw(dateSay(dyn.throughDate, today))}, the end of a ${f.int(x.lookbackDays)} day window around that trade.`,
            ])
          : pick(c, "firm-comp-nodyn", [
              () => `The options journal holds ${f.int(x.journalFills!)} ${plural(x.journalFills!, "fill", "fills")} and shows no other underlier inside the ${f.int(x.lookbackDays)} day window, so the fixed list is the whole list today.`,
            ]),
    ),
  );
  lines.push(
    line(
      "Nova",
      ANIM.Nova.analyze!,
      pick(c, "firm-comp-mech", [
        () => `The rule behind the list: a loss is deferred if you buy the same thing, or an option on it, within ${f.int(x.washWindowDays)} days either side of the sale. ${list(x.twins)} are twins inside the book for the same reason.`,
      ]),
    ),
  );
  const names = [...new Set(x.watch.map((w) => w.ticker))];
  if (names.length) {
    lines.push(
      line(
        "Vince",
        ANIM.Vince.watch!,
        pick(c, "firm-comp-watch", [
          () => `${f.int(names.length)} ${plural(names.length, "name carries", "names carry")} a written watch: ${list(names)}. A watch refuses the add gate until its own clearing condition is met.`,
        ]),
      ),
    );
    const ex = rot(`${d.inv.dayKey}|watch`, x.watch);
    if (ex) {
      lines.push(
        line("Jax", ANIM.Jax.point!, pick(c, "firm-comp-clears", [() => `For ${ex.ticker} the condition was written before anyone owned it: ${f.raw(stop(sentencesWithin(ex.clearsWhen, 125)))}`])),
      );
    }
  }
  lines.push(
    line(
      "Sterling",
      ANIM.Sterling.arms!,
      x.incomplete.length
        ? pick(c, "firm-comp-gate-inc", [
            () => `${f.int(x.addable)} of ${f.int(x.dossiers)} dossiers pass the add gate today and ${f.int(x.blocked)} do not. A blank field blocks one: ${list(x.incomplete.map((i) => `${i.ticker} is missing ${i.missing.join(" and ")}`))}. That is the gate's count, not a view on any company.`,
          ])
        : pick(c, "firm-comp-gate", [
            () => `${f.int(x.addable)} of ${f.int(x.dossiers)} dossiers pass the add gate today and ${f.int(x.blocked)} do not, each for a written reason. That is the gate's count, not a view on any company.`,
          ]),
    ),
  );
  const out = compact(lines);
  return out.length >= 3 ? { lines: out, moves: { Sterling: AT("chair_desk"), Gemma: AT("inv_news"), Nova: AT("inv_cio"), Vince: AT("inv_struct"), Jax: AT("inv_scout") } } : null;
}

/* ── Due diligence: the kill rules and who judged them ──────────────────── */

export function exFirmDiligence(c: Ctx, d: { inv: InvestLite }): Ex | null {
  const f = c.f;
  const x = d.inv.firm?.diligence;
  if (!x) return null;
  const today = d.inv.dayKey;
  const lines: (Line | null)[] = [];
  lines.push(
    line(
      "Gemma",
      ANIM.Gemma.explain!,
      pick(c, "firm-dd-open", [
        () => `Due diligence, the kill rules. ${f.int(x.rules)} dossiers carry a rule written before we owned anything, so a headline is read against the rule and not against the mood.`,
        () => `The kill rules: ${f.int(x.rules)} of them, each written while there was no position to defend. A headline is read against its rule.`,
      ]),
    ),
  );
  if (!x.readable) {
    lines.push(line("Nova", ANIM.Nova.analyze!, pick(c, "firm-dd-unread", [() => "I cannot read the kill-rule record from here, so I will not say what was checked or judged."])));
  } else if (x.lastRanAt) {
    const when = x.lastRanAt.slice(0, 10);
    lines.push(
      line(
        "Nova",
        ANIM.Nova.analyze!,
        pick(c, "firm-dd-last", [
          () =>
            `The check runs every ${f.int(x.intervalDays)} days, because a long-held book checked daily becomes a screen. The last ran ${f.raw(dateSay(when, today))}, ${f.int(x.daysSince ?? 0)} ${plural(x.daysSince ?? 0, "day", "days")} ago, and ${f.int(x.sourced)} of ${f.int(x.results)} answers came back with sources. ${x.due ? "Another is due." : `The next is due in ${f.int(x.dueInDays ?? 0)} ${plural(x.dueInDays ?? 0, "day", "days")}.`}`,
        ]),
      ),
    );
  } else {
    lines.push(
      line(
        "Nova",
        ANIM.Nova.analyze!,
        pick(c, "firm-dd-never", [
          () => `The check runs every ${f.int(x.intervalDays)} days, because a long-held book checked daily becomes a screen. None is on record in this browser, so the baseline has not been run.`,
        ]),
      ),
    );
  }
  lines.push(
    line(
      "Sterling",
      ANIM.Sterling.tablet!,
      x.tripped.length
        ? pick(c, "firm-dd-tripped", [
            () => `The model never trips a rule. It returns links, and a person reads them and records the judgement. The trader has judged ${list(x.tripped.map((t) => `${t.ticker} on ${dateSay(t.judgedAt.slice(0, 10), today)}`))} tripped.`,
          ])
        : pick(c, "firm-dd-none", [
            () => `The model never trips a rule. It returns links, and a person reads them and records the judgement. Nothing is judged tripped today${x.judgedCount ? `, across ${f.int(x.judgedCount)} ${plural(x.judgedCount, "name", "names")} the trader has judged` : ""}.`,
          ]),
    ),
  );
  if (x.readable && x.lastRanAt && x.results > 0) {
    lines.push(
      line(
        "Vince",
        ANIM.Vince.watch!,
        pick(c, "firm-dd-unjudged", [
          () => `${f.int(x.unjudged)} of ${f.int(x.results)} answers from that run ${plural(x.unjudged, "has", "have")} no judgement of the trader's yet. And an answer with no sources is no information, not good news.`,
        ]),
      ),
    );
  }
  const out = compact(lines);
  return out.length >= 3 ? { lines: out, moves: { Gemma: AT("inv_news"), Nova: AT("inv_cio"), Sterling: AT("inv_wall"), Vince: AT("inv_struct") } } : null;
}

/* ── Operations: the ledger's health ────────────────────────────────────── */

export function exFirmOps(c: Ctx, d: { inv: InvestLite }): Ex | null {
  const f = c.f;
  const x = d.inv.firm?.ops;
  // An empty ledger has nothing to review; "no entry, and the replay applied every one" would be a sentence about nothing.
  if (!x || !x.entries) return null;
  const today = d.inv.dayKey;
  const lines: (Line | null)[] = [];
  lines.push(
    line(
      "Nova",
      ANIM.Nova.analyze!,
      x.problemCount
        ? pick(c, "firm-ops-open-bad", [
            () => `Operations, the ledger. ${f.int(x.entries)} ${plural(x.entries, "entry", "entries")}, replayed from the top every time, and ${f.int(x.problemCount)} could not be applied.`,
          ])
        : pick(c, "firm-ops-open", [
            () => `Operations, the ledger. ${f.int(x.entries)} ${plural(x.entries, "entry", "entries")}, replayed from the top every time, and the replay applied every one.`,
            () => `The ledger check: ${f.int(x.entries)} ${plural(x.entries, "entry", "entries")}, replayed from nothing, and nothing was left unapplied.`,
          ]),
    ),
  );
  if (x.problems.length) {
    lines.push(
      line(
        "Vince",
        ANIM.Vince.watch!,
        pick(c, "firm-ops-problem", [
          () => {
            const more = x.problems.slice(3).reduce((s, p) => s + p.n, 0);
            return `What it could not apply: ${list(x.problems.slice(0, 3).map((p) => `${f.int(p.n)} ${PROBLEM_SAY[p.kind][p.n === 1 ? 0 : 1]}`))}${more ? `, and ${f.int(more)} more` : ""}. The Invest tab names each entry.`;
          },
        ]),
      ),
    );
  }
  const v = x.voids[0];
  lines.push(
    line(
      "Vince",
      ANIM.Vince.watch!,
      v
        ? pick(c, "firm-ops-voids", [
            () => `${f.int(x.voidCount)} voided ${plural(x.voidCount, "entry", "entries")}. A correction is a void with a reason, never an edit. The latest, ${f.raw(dateSay(v.date, today))}: a ${v.kind}${v.ticker ? ` of ${v.ticker}` : ""}, the reason on record: ${f.raw(stop(clip(v.reason, 90)))}`,
          ])
        : pick(c, "firm-ops-novoid", [() => "Nothing has been voided. A correction would be a void with a reason, never an edit, and both would stay visible."]),
    ),
  );
  lines.push(
    line(
      "Sterling",
      ANIM.Sterling.tablet!,
      x.missedCount
        ? pick(c, "firm-ops-missed", [
            () => `${f.int(x.missedCount)} closed ${plural(x.missedCount, "month has", "months have")} no record: ${list(x.missed.map((m) => f.raw(monthSay(m))))}. The log exists to answer one question: did we do this every month.`,
          ])
        : pick(c, "firm-ops-nomiss", [() => "No closed month is missing from the sweep log. The log exists to answer one question: did we do this every month."]),
    ),
  );
  lines.push(
    line(
      "Nova",
      ANIM.Nova.nod!,
      x.overSpendUsd > 0
        ? pick(c, "firm-ops-over", [
            () => `Sweep-funded buys exceed the sweep by ${cash(f, x.overSpendUsd)}. Either a buy was tagged sweep that was new money, or a month is missing from the log.`,
          ])
        : x.waitingUsd > 0
          ? pick(c, "firm-ops-wait", [() => `${cash(f, x.waitingUsd)} is swept and not yet bought. The deploy queue balances to the cent.`])
          : pick(c, "firm-ops-deployed", [() => "Every swept dollar is deployed, and the deploy queue balances."]),
    ),
  );
  lines.push(
    line(
      "Gemma",
      ANIM.Gemma.explain!,
      x.journal
        ? pick(c, "firm-ops-journal", [
            () => `The options journal keeps its last ${f.int(x.journal!.cap)} fills and this browser holds ${f.int(x.journal!.fills)}${x.journal!.atCap ? ", so an older month may be incomplete" : ""}. Whether the server copy of the ledger matches this one is shown only on the Invest tab.`,
          ])
        : pick(c, "firm-ops-nojournal", [() => "I cannot read the options journal from here. Whether the server copy of the ledger matches this one is shown only on the Invest tab."]),
    ),
  );
  const out = compact(lines);
  return out.length >= 3 ? { lines: out, moves: { Nova: AT("inv_cio"), Vince: AT("inv_struct"), Sterling: AT("chair_desk"), Gemma: AT("inv_news") } } : null;
}

/* ── Tax and lots ───────────────────────────────────────────────────────── */

export function exFirmTax(c: Ctx, d: { inv: InvestLite }): Ex | null {
  const f = c.f;
  const x = d.inv.firm?.tax;
  if (!x) return null;
  const today = d.inv.dayKey;
  const y = x.thisYear;
  const lines: (Line | null)[] = [];
  if (!x.openLots && !y.sales && !y.dividendsUsd && !x.lastYear) return null;
  lines.push(
    line(
      "Nova",
      ANIM.Nova.analyze!,
      pick(c, "firm-tax-open", [
        () => `Tax and lots. The ledger holds ${f.int(x.openLots)} open ${plural(x.openLots, "lot", "lots")}. Every buy is its own lot, because the holding period runs per lot, and long-term means more than a year: the first long-term day is the day after the anniversary.`,
        () => `Lots first. ${f.int(x.openLots)} open ${plural(x.openLots, "lot", "lots")} in the ledger, each with its own clock. The holding period runs per lot, so a small top-up last month is short-term however old the first share is.`,
      ]),
    ),
  );
  const lead = x.positions.find((p) => p.longTermShares > 0) ?? x.positions[0];
  if (lead) {
    const turn = x.nextTurn;
    lines.push(
      line(
        "Vince",
        ANIM.Vince.watch!,
        pick(c, "firm-tax-clock", [
          () =>
            `${lead.ticker}: ${f.raw(String(lead.longTermShares))} of ${f.raw(String(lead.shares))} ${plural(lead.shares, "share is", "shares are")} past a year already, across ${f.int(lead.lots)} ${plural(lead.lots, "lot", "lots")}.${turn ? ` The next lot to turn long-term is ${turn.ticker}'s, on ${f.raw(dateSay(turn.date, today))}.` : " No short-term lot is waiting to turn."}`,
        ]),
      ),
    );
  }
  lines.push(
    line(
      "Nova",
      ANIM.Nova.nod!,
      y.sales || y.dividendsUsd
        ? pick(c, "firm-tax-year", [
            () => `${f.int(y.year)} so far: short-term ${gainLoss(f, y.stGainUsd)}, long-term ${gainLoss(f, y.ltGainUsd)}, dividends ${cash(f, y.dividendsUsd)}, across ${f.int(y.sales)} ${plural(y.sales, "sale", "sales")}.`,
          ])
        : pick(c, "firm-tax-nothing", [() => `${f.int(y.year)} so far: nothing sold and no dividends recorded. A book that never sells realizes nothing.`]),
    ),
  );
  if (x.washFlagged || y.washDeferredEstUsd) {
    lines.push(
      line("Sterling", ANIM.Sterling.arms!, pick(c, "firm-tax-wash", [() => `${f.int(x.washFlagged)} ${plural(x.washFlagged, "sale is", "sales are")} flagged as ${plural(x.washFlagged, "a wash sale", "wash sales")}, with about ${cash(f, y.washDeferredEstUsd)} of loss deferred into the replacement shares, not lost.`])),
    );
  }
  lines.push(
    line(
      "Sterling",
      ANIM.Sterling.tablet!,
      pick(c, "firm-tax-filed", [
        () => `The broker's year-end tax forms are the filed numbers; this is the check before they arrive. The accountant files, not this room.${x.lastYear ? ` ${f.int(x.lastYear.year)} had ${f.int(x.lastYear.sales)} ${plural(x.lastYear.sales, "sale", "sales")} and ${cash(f, x.lastYear.dividendsUsd)} in dividends.` : ""}`,
      ]),
    ),
  );
  lines.push(
    line(
      "Gemma",
      ANIM.Gemma.explain!,
      x.approx
        ? pick(c, "firm-tax-approx", [() => "Some lot dates came from the older store, merged, so a long-term date may be early. And an unrealized gain needs prices, which the Floor does not hold."])
        : pick(c, "firm-tax-nomark", [() => "Unrealized gains and harvest candidates need prices, and the Floor holds none. Only realized figures and the lot clock are quoted here."]),
    ),
  );
  const out = compact(lines);
  return out.length >= 3 ? { lines: out, moves: { Nova: AT("inv_cio"), Vince: AT("inv_struct"), Sterling: AT("chair_desk"), Gemma: AT("inv_news") } } : null;
}

/* ── Funding: the month's waterfall ─────────────────────────────────────── */

export function exFirmFunding(c: Ctx, d: { inv: InvestLite }): Ex | null {
  const f = c.f;
  const x = d.inv.firm?.funding;
  if (!x) return null;
  const today = d.inv.dayKey;
  const last = x.last;
  const lines: (Line | null)[] = [];
  lines.push(
    line(
      "Nova",
      ANIM.Nova.analyze!,
      pick(c, "firm-fund-order", [
        () => `Funding review. The waterfall runs in order. Data rent of ${cash(f, x.rentUsd)} first, then the sleeve back to ${cash(f, x.sleeveTargetUsd)}, then ${f.int(x.ratePct)}% of what is left becomes shares. A losing month sweeps nothing.`,
        () => `Funding, in order. Rent of ${cash(f, x.rentUsd)} comes off the month first, the options sleeve is filled back to ${cash(f, x.sleeveTargetUsd)} next, and only then does ${f.int(x.ratePct)}% of the remainder become shares.`,
      ]),
    ),
  );
  if (last) {
    lines.push(
      line(
        "Nova",
        ANIM.Nova.nod!,
        pick(c, "firm-fund-last", [
          () =>
            `${f.raw(monthSay(last.month))}, the last logged month: ${cash(f, last.realizedUsd)} closed, ${cash(f, last.rentUsd)} to rent${last.restoreUsd > 0 ? `, ${cash(f, last.restoreUsd)} to refill the sleeve` : ""}, ${cash(f, last.sweptUsd)} swept at ${f.int(last.ratePct)}%.${last.rentDrag != null ? ` Rent took ${f.pct(last.rentDrag * 100, 0)} of the gross.` : ""}`,
        ]),
      ),
    );
    lines.push(
      line(
        "Sterling",
        ANIM.Sterling.tablet!,
        last.rentAlarm
          ? pick(c, "firm-fund-alarm", [
              () => `The bill is the story. Rent is past ${f.frac(x.rentAlarmAt)} of that month's gross. A year of rent is ${cash(f, last.annualRentUsd)}; a year of sweeping at that pace is ${cash(f, last.annualSweepUsd)}.`,
            ])
          : pick(c, "firm-fund-noalarm", [
              () => `The tab calls the bill the story when rent passes ${f.frac(x.rentAlarmAt)} of gross, and it did not that month. A year of rent is ${cash(f, last.annualRentUsd)}; a year of sweeping at that pace is ${cash(f, last.annualSweepUsd)}.`,
            ]),
      ),
    );
  } else {
    lines.push(line("Sterling", ANIM.Sterling.tablet!, pick(c, "firm-fund-none", [() => "No month is logged yet, so there is no waterfall to read. The first one is priced once the month has ended."])));
  }
  const j = x.journal;
  lines.push(
    line(
      "Gemma",
      ANIM.Gemma.explain!,
      j == null
        ? pick(c, "firm-fund-nojournal", [() => "I cannot read the options journal from here, so I will not offer a figure for last month."])
        : j.closed
          ? pick(c, "firm-fund-journal", [
              () => `The options journal shows ${gainLoss(f, j.realizedUsd)} realized across ${f.int(j.closed)} closed ${plural(j.closed, "trade", "trades")} in ${f.raw(monthSay(j.month))}${j.open ? `, with ${f.int(j.open)} still open` : ""}. Open premium is not cash and is never swept.${j.capNote ? " The journal's cap may have cut the month short." : ""}`,
            ])
          : pick(c, "firm-fund-journal-none", [() => `The options journal shows no closed trade in ${f.raw(monthSay(j.month))}, so there is nothing to offer the sweep for that month.`]),
    ),
  );
  const n = x.needs[1];
  if (n) {
    lines.push(
      line(
        "Vince",
        ANIM.Vince.thumbs!,
        pick(c, "firm-fund-needs", [
          () => `Run it backwards: a sweep of ${cash(f, n.sweepUsd)} at ${f.int(x.ratePct)}% needs ${cash(f, n.realizedUsd)} realized, which is ${cash(f, x.rentUsd)} of rent plus ${cash(f, n.sweepUsd)} divided by the rate. That is arithmetic, not a target.`,
        ]),
      ),
    );
  }
  const out = compact(lines);
  return out.length >= 3 ? { lines: out, moves: { Nova: AT("inv_cio"), Sterling: AT("inv_wall"), Gemma: AT("inv_news"), Vince: AT("inv_struct") } } : null;
}

/* ── Investment committee: one company, five lines ──────────────────────── */

/** A figure in percentage points, one decimal — "2.3", registered. The word "points" is the caller's. */
const pts1 = (f: Ctx["f"], n: number): string => f.raw(Math.abs(n).toFixed(1));

export function exFirmMemo(c: Ctx, d: { inv: InvestLite }): Ex | null {
  const f = c.f;
  const m = d.inv.firm?.memo;
  if (!m) return null;
  const today = d.inv.dayKey;
  const lines: (Line | null)[] = [];
  // The chair opens: which company, why that one (the date picked it), and whether it is ours.
  lines.push(
    line(
      "Sterling",
      ANIM.Sterling.tablet!,
      pick(c, "firm-memo-open", [
        () => `Investment committee. Today's memo is ${m.name}, ${m.ticker}, picked by the date and not by merit. ${m.held ? "We hold it." : "We do not hold it."}`,
        () => `The committee reads one company a week, chosen by the date. This week it is ${m.name}, ${m.ticker}. ${m.held ? "The book holds it." : "The book does not hold it."}`,
      ]),
    ),
  );
  // Thesis — the scout, in the dossier's own words (with no dossier: the board's note, and the fact that the gate has not read the name).
  lines.push(
    line(
      "Jax",
      ANIM.Jax.point!,
      m.dossier && m.sells
        ? pick(c, "firm-memo-thesis", [() => `Thesis, in the dossier's words: ${f.raw(stop(sentencesWithin(m.sells!, 110)))}${m.moat ? ` Moat: ${f.raw(stop(sentencesWithin(m.moat, 100)))}` : ""}`])
        : pick(c, "firm-memo-thesis-board", [() => `There is no dossier, so the gate has not read it. The board's note on it: ${f.raw(stop(sentencesWithin(m.boardRole ?? "no note is written", 110)))}`]),
    ),
  );
  // Valuation — what the price asks next to what the company delivered, and the earnings yield against the ten-year, both dated.
  const parts: string[] = [];
  const asOf = f.raw(dateSay(m.fundamentalsAsOf ?? m.durabilityAsOf, today));
  if (m.required != null && m.delivered != null) {
    parts.push(
      `Valuation: at the price captured ${asOf} the market asks ${f.pct(m.required * 100, 1)} a year for ten years. The record is ${f.pct(m.delivered * 100, 1)}: it asks ${m.read === "asks-more" ? "more" : m.read === "asks-less" ? "less" : "about the same"}.`,
    );
  } else if (m.required != null) {
    parts.push(`Valuation: at the price captured ${asOf} the market asks ${f.pct(m.required * 100, 1)} a year for ten years. No delivered record is captured to set beside it.`);
  } else {
    parts.push("Valuation: there are no captured earnings, so the price cannot be turned into a growth rate.");
  }
  if (m.earningsYield != null && m.spreadPts != null && m.earningsYieldBasis) {
    parts.push(`Earnings yield ${f.pct(m.earningsYield * 100, 1)} ${m.earningsYieldBasis}, ${pts1(f, m.spreadPts)} points ${m.spreadPts < 0 ? "under" : "over"} the ${f.pct(m.riskFreePct, 2)} ten-year of ${f.raw(dateSay(m.riskFreeAsOf, today))}.`);
  }
  lines.push(line("Nova", ANIM.Nova.analyze!, parts.join(" ")));
  // Risks — what the dossier says could become law or what the numbers do not say, and whether the operator was checked against a filing.
  const risk = m.regulatory ?? (m.watch ? m.watch.reason : null) ?? m.caveat;
  const opSay = m.operator ? (m.operator.level === "verified" ? "The operator is verified against a filing." : m.operator.level === "asserted" ? "The operator is asserted, not verified, with no primary source attached." : "No operator is recorded.") : "";
  lines.push(
    line(
      "Gemma",
      ANIM.Gemma.explain!,
      risk
        ? pick(c, "firm-memo-risk", [() => `Risks on file: ${f.raw(stop(sentencesWithin(risk, 120)))} ${opSay}`.trim()])
        : pick(c, "firm-memo-risk-none", [() => `No written risk beyond the kill rule. ${opSay}`.trim()]),
    ),
  );
  // Catalysts — the next report inside two weeks on the committed calendar, the closest competitor the board names, and where it sits in the book.
  lines.push(
    line(
      "Vince",
      ANIM.Vince.watch!,
      pick(c, "firm-memo-cat", [
        () =>
          `${m.catalyst ? `Catalyst: it reports ${f.raw(dayPhrase(m.catalyst.date, today))} ${whenPhrase(m.catalyst.when)}.` : `No report inside two weeks on the calendar captured ${f.raw(dateSay(d.inv.catalystsAsOf, today))}.`}${m.competitor ? ` The board's closest competitor is ${m.competitor}.` : ""}${m.weight != null ? ` At cost it is ${pc1(f, m.weight)} of the book, look-through${m.maxWeight != null ? `, against the dossier's ceiling of ${f.frac(m.maxWeight)}` : ""}.` : ""}`,
      ]),
    ),
  );
  // Kill criteria, whole — a rule with two halves is never quoted as one — then the gate's state and the house wording.
  const kill = m.killRule ?? m.boardKill;
  lines.push(
    line(
      "Sterling",
      ANIM.Sterling.arms!,
      kill
        ? pick(c, "firm-memo-kill", [() => `Kill criteria, written before we owned anything. ${f.raw(stop(sentencesWithin(kill, 190)))}`])
        : pick(c, "firm-memo-nokill", [() => "No kill rule is written for it, which is itself a finding: the add gate needs one."]),
    ),
  );
  lines.push(
    line(
      "Sterling",
      ANIM.Sterling.tablet!,
      pick(c, "firm-memo-close", [
        () => `${m.watch ? "It is on watch, so the add gate refuses it. " : m.gate && !m.gate.canAdd ? "The add gate refuses it today. " : ""}None of this is a recommendation. The dossier and the Invest tab decide.`,
      ]),
    ),
  );
  const out = compact(lines);
  return out.length >= 5 ? { lines: out, moves: { Sterling: AT("board_chair"), Jax: AT("board_tv"), Nova: AT("board_north"), Gemma: AT("inv_news"), Vince: AT("board_tv2") } } : null;
}

/* ── The rates backdrop, next to the ten-year the dossiers were written against ── */

export function exFirmMacro(c: Ctx, d: { inv: InvestLite; pulse: { vix: number | null; tenYear: number | null; at: number | null } }): Ex | null {
  const f = c.f;
  const m = macroRead(d.inv.firm, d.pulse);
  if (!m) return null;
  const today = d.inv.dayKey;
  const gap = f.raw(Math.abs(m.deltaPts).toFixed(2));
  const lines: (Line | null)[] = [];
  lines.push(
    line(
      "Gemma",
      ANIM.Gemma.explain!,
      pick(c, "firm-macro-pulse", [
        () => `Rates backdrop for the long book. The ten-year is ${f.pct(m.liveTenPct, 2)}${m.vix != null ? ` and the vix ${f.raw(m.vix.toFixed(1))}` : ""}${d.pulse.at != null ? `, read at ${f.clock(d.pulse.at)} Eastern` : ""}. Context for the book, not a call.`,
        () => `Rates, for the long book only. The ten-year reads ${f.pct(m.liveTenPct, 2)}${m.vix != null ? `, the vix ${f.raw(m.vix.toFixed(1))}` : ""}${d.pulse.at != null ? `, as of ${f.clock(d.pulse.at)} Eastern` : ""}. It is context, not a call.`,
      ]),
    ),
  );
  lines.push(
    line(
      "Nova",
      ANIM.Nova.analyze!,
      pick(c, "firm-macro-then", [
        () =>
          m.deltaPts === 0
            ? `Every earnings-yield spread on the Invest tab is written against a ${f.pct(m.riskFreePct, 2)} ten-year, dated ${f.raw(dateSay(m.riskFreeAsOf, today))}. Today's is the same, so the spreads stand as written.`
            : `Every earnings-yield spread on the Invest tab is written against a ${f.pct(m.riskFreePct, 2)} ten-year, dated ${f.raw(dateSay(m.riskFreeAsOf, today))}. Today's is ${gap} points ${m.deltaPts < 0 ? "lower" : "higher"}, so each spread would read ${gap} points ${m.deltaPts < 0 ? "wider" : "narrower"}.`,
      ]),
    ),
  );
  if (m.name) {
    const n = m.name;
    lines.push(
      line(
        "Vince",
        ANIM.Vince.watch!,
        pick(c, "firm-macro-name", [
          () =>
            `Worked on today's memo name, ${n.ticker}: its ${n.basis} earnings yield is ${f.pct(n.eyPct, 1)}. Against the dated ten-year that is ${pts1(f, n.spreadThenPts)} points ${n.spreadThenPts < 0 ? "under" : "over"}; against today's it is ${pts1(f, n.spreadNowPts)} points ${n.spreadNowPts < 0 ? "under" : "over"}.`,
        ]),
      ),
    );
  }
  lines.push(
    line(
      "Sterling",
      ANIM.Sterling.arms!,
      pick(c, "firm-macro-rule", [
        () => "The dossiers keep their own dated ten-year, refreshed by capture and never from memory. A live yield here is context, and it moves no weight, no gate and no name.",
      ]),
    ),
  );
  const out = compact(lines);
  return out.length >= 3 ? { lines: out, moves: { Gemma: AT("inv_news"), Nova: AT("inv_cio"), Vince: AT("inv_struct"), Sterling: AT("inv_wall") } } : null;
}

/* ── The funnel and the long board ──────────────────────────────────────── */

export function exFirmBoard(c: Ctx, d: { inv: InvestLite }): Ex | null {
  const f = c.f;
  const b = d.inv.firm?.board;
  if (!b) return null;
  const today = d.inv.dayKey;
  const lines: (Line | null)[] = [];
  const first = b.split[0];
  lines.push(
    line(
      "Nova",
      ANIM.Nova.analyze!,
      pick(c, "firm-board-split", [
        () =>
          `The funnel splits what survives rent and the sleeve eight ways: ${list(b.split.map((s) => `${sleeveSay(s.sleeve)} ${f.frac(s.weight)}`))}.${b.waitingUsd > 0 && first ? ` On ${cash(f, b.waitingUsd)} waiting, safety would take ${cash(f, first.usd)}.` : " Nothing is waiting, so the split is a plan and not an order."}`,
        () => `Eight sleeves share whatever survives rent and the sleeve: ${list(b.split.map((s) => `${sleeveSay(s.sleeve)} ${f.frac(s.weight)}`))}.${b.waitingUsd > 0 && first ? ` Of ${cash(f, b.waitingUsd)} waiting, safety's share is ${cash(f, first.usd)}.` : " With nothing waiting, this is a plan, not an order."}`,
      ]),
    ),
  );
  // The four biggest slices (stable on ties); the rest follow the same rule and are on the funnel TV.
  const named = b.split.map((s, i) => ({ s, i })).filter((x) => x.s.ticker).sort((a, z) => z.s.weight - a.s.weight || a.i - z.i).slice(0, 4).map((x) => x.s);
  lines.push(
    line(
      "Vince",
      ANIM.Vince.watch!,
      named.length
        ? pick(c, "firm-board-next", [
            () => `The next name in a sleeve is the first not banned, a pass before a wait. The biggest four: ${list(named.map((s) => `${s.ticker} in ${sleeveSay(s.sleeve)}`))}. That is the board's order, not a pick.`,
          ])
        : null,
    ),
  );
  const why = b.reasons[0];
  lines.push(
    line(
      "Gemma",
      ANIM.Gemma.explain!,
      pick(c, "firm-board-counts", [
        () =>
          `Of ${f.int(b.counts.total)} names on the long board, ${f.int(b.counts.pass)} ${plural(b.counts.pass, "passes", "pass")}, ${f.int(b.counts.wait)} ${plural(b.counts.wait, "waits", "wait")} and ${f.int(b.counts.fail)} ${plural(b.counts.fail, "fails", "fail")}.${why ? ` The reason most wait, ${f.int(why.n)} of them: ${f.raw(stop(clip(why.reason, 80)))}` : ""}`,
      ]),
    ),
  );
  const left = rot(`${d.inv.dayKey}|leftoff`, b.leftOff);
  lines.push(
    line(
      "Sterling",
      ANIM.Sterling.tablet!,
      left
        ? pick(c, "firm-board-left", [() => `A pass does not buy, and the board places no order. Researched and left off on purpose: ${left.area}. ${f.raw(stop(sentencesWithin(left.why, 100)))}`])
        : pick(c, "firm-board-nobuy", [() => "A pass does not buy, and the board places no order."]),
    ),
  );
  const lock = b.ipo.priced[0];
  const next = b.ipo.nextUpcoming;
  lines.push(
    line(
      "Jax",
      ANIM.Jax.point!,
      lock
        ? pick(c, "firm-board-ipo", [
            () =>
              `IPO watch, captured ${f.raw(dateSay(b.ipo.capturedAt, today))}. The rule: not at the offer, not before the lock-up ends, not before four public quarters. ${lock.ticker} ${lock.stage === "lockup" && lock.lockupEnds ? `has a lock-up that ends ${f.raw(dateSay(lock.lockupEnds, today))}` : lock.eligibleFrom ? `can be researched from ${f.raw(dateSay(lock.eligibleFrom, today))}` : "is still waiting"}${lock.onBoard ? ", and it starts on watch on our board" : ""}.`,
          ])
        : next
          ? pick(c, "firm-board-ipo-up", [
              () => `IPO watch, captured ${f.raw(dateSay(b.ipo.capturedAt, today))}: ${f.int(b.ipo.upcoming)} on the upcoming list, the nearest ${next.company}. The rule is no buy at the offer, none before the lock-up ends, none before four public quarters.`,
            ])
          : null,
    ),
  );
  const out = compact(lines);
  return out.length >= 3 ? { lines: out, moves: { Nova: AT("board_north"), Vince: AT("board_tv2"), Gemma: AT("inv_news"), Sterling: AT("board_chair"), Jax: AT("board_tv") } } : null;
}

/* ── Policy and evidence ────────────────────────────────────────────────── */

export function exFirmPolicy(c: Ctx, d: { inv: InvestLite }): Ex | null {
  const f = c.f;
  const p = d.inv.firm?.policy;
  if (!p) return null;
  const lines: (Line | null)[] = [];
  const hz = (h: string) => p.horizons.find((x) => x.horizon === h);
  const [short, mid, long] = [hz("short"), hz("mid"), hz("long")];
  if (short && mid && long) {
    lines.push(
      line(
        "Sterling",
        ANIM.Sterling.tablet!,
        pick(c, "firm-pol-horizon", [() => `Policy, what the tab says it can know. Short horizon: ${f.raw(stop(short.say))} Mid horizon: ${f.raw(stop(mid.say))} Long horizon: ${f.raw(stop(long.say))}`, () => `Before anyone opens a dossier, the tab says what it can know. Short: ${f.raw(stop(short.say))} Mid: ${f.raw(stop(mid.say))} Long: ${f.raw(stop(long.say))}`]),
      ),
    );
  }
  const persist = p.baseRates.find((b) => b.id === "growth-persistence");
  if (persist) {
    lines.push(line("Gemma", ANIM.Gemma.explain!, pick(c, "firm-pol-persist", [() => `Growth does not persist beyond chance. ${f.raw(stop(persist.say))}`])));
    lines.push(line("Nova", ANIM.Nova.analyze!, pick(c, "firm-pol-assumes", [() => `So the price already assumes a growth rate. ${f.raw(stop(persist.soWhat))}`])));
  }
  const others = p.baseRates.filter((b) => b.id !== "growth-persistence");
  const other = rot(`${d.inv.dayKey}|baserate`, others);
  if (other) lines.push(line("Jax", ANIM.Jax.point!, pick(c, "firm-pol-base", [() => `Another base rate on the tab: ${f.raw(stop(other.say))}`])));
  const trap = rot(`${d.inv.dayKey}|trap`, p.traps);
  if (trap) lines.push(line("Vince", ANIM.Vince.watch!, pick(c, "firm-pol-trap", [() => `The tab also keeps a staleness trap on ${trap.ticker}. ${f.raw(stop(trap.lesson))}`])));
  const out = compact(lines);
  return out.length >= 3 ? { lines: out, moves: { Sterling: AT("board_chair"), Gemma: AT("board_north"), Nova: AT("inv_cio"), Jax: AT("board_tv"), Vince: AT("board_tv2") } } : null;
}

/* ── Data freshness: said only when the stalest snapshot has aged out ───── */

export function exFirmFresh(c: Ctx, d: { inv: InvestLite }): Ex | null {
  const f = c.f;
  const x = d.inv.firm?.fresh;
  if (!x || !x.stale || !x.stalest) return null;
  const today = d.inv.dayKey;
  const s = x.stalest;
  const lines: (Line | null)[] = [
    line(
      "Gemma",
      ANIM.Gemma.explain!,
      pick(c, "firm-fresh-open", [
        () => `Data freshness. The stalest snapshot the Invest tab reads is the ${s.label}, captured ${f.raw(dateSay(s.asOf, today))}, ${f.int(s.ageDays)} days ago. The line the long board draws is ${f.int(x.maxDays)}.`,
        () => `A snapshot has aged out. The ${s.label}, captured ${f.raw(dateSay(s.asOf, today))}, is ${f.int(s.ageDays)} days old, and the board's own line is ${f.int(x.maxDays)}.`,
      ]),
    ),
    line("Vince", ANIM.Vince.watch!, pick(c, `firm-fresh-effect-${s.id}`, [() => FRESH_EFFECT[s.id] ?? "Every figure drawn from that snapshot is that old."])),
    line("Sterling", ANIM.Sterling.tablet!, pick(c, "firm-fresh-fix", [() => "The refresh is a capture run on purpose, never a poll. Until it runs, the figures are quoted with their dates."])),
  ];
  const out = compact(lines);
  return out.length >= 2 ? { lines: out, moves: { Gemma: AT("inv_news"), Vince: AT("inv_struct"), Sterling: AT("chair_desk") } } : null;
}
