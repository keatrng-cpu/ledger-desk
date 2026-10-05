/**
 * What the five say when the room is on the long game — in whose voice.
 *
 * Same rules as live-voices.ts: fixed phrase banks, one builder per kind of event, every number through `Facts` as it is
 * printed (the verifier requires each digit in a line to have been registered by code — so no digit is ever typed into a
 * phrase), and a bank with nothing new to say drops the line instead of repeating it. The builders are handed numbers that
 * invest-office.ts already computed from the Invest tab's own functions and the dated research file; they decide the WORDS
 * and never the facts. Narration only: nothing here buys, sells, sizes or changes a sleeve target.
 *
 * Whoever speaks in the investment wing has to be standing in it: the moves are `ANNEX` spots (presentation-only, so any of
 * the five may go) and they follow the lines.
 *
 *   Sterling  the chair: the order of operations, the agenda, whose call it is, the minutes.
 *   Nova      the arithmetic: the ladder, the sleeves, the contribution path, the other income.
 *   Jax       the scout: what demand is doing, what is new, the high tier's honesty.
 *   Gemma     the news and the evidence: which headline touches a name, how good the evidence is, the risk.
 *   Vince     the structure: who competes, which vehicles, what the next dollar buys.
 */

import { BOOK_MEANINGFUL_USD } from "@/lib/invest/book";
import type { Sleeve } from "@/lib/invest/universe";
import { ANIM, type InvestCatalyst, type InvestLite, type InvestThemeLite, type Line, type NewsLite, type TalkMove } from "./live-types";
import { clip, compact, line, NEUTRAL, pick, type Ctx, type Ex } from "./live-voices";
import { boardAgenda, dayPhrase, freshCatalysts, themeOfTheDay, tierCoverage, whenPhrase } from "./invest-read";

const AT = (spot: string): TalkMove => ({ zone: "ANNEX", spot });
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const stop = (t: string): string => (/[.!?…]$/.test(t) ? t : `${t}.`);
/** Recorded dollars as they are: with cents when they have cents (a swept $240.50 is never read as $241), whole otherwise. Projections stay whole dollars. */
const cash = (f: Ctx["f"], n: number): string => f.usd(n, Number.isInteger(n) ? 0 : 2);
const list = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/* ── The funnel: day trading and other income into the long book ───────── */

export function exInvFunnel(c: Ctx, d: { inv: InvestLite }): Ex | null {
  const f = c.f;
  const { funnel, next, other } = d.inv;
  const m = funnel.closedMonths;
  const lines: (Line | null)[] = [];
  lines.push(
    line(
      "Nova",
      ANIM.Nova.analyze!,
      m === 0
        ? pick(c, "inv-funnel-open", [
            () => "No month is logged yet. The funnel opens the first month that closes above the data rent.",
            () => "The sweep log is empty. Nothing flows into the long book until a month closes above the data rent.",
          ])
        : pick(c, "inv-funnel-rate", [
            () => `Sweep rate ${f.pct(funnel.ratePct)} on ${f.int(m)} closed ${plural(m, "month", "months")}. ${cash(f, funnel.sweptUsd)} swept so far, ${cash(f, funnel.waitingUsd)} not bought yet.`,
            () => `The ladder stands at ${f.pct(funnel.ratePct)} after ${f.int(m)} logged ${plural(m, "month", "months")}: ${cash(f, funnel.sweptUsd)} in, ${cash(f, funnel.waitingUsd)} still waiting to land.`,
          ]),
    ),
  );
  lines.push(
    line(
      "Sterling",
      NEUTRAL.Sterling,
      pick(c, "inv-funnel-order", [
        () => "The order never changes: data rent, then the sleeve, then the split. A swept dollar does not go back.",
        () => "Rent first, the options sleeve second, the split third — and what is swept stays swept.",
      ]),
    ),
  );
  if (funnel.avgMonthlyUsd != null && funnel.fiveYearUsd != null && funnel.tenYearUsd != null) {
    lines.push(
      line(
        "Nova",
        ANIM.Nova.write!,
        pick(c, "inv-funnel-path", [
          () => `At the logged average of ${cash(f, funnel.avgMonthlyUsd!)} a month: ${f.usd(funnel.fiveYearUsd!)} in five years, ${f.usd(funnel.tenYearUsd!)} in ten. Contributions only — no return assumed.`,
          () => `Average sweep ${cash(f, funnel.avgMonthlyUsd!)} a month. Five years of that is ${f.usd(funnel.fiveYearUsd!)}, ten is ${f.usd(funnel.tenYearUsd!)} — before any return, which this arithmetic does not assume.`,
        ]),
      ),
    );
  }
  if (other) {
    const add = (other.monthlyUsd * other.ratePct) / 100;
    lines.push(
      line(
        "Nova",
        ANIM.Nova.nod!,
        pick(c, "inv-funnel-other", [
          () => `Other income: ${cash(f, other.monthlyUsd)} a month at ${f.raw(`${other.ratePct}%`)} puts ${cash(f, add)} a month into the same funnel.`,
        ]),
      ),
    );
  } else {
    lines.push(
      line(
        "Sterling",
        ANIM.Sterling.arms!,
        pick(c, "inv-funnel-noother", [
          () => "Income that isn't day-trading P&L has no line in the funnel yet. Enter it in the office panel — the percentage is the trader's call, not ours.",
        ]),
      ),
    );
  }
  if (next) lines.push(line("Vince", ANIM.Vince.watch!, pick(c, "inv-funnel-next", [() => `Next dollar: ${f.raw(clip(next.line, 150))}`])));
  const out = compact(lines);
  return out.length ? { lines: out, moves: { Nova: AT("inv_cio"), Vince: AT("inv_struct"), Sterling: AT("inv_wall") } } : null;
}

/* ── The book: sleeves, drift, and which research tiers it covers ──────── */

export function exInvBook(c: Ctx, d: { inv: InvestLite }): Ex | null {
  const f = c.f;
  const { book } = d.inv;
  const cov = tierCoverage(d.inv);
  const sl = (s: Sleeve) => book.sleeves.find((x) => x.sleeve === s);
  const lines: (Line | null)[] = [];
  if (book.positions === 0) {
    lines.push(
      line(
        "Nova",
        ANIM.Nova.analyze!,
        pick(c, "inv-book-empty", [
          () => "The long book holds nothing yet. The first shares come from the first sweep, and the first sweep goes to ballast.",
          () => "No positions in the long book. That is fine — ballast first, funded by the sweep.",
        ]),
      ),
    );
  } else if (book.belowMeaningful) {
    lines.push(
      line(
        "Nova",
        ANIM.Nova.analyze!,
        pick(c, "inv-book-small", [
          () => `The long book is ${cash(f, book.totalUsd)} at cost. Under ${f.usd(BOOK_MEANINGFUL_USD)} the weights are arithmetic, not allocation — no sleeve target binds yet.`,
        ]),
      ),
    );
  } else {
    const b = sl("ballast");
    const k = sl("compounder");
    const p = sl("drypowder");
    if (b && k && p) {
      lines.push(
        line(
          "Nova",
          ANIM.Nova.write!,
          pick(c, "inv-book-sleeves", [
            () => `At cost, by sleeve: ballast ${f.frac(b.weight)}, compounders ${f.frac(k.weight)}, dry powder ${f.frac(p.weight)}. Targets are ${f.frac(b.target)}, ${f.frac(k.target)} and ${f.frac(p.target)}.`,
          ]),
        ),
      );
    }
  }
  lines.push(
    line(
      "Sterling",
      NEUTRAL.Sterling,
      book.beyondBand > 0
        ? pick(c, "inv-book-drift", [
            () => `${f.int(book.beyondBand)} ${plural(book.beyondBand, "sleeve is", "sleeves are")} past the ${f.frac(book.driftBand)} band. The rule: point the next sweep at the light sleeve before selling anything.`,
          ])
        : book.positions === 0 || book.belowMeaningful
          ? pick(c, "inv-book-habit", [() => "Habit first: ballast, then dry powder, then a company only through a dossier."])
          : pick(c, "inv-book-inband", [() => "Every sleeve is inside the band. Nothing to do, which is also a decision."]),
    ),
  );
  const [safe, mid, high] = cov;
  if (safe && mid && high && d.inv.themes.length) {
    lines.push(
      line(
        "Vince",
        ANIM.Vince.watch!,
        pick(c, "inv-book-cover", [
          () => `Research coverage: safe ${f.int(safe.covered)} of ${f.int(safe.themes)} themes held, mid ${f.int(mid.covered)} of ${f.int(mid.themes)}, high ${f.int(high.covered)} of ${f.int(high.themes)}.`,
        ]),
      ),
    );
    lines.push(
      line(
        "Jax",
        ANIM.Jax.point!,
        high.covered === 0
          ? pick(c, "inv-book-nohigh", [() => "Nothing in the high tier. The sleeve targets allow that — it's a choice, not a gap to hurry."])
          : pick(c, "inv-book-high", [() => "There's high-tier exposure in the book. Small and slow: it's where a decade's winners and a decade's zeros both live."]),
      ),
    );
  }
  const out = compact(lines);
  return out.length ? { lines: out, moves: { Nova: AT("inv_cio"), Vince: AT("inv_struct"), Sterling: AT("inv_wall"), Jax: AT("inv_scout") } } : null;
}

/* ── The theme of the day: demand, what's new, who competes, the risk ──── */

export function exInvTheme(c: Ctx, d: { inv: InvestLite; theme: InvestThemeLite }): Ex | null {
  const f = c.f;
  const t = d.theme;
  const dm = t.demand[0];
  if (!dm) return null;
  const lines: (Line | null)[] = [];
  lines.push(
    line(
      "Jax",
      ANIM.Jax.point!,
      pick(c, "inv-theme-demand", [
        () => `${f.raw(t.name)}, ${t.tier} tier. ${f.raw(stop(clip(dm.claim, 110)))}`,
        () => `Demand check on ${f.raw(t.name)}, ${t.tier} tier: ${f.raw(stop(clip(dm.claim, 100)))}`,
      ]),
    ),
  );
  // The figure is a third party's and is never shortened: it is quoted whole, with its source and its date.
  lines.push(
    line(
      "Gemma",
      ANIM.Gemma.explain!,
      pick(c, "inv-theme-figure", [
        () => `The figure: ${f.raw(dm.figure)} — ${f.raw(dm.sourceName)}, ${f.raw(dm.asOf)}.`,
        () => `${f.raw(dm.figure)}, per ${f.raw(dm.sourceName)}, ${f.raw(dm.asOf)}.`,
      ]),
    ),
  );
  const inn = t.innovations.slice(0, 2).map((x) => clip(x, 70));
  if (inn.length) lines.push(line("Jax", ANIM.Jax.type!, pick(c, "inv-theme-inn", [() => `What's new behind it: ${f.raw(stop(inn.join("; ")))}`])));
  const comps = t.competitors.slice(0, 4).map((x) => (x.ticker ? `${x.name} (${x.ticker})` : x.name));
  const first = t.competitors[0];
  if (comps.length && first) {
    lines.push(line("Vince", ANIM.Vince.watch!, pick(c, "inv-theme-comp", [() => `Who competes: ${f.raw(list(comps))}. ${f.raw(stop(clip(first.angle, 90)))}`])));
  }
  lines.push(
    line(
      "Gemma",
      ANIM.Gemma.explain!,
      pick(c, "inv-theme-risk", [
        () => `Evidence here is ${t.evidence}, on a ${t.horizon === "long" ? "long" : "mid-term"} horizon. The risk to watch: ${f.raw(stop(clip(t.risks[0] ?? "the demand case is not proven", 100)))}`,
      ]),
    ),
  );
  const veh = t.vehicles.slice(0, 3).map((v) => v.ticker);
  lines.push(
    line(
      "Sterling",
      ANIM.Sterling.tablet!,
      pick(c, "inv-theme-chair", [
        () => "Research, not a position. A name only enters the book through a dossier and the ADD gate.",
        () => `Vehicles on the table: ${f.raw(list(veh))}. None is a recommendation — the dossier gate decides, and the wash-sale list still applies.`,
      ]),
    ),
  );
  const out = compact(lines);
  return out.length ? { lines: out, moves: { Jax: AT("board_tv"), Vince: AT("board_tv2"), Gemma: AT("board_north"), Sterling: AT("board_chair") } } : null;
}

/* ── A headline that touches a name in the book or a theme on the list ─── */

export function exInvNews(c: Ctx, d: { inv: InvestLite; n: NewsLite; hit: { key: string; label: string; kind: "held" | "theme" | "competitor" } }): Ex | null {
  const f = c.f;
  const { n, hit } = d;
  const touch = hit.kind === "held" ? `a name in the book, ${hit.label}` : hit.kind === "theme" ? `the ${hit.label} theme` : `${hit.label}, a competitor on the research list`;
  const lines: (Line | null)[] = [];
  lines.push(
    line(
      "Gemma",
      ANIM.Gemma.explain!,
      pick(c, "inv-news-head", [
        () => `${f.raw(n.source)}: “${f.raw(clip(n.title, 96))}” — it touches ${f.raw(touch)}.`,
        () => `On the wire from ${f.raw(n.source)}: “${f.raw(clip(n.title, 90))}”. That's ${f.raw(touch)}.`,
      ]),
    ),
  );
  lines.push(
    line(
      "Vince",
      ANIM.Vince.watch!,
      hit.kind === "held"
        ? pick(c, "inv-news-held", [() => "It's in the book, so the weekly kill-rule check reads it. A headline alone doesn't make a verdict."])
        : pick(c, "inv-news-map", [() => "Context for the competitor map, not a signal. The dossier's kill rules are what a headline can move."]),
    ),
  );
  lines.push(line("Sterling", ANIM.Sterling.arms!, pick(c, "inv-news-chair", [() => "Noted. Nothing changes today: long-term moves come from the dossier and the sweep, not from a headline."])));
  const out = compact(lines);
  return out.length ? { lines: out, moves: { Gemma: AT("inv_news"), Vince: AT("inv_struct"), Sterling: AT("board_chair") } } : null;
}

/* ── The board: the evening agenda and the minutes ─────────────────────── */

export function exInvBoard(c: Ctx, d: { inv: InvestLite }): Ex | null {
  const f = c.f;
  const { inv } = d;
  const items = boardAgenda(inv).map((a) =>
    a.kind === "waiting" ? `${cash(f, a.usd ?? 0)} swept and not yet bought` : a.kind === "rebalance" ? "a sleeve past its band" : a.kind === "drift" ? "drift too small to trade" : "a book under the meaningful line",
  );
  const lines: (Line | null)[] = [];
  lines.push(
    line(
      "Sterling",
      ANIM.Sterling.tablet!,
      items.length
        ? pick(c, "inv-board-open", [
            () => `Board is in session. ${f.int(items.length)} ${plural(items.length, "item", "items")} on the agenda: ${f.raw(list(items))}.`,
          ])
        : pick(c, "inv-board-empty", [() => "Board is in session. Nothing on the agenda — the plan stands."]),
    ),
  );
  if (inv.next) lines.push(line("Nova", ANIM.Nova.write!, pick(c, "inv-board-next", [() => `For the minutes: ${f.raw(clip(inv.next!.line, 140))}`])));
  const t = themeOfTheDay(inv);
  if (t) {
    lines.push(
      line(
        "Jax",
        ANIM.Jax.point!,
        pick(c, "inv-board-theme", [() => `Theme for the minutes: ${f.raw(t.name)}, ${t.tier} tier, evidence ${t.evidence}.`]),
      ),
    );
  }
  lines.push(
    line(
      "Vince",
      ANIM.Vince.thumbs!,
      pick(c, "inv-board-minutes", [
        () => "Minutes: no order is placed from this room. Orders live in the Invest tab, one dossier at a time.",
        () => "Recorded. This room reads the book and the research; it never buys or sells.",
      ]),
    ),
  );
  const out = compact(lines);
  return out.length ? { lines: out, moves: { Sterling: AT("board_chair"), Nova: AT("board_north"), Jax: AT("board_tv"), Vince: AT("board_tv2") } } : null;
}

/* ── The calendar: reports that touch a name we hold or compete with ───── */

/**
 * What the office does with a date: names the report, says why it matters to THIS book (held, a theme's vehicle, a competitor),
 * hands over the trader's own pre-written kill rule when the name has a dossier, and says whose dates these are and how old.
 * A date is context — the line never says what to do about it.
 */
export function exInvCatalysts(c: Ctx, d: { inv: InvestLite }): Ex | null {
  const f = c.f;
  const { inv } = d;
  const today = inv.dayKey;
  const cats = freshCatalysts(inv);
  if (!cats.length) return null;
  const lead: InvestCatalyst = cats.find((x) => x.why === "held") ?? cats[0]!;
  const rest = cats.filter((x) => x !== lead);
  const at = (x: InvestCatalyst) => `${f.raw(dayPhrase(x.date, today))} ${whenPhrase(x.when)}`;
  const lines: (Line | null)[] = [];
  lines.push(
    line(
      "Gemma",
      ANIM.Gemma.explain!,
      pick(c, "inv-cat-lead", [
        () => `On the calendar: ${f.raw(lead.name)} (${lead.ticker}) reports ${at(lead)}.`,
        () => `${lead.ticker} is next on our list — ${f.raw(lead.name)} reports ${at(lead)}.`,
      ]),
    ),
  );
  lines.push(
    line(
      "Vince",
      ANIM.Vince.watch!,
      lead.why === "held"
        ? pick(c, "inv-cat-held", [() => (lead.theme ? `We hold ${lead.ticker}, and it sits in the ${f.raw(lead.theme)} theme.` : `We hold ${lead.ticker}.`)])
        : lead.why === "theme"
          ? pick(c, "inv-cat-theme", [() => `${lead.ticker} is a vehicle in the ${f.raw(lead.theme ?? "research")} theme — we do not hold it.`])
          : pick(c, "inv-cat-comp", [() => `${lead.ticker} competes in the ${f.raw(lead.theme ?? "research")} theme. Context for the map, not a position.`]),
    ),
  );
  lines.push(
    line(
      "Sterling",
      ANIM.Sterling.tablet!,
      lead.killRule
        ? pick(c, "inv-cat-kill", [() => `Its kill rule, written before we owned it: ${f.raw(stop(clip(lead.killRule!, 95)))} Read the report against that, not the price reaction.`])
        : pick(c, "inv-cat-nokill", [() => "A date is not a signal. Nothing changes until a dossier and its kill rule say so."]),
    ),
  );
  if (rest.length) {
    const names = rest.slice(0, 3).map((x) => `${x.ticker} ${dayPhrase(x.date, today)}`);
    lines.push(
      line(
        "Nova",
        ANIM.Nova.write!,
        pick(c, "inv-cat-more", [
          () => `${f.int(rest.length)} more on the list inside two weeks: ${f.raw(list(names))}${rest.length > 3 ? ` and ${f.int(rest.length - 3)} others` : ""}.`,
        ]),
      ),
    );
  }
  lines.push(
    line(
      "Gemma",
      ANIM.Gemma.explain!,
      pick(c, "inv-cat-asof", [
        () => `Those dates are Alpha Vantage's as of ${f.raw(inv.catalystsAsOf)}. Past two weeks out they are provisional until the company confirms.`,
      ]),
    ),
  );
  const out = compact(lines);
  return out.length ? { lines: out, moves: { Gemma: AT("inv_news"), Vince: AT("inv_struct"), Sterling: AT("inv_wall"), Nova: AT("inv_cio") } } : null;
}
