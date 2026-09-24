/**
 * Turn a pasted daily trade note into a real record.
 *
 * WHY THIS EXISTS
 * Everything built on this desk in the last two days — setup-memory,
 * override-log, target-odds, sleeve-sizing — is instrumentation with nothing
 * in it. The binding constraint is not another model, it is that five live
 * trades exist and none of them are written down in a form anything can read.
 * The trader has offered to log every option daily. This is the intake.
 *
 * WHAT IT DERIVES RATHER THAN ASKS FOR
 * The format asks only for facts the trader knows at the desk. Everything
 * else is computed, because a field a human has to calculate is a field that
 * eventually gets guessed:
 *   - debit from premium x contracts x 100, if not stated
 *   - R against the 15%-of-debit brake, which is the real risk unit
 *   - rule violations via sleeve-sizing.ts
 *   - the ATTRIBUTION — why it worked or did not — via setup-memory.ts, from
 *     expectation versus print, never from the note
 *
 * THE NOTE IS STORED BUT NEVER TRUSTED
 * `why:` is kept beside the derived attribution, flagged by whether it was
 * written before the outcome was known. A reason written after the close is a
 * story about a result; this keeps both and never lets the story win.
 *
 * Usage:
 *   npx tsx scripts/log-trade.mjs path/to/note.txt
 *   npx tsx scripts/log-trade.mjs --template        (prints a blank note)
 *   npx tsx scripts/log-trade.mjs --show            (prints the log so far)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const LOG = "src/data/trade-log.json";

const TEMPLATE = `# One block per trade. Delete what does not apply; blanks are fine.
# Anything you do not know, leave empty — an empty field is honest, a guessed one is not.

date:         2026-09-23
time_et:      09:52
book:         options          # options | futures
symbol:       MNQ              # the futures read this expressed
side:         short            # short | long

underlier:    QQQ
contract:     600P 9/24
premium:      1.50             # per contract, dollars per share
contracts:    2
debit:                         # total $ — leave blank to derive from premium x contracts
dte:          1
delta:        0.45

plan_entry:   30886.25         # the level the DESK named
plan_stop:    30930.00
plan_t1:      30860.75
plan_t2:

entry_fill:   30880            # where you actually got in (underlying)
exit_fill:    30840            # where you actually got out
exit_reason:  discretionary    # tp | sl | discretionary | time | never_filled
pnl:          70               # realised dollars, signed

draw_traded_later:             # yes | no — did the named draw print AFTER you were out?
followed_plan: no              # did you take the size, stop and target as planned?
why:          draw was clean and SMT agreed
why_written:  after            # before | after — before the outcome was known?

# THE OVERRIDE FIELDS. Fill these whenever you took a trade the desk did not
# say TAKE to — which, while the sequence fires as rarely as it does, is most
# of them. They are the only input the desk has for telling a mis-tuned gate
# apart from a lucky streak, and without a missing: list a trade teaches
# nothing about WHICH gate was wrong.
desk_word:    STAND            # TAKE | WAIT | STAND | MANAGE — what the desk said
missing:      retrace, pd_half # the must-layers the sequence was short at entry
ladder_agreed:                 # yes | no — did the timeframe ladder agree?
`;

if (process.argv.includes("--template")) {
  console.log(TEMPLATE);
  process.exit(0);
}

const load = () => (existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : { trades: [] });

if (process.argv.includes("--show")) {
  const doc = load();
  if (!doc.trades.length) {
    console.log("No trades logged yet. That is the binding constraint on everything else.");
    process.exit(0);
  }
  for (const t of doc.trades) {
    console.log(
      `${t.date} ${t.time_et ?? ""} ${t.symbol} ${t.side} · ${t.underlier ?? ""} ${t.contract ?? ""} · debit $${t.debitUsd} · P&L $${t.pnl} (${t.r >= 0 ? "+" : ""}${t.r}R) · ${t.attribution}${t.violations.length ? ` · BROKE: ${t.violations.join("; ")}` : ""}`,
    );
  }
  const closed = doc.trades.filter((t) => t.pnl != null);
  const clean = closed.filter((t) => t.violations.length === 0 && t.followedPlan === true);
  console.log(
    `\n${closed.length} logged, ${clean.length} taken as planned. Only the ${clean.length} clean ones count toward any setup's record.`,
  );
  process.exit(0);
}

const path = process.argv[2];
if (!path) {
  console.error("Usage: npx tsx scripts/log-trade.mjs <note.txt>   (or --template / --show)");
  process.exit(1);
}

const { sleeveViolations, STOP_FRAC_OF_DEBIT } = await import("../src/lib/trading/sleeve-sizing.ts");
const { attribute } = await import("../src/lib/trading/setup-memory.ts");

// ── parse ──────────────────────────────────────────────────────────────────
const raw = readFileSync(path, "utf8");
const f = {};
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([a-z_]+)\s*:\s*(.*?)\s*(?:#.*)?$/.exec(line);
  if (m && m[2] !== "") f[m[1]] = m[2];
}
const num = (k) => {
  const v = Number(f[k]);
  return Number.isFinite(v) ? v : null;
};
const bool = (k) => (f[k] == null ? null : /^(y|yes|true|1)$/i.test(f[k]));

const required = ["date", "symbol", "side"];
const missing = required.filter((k) => !f[k]);
if (missing.length) {
  console.error(`Missing required field(s): ${missing.join(", ")}. Run --template.`);
  process.exit(1);
}

// ── derive ─────────────────────────────────────────────────────────────────
const premium = num("premium");
const contracts = num("contracts");
const debitUsd = num("debit") ?? (premium != null && contracts != null ? premium * contracts * 100 : null);
if (debitUsd == null) {
  console.error("Cannot determine the debit — give `debit:` or both `premium:` and `contracts:`.");
  process.exit(1);
}

const pnl = num("pnl");
// R is measured against the 15%-of-debit brake, because that is the risk the
// sleeve model says was on the table — not the full premium, and not the
// planned futures stop, which is in different units.
const riskUsd = debitUsd * STOP_FRAC_OF_DEBIT;
const r = pnl != null && riskUsd > 0 ? Math.round((pnl / riskUsd) * 100) / 100 : null;

// The override fields. `missing` is a comma list of smc-master layer ids.
const KNOWN_LAYERS = [
  "dol", "sweep", "pd_half", "ltf", "target", "retrace",
  "htf", "judas", "news", "one_book",
];
const missingLayers = (f.missing ?? "")
  .split(",")
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);
const unknownLayers = missingLayers.filter((l) => !KNOWN_LAYERS.includes(l));
if (unknownLayers.length) {
  // Refused rather than silently dropped: a typo'd layer would quietly
  // attribute the trade to no gate at all, which is the one outcome that
  // looks like data and is not.
  console.error(`Unknown layer(s) in \`missing:\`: ${unknownLayers.join(", ")}`);
  console.error(`Known: ${KNOWN_LAYERS.join(", ")}`);
  process.exit(1);
}
const deskWord = (f.desk_word ?? "").toUpperCase() || null;
const ladderAgreed = bool("ladder_agreed");

const exitReason = (f.exit_reason ?? "").toLowerCase();
const followedPlan = bool("followed_plan");
const exitedOnLevel = exitReason === "tp" || exitReason === "sl";

const violations = sleeveViolations({
  debitUsd,
  realisedLossUsd: pnl != null && pnl < 0 ? Math.abs(pnl) : null,
  exitedOnLevel: exitReason ? exitedOnLevel : null,
});
if (followedPlan === false && !violations.some((v) => /discretionary/.test(v))) {
  violations.push("trade not taken as planned (size, stop or target deviated)");
}

// ── attribute ──────────────────────────────────────────────────────────────
const planEntry = num("plan_entry");
const planStop = num("plan_stop");
const planT1 = num("plan_t1");
const planT2 = num("plan_t2");
const entryFill = num("entry_fill");
const exitFill = num("exit_fill");
const short = f.side === "short";

const expectation = {
  entry: planEntry ?? 0,
  stop: planStop ?? 0,
  t1: planT1,
  t2: planT2,
  rr1:
    planEntry != null && planStop != null && planT1 != null && Math.abs(planEntry - planStop) > 0
      ? Math.round((Math.abs(planT1 - planEntry) / Math.abs(planEntry - planStop)) * 100) / 100
      : null,
  reachT1: null,
  reachT2: null,
  expR: null,
};

// A missing entry_fill is UNKNOWN, not "never filled". Treating an absent
// field as a negative fact is how a log starts asserting things nobody said:
// the first run of this script called a filled, profitable trade
// NEVER_FILLED purely because the fill price had not been typed in.
const explicitlyUnfilled = exitReason === "never_filled";
const filled = explicitlyUnfilled ? false : entryFill != null || (pnl != null && pnl !== 0);
const reach = (target) =>
  target == null || exitFill == null ? false : short ? exitFill <= target : exitFill >= target;

const outcome = {
  filled,
  mfePts: entryFill != null && exitFill != null ? Math.abs(entryFill - exitFill) : 0,
  maePts: 0,
  hitT1: reach(planT1),
  hitT2: reach(planT2),
  hitStop:
    planStop != null && exitFill != null && (short ? exitFill >= planStop : exitFill <= planStop),
  resultR: r ?? 0,
  drawTradedLater: bool("draw_traded_later"),
};

let { attribution, lesson } = attribute(expectation, outcome, short ? "short" : "long");
if (!explicitlyUnfilled && entryFill == null) {
  lesson =
    `FILL PRICE NOT RECORDED — the attribution below is inferred from the P&L alone and cannot see where you got in or out. ` +
    `Add entry_fill and exit_fill to make it real. ` +
    lesson;
}

// ── write ──────────────────────────────────────────────────────────────────
const doc = load();
const rec = {
  id: `${f.date}-${f.symbol}-${f.side}-${doc.trades.length + 1}`,
  date: f.date,
  time_et: f.time_et ?? null,
  book: f.book ?? "options",
  symbol: f.symbol,
  side: f.side,
  underlier: f.underlier ?? null,
  contract: f.contract ?? null,
  premium,
  contracts,
  debitUsd,
  dte: num("dte"),
  delta: num("delta"),
  expectation,
  outcome,
  pnl,
  r,
  riskUsd,
  attribution,
  lesson,
  violations,
  followedPlan,
  note: f.why ?? null,
  notePreRegistered: (f.why_written ?? "").toLowerCase() === "before",
  // Override evidence — which gate was skipped, what the desk said, and
  // whether the ladder agreed. Read by override-log.ts via trade-log.ts.
  missing: missingLayers,
  deskWord,
  ladderAgreed,
  loggedAt: new Date().toISOString(),
};
doc.trades.push(rec);
doc.note =
  "Real trades, logged by hand. R is measured against the 15%-of-debit brake. " +
  "Records with violations are EXCLUDED from setup statistics by setup-memory.ts — " +
  "they measure the trader, not the setup.";
writeFileSync(LOG, `${JSON.stringify(doc, null, 2)}\n`);

// ── report ─────────────────────────────────────────────────────────────────
console.log(`\nlogged ${rec.id}`);
console.log(`  debit      $${debitUsd}  (risk on the 15% brake: $${riskUsd.toFixed(2)})`);
const brakeHeld = exitedOnLevel || followedPlan === true;
console.log(
  `  P&L        ${pnl != null ? `$${pnl}` : "open"}${r != null ? `  =  ${r >= 0 ? "+" : ""}${r}R` : ""}` +
    (r != null && !brakeHeld
      ? `  (NOMINAL — R is against the $${riskUsd.toFixed(2)} brake, but the stop was not honoured, so the money actually exposed was the full $${debitUsd} debit. Real risk-adjusted return was ${(pnl / debitUsd).toFixed(2)}x the debit.)`
      : ""),
);
if (expectation.rr1 != null) console.log(`  plan R:R   ${expectation.rr1}R to T1`);
console.log(`  why        ${attribution.toUpperCase()}`);
console.log(`             ${lesson}`);
if (violations.length) {
  console.log(`  BROKE      ${violations.join("\n             ")}`);
  console.log(`             This row is excluded from the setup's statistics. It measures you, not the setup.`);
} else {
  console.log(`  clean      counts toward this setup's record.`);
}
if (rec.note && !rec.notePreRegistered) {
  console.log(`  note       kept, but flagged POST-HOC — written after the outcome was known.`);
}
console.log(`\n${doc.trades.length} trade(s) logged. Run --show for the book.`);
