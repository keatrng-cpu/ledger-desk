/**
 * Discipline, measured — the part of the record that is about the CLICK, not
 * the setup.
 *
 * WHY THIS EXISTS
 * The trader's own diagnosis: "the desk seems consistent with knowing the
 * direction and targets, the main problem seems to be my discipline and
 * entries." A journal that only stores entry, exit and P&L cannot say
 * anything about that. It can say a trade lost; it cannot say it lost
 * BECAUSE the stop was moved, or that every chased entry in the book
 * together cost more than every setup earned.
 *
 * What moves execution discipline, on the evidence the research found
 * (2026-09-25 brief): monitoring written down at the moment (Harkin et al.
 * 2016, 138 studies, d≈0.40), a fixed mistake vocabulary priced in money,
 * and an adherence split — rule-following trades vs rule-breaking trades,
 * side by side, each with its own P&L. What does NOT: badges, streaks and
 * composite scores, which raise trading volume without raising results
 * (Chapkovski et al.). So this module prices; it never awards.
 *
 * A FIXED VOCABULARY, on purpose. Free-text mistakes cannot be counted, and
 * a mistake that cannot be counted cannot be priced. Every tag names the
 * desk rule it breaks, so the scorecard reads as "this rule cost you $X",
 * which is a sentence a trader can act on.
 */

export const MISTAKE_TAGS = [
  { id: "chased", label: "Chased the print", rule: "Rest the limit at CE — never pay the print" },
  { id: "late", label: "Entered late", rule: "FORMING (>1 ATR from the array) means look away" },
  { id: "no_plan", label: "No priced plan", rule: "No entry array and stop, no trade" },
  { id: "moved_stop", label: "Moved the stop", rule: "The stop is the plan's invalidation — it only moves to BE at T1" },
  { id: "early_exit", label: "Exited early", rule: "50% at T1, stop to BE, runner to T2 — do not protect earlier" },
  { id: "oversize", label: "Oversized", rule: "Risk by grade; A+ is a 2% probe until earned" },
  { id: "revenge", label: "Revenge / tilt", rule: "After a loss the next click needs the same full sequence" },
  { id: "hesitated", label: "Hesitated", rule: "The limit decides once — a half-size or late click is a different trade" },
  { id: "news", label: "Traded the release", rule: "High-impact ±15m blackout" },
  { id: "second_book", label: "Second book, same bias", rule: "One book a day — MNQ or ES" },
] as const;

export type MistakeTag = (typeof MISTAKE_TAGS)[number]["id"];
export const MISTAKE_IDS = MISTAKE_TAGS.map((m) => m.id) as [MistakeTag, ...MistakeTag[]];

export const EXIT_REASONS = [
  { id: "t1_runner", label: "T1 then runner (the rule)" },
  { id: "t2", label: "Runner hit T2" },
  { id: "stop", label: "Stopped at the plan's stop" },
  { id: "be", label: "Runner stopped at breakeven" },
  { id: "discretionary", label: "Discretionary exit" },
  { id: "time", label: "Time / session close" },
] as const;

export type ExitReason = (typeof EXIT_REASONS)[number]["id"];
export const EXIT_REASON_IDS = EXIT_REASONS.map((e) => e.id) as [ExitReason, ...ExitReason[]];

/**
 * Pre-click state, one tap. Lo, Repin & Steenbarger (2005): traders with more
 * intense emotional reactions to gains AND losses did measurably worse. The
 * scale is deliberately coarse — a rating that takes thought is a rating that
 * does not get entered at 09:52.
 */
export const STATE_SCALE = [
  { v: 1, label: "Calm" },
  { v: 2, label: "Focused" },
  { v: 3, label: "Neutral" },
  { v: 4, label: "Impatient" },
  { v: 5, label: "Tilted" },
] as const;

export interface DisciplineRow {
  status: "open" | "closed";
  pnl: number | null;
  r: number | null;
  mistakes?: string[] | null;
  override?: boolean | null;
  deskWord?: string | null;
  stateRating?: number | null;
}

export interface Split {
  n: number;
  pnl: number;
  avgR: number | null;
  winRate: number | null;
}

function split(rows: DisciplineRow[]): Split {
  const n = rows.length;
  const pnl = rows.reduce((s, r) => s + (r.pnl ?? 0), 0);
  const rs = rows.map((r) => r.r).filter((x): x is number => x != null && Number.isFinite(x));
  return {
    n,
    pnl: Math.round(pnl * 100) / 100,
    avgR: rs.length ? Math.round((rs.reduce((s, x) => s + x, 0) / rs.length) * 100) / 100 : null,
    winRate: n ? rows.filter((r) => (r.pnl ?? 0) > 0).length / n : null,
  };
}

/** Below this, a split is a direction, not a rate — and the copy says so. */
export const MIN_READ = 12;

export interface DisciplineScorecard {
  closed: number;
  followed: Split;
  broken: Split;
  /** Share of closed trades with no mistake tag and no override. Null at n=0. */
  adherence: number | null;
  byMistake: (Split & { id: string; label: string; rule: string })[];
  byWord: (Split & { word: string })[];
  byState: (Split & { v: number; label: string })[];
  lines: string[];
}

/**
 * The scorecard. Pure — callers pass the rows they have (Postgres live
 * trades), and nothing here reads a network or a clock.
 */
export function disciplineScorecard(rows: DisciplineRow[]): DisciplineScorecard {
  const closed = rows.filter((r) => r.status === "closed" && r.pnl != null);
  const isBroken = (r: DisciplineRow) => (r.mistakes?.length ?? 0) > 0 || r.override === true;
  const followed = split(closed.filter((r) => !isBroken(r)));
  const broken = split(closed.filter(isBroken));

  const byMistake = MISTAKE_TAGS.map((m) => ({
    id: m.id as string,
    label: m.label as string,
    rule: m.rule as string,
    ...split(closed.filter((r) => r.mistakes?.includes(m.id))),
  }))
    .filter((m) => m.n > 0)
    .sort((a, b) => a.pnl - b.pnl);

  const byWord = ["TAKE", "WAIT", "STAND"]
    .map((w) => ({ word: w, ...split(closed.filter((r) => (r.deskWord ?? "").toUpperCase() === w)) }))
    .filter((w) => w.n > 0);

  const byState = STATE_SCALE.map((s) => ({
    v: s.v as number,
    label: s.label as string,
    ...split(closed.filter((r) => r.stateRating === s.v)),
  })).filter((s) => s.n > 0);

  const money = (x: number) => `${x >= 0 ? "+" : "−"}$${Math.abs(Math.round(x)).toLocaleString()}`;
  const lines: string[] = [];
  if (!closed.length) {
    lines.push(
      "No closed real fills yet. Every trade — especially the ones taken against the desk — gets logged with its fill, its mistakes and the desk's word at the time. That record is the only thing that can tell a mis-tuned gate from a discipline leak.",
    );
  } else {
    lines.push(
      `Rules followed: ${followed.n} trade${followed.n === 1 ? "" : "s"}, ${money(followed.pnl)}. Rules broken: ${broken.n}, ${money(broken.pnl)}.` +
        (closed.length < MIN_READ ? ` n=${closed.length} — a direction, not a rate.` : ""),
    );
    const worst = byMistake[0];
    if (worst && worst.pnl < 0) {
      lines.push(`Costliest habit: ${worst.label.toLowerCase()} — ${worst.n}×, ${money(worst.pnl)}. The rule it breaks: ${worst.rule}.`);
    }
    const hot = byState.filter((s) => s.v >= 4);
    const cool = byState.filter((s) => s.v <= 2);
    if (hot.length && cool.length) {
      const h = split(closed.filter((r) => (r.stateRating ?? 0) >= 4));
      const c = split(closed.filter((r) => (r.stateRating ?? 9) <= 2));
      lines.push(
        `Impatient/tilted clicks: ${h.n}, ${money(h.pnl)}; calm/focused: ${c.n}, ${money(c.pnl)}.` +
          (h.n + c.n < MIN_READ ? " Too few to read yet." : ""),
      );
    }
  }
  return {
    closed: closed.length,
    followed,
    broken,
    adherence: closed.length ? followed.n / closed.length : null,
    byMistake,
    byWord,
    byState,
    lines,
  };
}
