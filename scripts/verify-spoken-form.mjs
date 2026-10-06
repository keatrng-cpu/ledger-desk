/**
 * The spoken form (src/lib/room/spoken-form.ts) and the caption clip (live-voices.ts) against their contract.
 *
 *   npx tsx scripts/verify-spoken-form.mjs
 *
 * WHY: on 2026-10-05 the Floor's voices were found to be stating wrong numbers. The caption `$240.50` was handed to the speech
 * engine as "2 dollars 40.50" and `$1,000` as "1 dollars ,000" (a JS replacement string "$1 dollars " is capture group 1, not a
 * dollar sign), a minus sign was dropped so a loss sounded like a gain, and `620s`, `5m`, `782C`, `T1`, `CE`, `HTF`,
 * `exec/limits.ts` were left for the engine to guess. The old check — "the digits are the same, in order" — passed all of it.
 *
 * So this pins the contract three ways:
 *   - the invariant itself (numbersHeld, signsHeld) refuses the exact bug it was written for;
 *   - a table of captions with the spoken form a person approved, one per rule;
 *   - a property test over thousands of generated money, unit, sign and ratio forms: no number ever moves, no sign is dropped;
 *   - negative controls: spokenProblems flags each hazard class (so a new unhandled symbol or abbreviation fails loudly);
 *   - chunking never splits a number or a word, and never leaves a piece past a breath.
 */
const { spokenForm, chunkSpoken, numbersHeld, signsHeld, numbersOf, SPOKEN_EXPAND } = await import("../src/lib/room/spoken-form.ts");
const { speakable, phrasePlan, speakHoldSec, digitsHeld } = await import("../src/lib/room/floor-voice.ts");
const { clip } = await import("../src/lib/room/live-voices.ts");
const { spokenProblems, MAX_PIECE_WORDS } = await import("./lib/spoken-check.mjs");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

console.log("the invariant refuses the bug it was written for");
{
  check("'$12' spoken as '1 dollars 2' is a moved number", !numbersHeld("Cost $12 a share.", "Cost 1 dollars 2 a share."));
  check("'$1,000' spoken as '1 dollars ,000' is a moved number", !numbersHeld("a $1,000 ceiling", "a 1 dollars ,000 ceiling"));
  check("a dropped digit is caught", !numbersHeld("fit 0.65", "fit 0.6"));
  check("an added number is caught", !numbersHeld("one contract", "1 contract"));
  check("two numbers run together are caught", !numbersHeld("0/30, 0/10", "0 30 0 10 0"));
  check("a dropped minus is caught", !signsHeld("−$4.54 a contract", "4 dollars 54 cents a contract"));
  check("a said minus passes", signsHeld("−$4.54 a contract", "minus 4 dollars 54 cents a contract"));
  check("money in dollars and cents holds its value", numbersHeld("$240.50", "240 dollars 50 cents") && numbersHeld("$0.04", "4 cents") && numbersHeld("$1.05", "1 dollar 5 cents"));
  check("an ISO date holds its year and day when the month is a word", numbersHeld("2026-10-05", "October 5, 2026") && !numbersHeld("2026-10-05", "October 6, 2026"));
  check("numbersOf reads thousands groups and not a trailing comma", JSON.stringify(numbersOf("$1,143, then 0.65")) === JSON.stringify([0.65, 1143]));
}

console.log("the table: one approved reading per rule");
{
  const T = [
    ["Cost $12 a share.", "Cost 12 dollars a share."],
    ["Swept $240.50 so far, $1,000 ceiling.", "Swept 240 dollars 50 cents so far, 1,000 dollars ceiling."],
    ["−$4.54 a contract, −0.181R, +0.35R/card", "minus 4 dollars 54 cents a contract, minus 0.181 R, plus 0.35 R per card"],
    ["$0.04 wide", "4 cents wide"],
    ["$1.2M and $5K", "1.2 million dollars and 5 thousand dollars"],
    ["day +$0, 0/9 PATH.", "day plus 0 dollars, 0 of 9 path."],
    ["lag 620s on ES", "lag 620 seconds on E S"],
    ["Held 5m, then 1h; 4h bias; 15m close.", "Held 5 minutes, then 1 hour, 4 hour bias, 15 minute close."],
    ["T1 in 8h, 1s, 90 min", "target 1 in 8 hours, 1 second, 90 minutes"],
    ["96% of T1s land inside 5 bars", "96 percent of target 1 hits land inside 5 bars"],
    ["(+8 pts) and -2.8 pts", "plus 8 points, and minus 2.8 points"],
    ["EV +$1.87 at 1:1, CE 31,371.", "E V plus 1 dollar 87 cents at 1 to 1, C E 31,371."],
    ["3 × QQQ Oct 6 782C, $384!", "3 Q Q Q October 6 782 call, 384 dollars!"],
    ["NQ +12 in 47 s; 0DTE A+ after 9:45", "N Q plus 12 in 47 seconds, 0 D T E A plus after 9:45"],
    ["QQQ-777C-1: 0.56Δ, theta $1.39, 4¢ wide", "Q Q Q-777 call number 1: 0.56 delta, theta 1 dollar 39 cents, 4 cents wide"],
    ["EV per dollar of debit: OTM_1 5.3¢, ATM -2.8¢. More expected P&L.", "E V per dollar of debit: 1 strike out 5.3 cents, at the money minus 2.8 cents. More expected P and L."],
    ["OTM_2 and OTM_1", "2 strikes out and 1 strike out"],
    ["flat −$17 → EV −$2, then 5 → 8", "flat minus 17 dollars, then E V minus 2 dollars, then 5 to 8"],
    ["5.0× the cards, 1.5x ATR", "5.0 times the cards, 1.5 times A T R"],
    ["P(T1) 29%, E[R] 0.16", "chance of target 1, 29 percent, expected R 0.16"],
    ["P(T1|fill) 27%", "chance of target 1 if filled 27 percent"],
    ["HTF MNQ bull, ES bull. RSI 38 on QQQ", "higher timeframe M N Q bull, E S bull. R S I 38 on Q Q Q"],
    ["ES/10 · NQ/40, 0.65–0.70", "E S over 10, N Q over 40, 0.65 to 0.70"],
    ["6 are collecting (0/30, 0/10)", "6 are collecting, 0 of 30, 0 of 10"],
    ["11:00 ET, 9:45 am, 2026-10-05", "11:00 Eastern, 9:45 A M, October 5, 2026"],
    ["A− needs 0.65; B+ is paper 0.5%.", "A minus needs 0.65, B plus is paper 0.5 percent."],
    ["TJR sweep → 5m CHoCH (drill): MNQ long", "T J R sweep, then 5 minutes change of character, drill: M N Q long"],
    ["STOP. HALT is on. FILL at CE. SELL the rest. FLAT.", "stop. halt is on. fill at C E. sell the rest. flat."],
    ["NVDA, META, COST, GOOGL, VTI, SGOV, IBM", "Nvidia, Meta, Costco, Alphabet, V T I, S G O V, I B M"],
    ["The ZXQ gate and the SHOUTING line", "The Z X Q gate and the shouting line"],
    ["$20.877 billion in 2025, $7.25 trillion, −$3 million", "20.877 billion dollars in 2025, 7.25 trillion dollars, minus 3 million dollars"],
    ["Oh, shut up. …Same. And 2%...", "Oh, shut up. Same. And 2 percent."],
    ["Who competes: BlackRock (iShares) (BLK), Charles Schwab (SCHW) and Vanguard (VTI).", "Who competes: BlackRock, i shares, Charles Schwab and Vanguard, V T I."],
    ["mid − $0.02", "mid minus 2 cents"],
    ["maxCashFracPerTrade in exec/limits.ts is yours", "max cash fraction per trade in the limits file is yours"],
    ["(LIVE_EVIDENCE, EXEC_FLAGS) and SERVER_RUNNER_BUILT", "live evidence, execution flags, and server runner built"],
    ["I overrode ev. NOW!", "I overrode E V. now!"],
    ["Mon 10 sessions, Fri 5 cards", "Monday 10 sessions, Friday 5 cards"],
    ["QQQ and SPY, VIX 15.5, TAKE or STAND", "Q Q Q and spy, vix 15.5, take or stand"],
    ["mid-cap 20-bar high", "mid-cap 20-bar high"],
  ];
  const wrong = T.filter(([raw, want]) => spokenForm(raw) !== want).map(([raw, want]) => `${JSON.stringify(raw)} → ${JSON.stringify(spokenForm(raw))} (want ${JSON.stringify(want)})`);
  check(`all ${T.length} approved readings`, wrong.length === 0, wrong.slice(0, 3).join(" | "));
  check("every approved reading keeps its numbers and signs", T.every(([raw]) => numbersHeld(raw, spokenForm(raw)) && signsHeld(raw, spokenForm(raw))));
  check("speakable (the floor's entry point) is the spoken form", speakable("Swept $240.50") === spokenForm("Swept $240.50"));
  check("a caption with no money keeps the stricter digit-for-digit check", digitsHeld("B+ on MNQ, floor 0.65, 0-1 DTE.", speakable("B+ on MNQ, floor 0.65, 0-1 DTE.")));
  check("the same caption gives the same speech (pure)", spokenForm("−$4.54 a contract") === spokenForm("−$4.54 a contract"));
}

console.log("the property: no generated form moves a number or drops a sign");
{
  let seed = 20261005;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const commas = (n) => n.toLocaleString("en-US");
  const dec = (n, d) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const sgn = () => ["", "+", "−", "-"][int(0, 3)];
  const unit = () => ["s", "m", "h", "d", "x", "R", "pt", "pts", "%", "min", "ms", "k", "K", "M", "B", "bp"][int(0, 15)];
  const forms = [
    () => `$${commas(int(0, 99999))}`,
    () => `$${dec(int(0, 9999) + rnd(), 2)}`,
    () => `${sgn()}$${dec(rnd() * 500, 2)}`,
    () => `${sgn()}${int(0, 999)}${unit()}`,
    () => `${sgn()}${dec(rnd() * 20, int(1, 3))}${unit()}`,
    () => `${int(0, 40)}/${int(1, 90)}`,
    () => `${sgn()}${int(1, 99)}¢`,
    () => `${sgn()}${dec(rnd() * 9, 1)}¢`,
    () => `${dec(rnd(), 2)}Δ`,
    () => `${int(1, 9)}:${int(1, 9)}`,
    () => `${int(0, 23)}:${String(int(0, 59)).padStart(2, "0")}`,
    () => `${dec(rnd(), 2)}–${dec(rnd() + 1, 2)}`,
    () => `T${int(1, 3)}`,
    () => `${int(700, 799)}${["C", "P"][int(0, 1)]}`,
    () => `${commas(int(1000, 40000))}.${["00", "25", "50", "75"][int(0, 3)]}`,
    () => `20${int(10, 29)}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`,
  ];
  const frames = ["{} ok", "at {}.", "stop {}, then", "({}) said", "ES {} / NQ {}", "{}; and {}", "—{}—"];
  let bad = 0;
  const examples = [];
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const frame = frames[int(0, frames.length - 1)];
    const raw = frame.replace(/\{\}/g, () => forms[int(0, forms.length - 1)]());
    const said = spokenForm(raw);
    if (!numbersHeld(raw, said) || !signsHeld(raw, said)) {
      bad++;
      if (examples.length < 4) examples.push(`${JSON.stringify(raw)} → ${JSON.stringify(said)}`);
    }
  }
  check(`${N} generated captions (money, units, signs, ratios, times, ranges, dates, contracts)`, bad === 0, `${bad} moved: ${examples.join(" | ")}`);
}

console.log("negative controls: the checker flags every hazard class");
{
  const flags = (raw) => spokenProblems([raw]);
  check("a clean line is clean", flags("The draw is still premium, discount below.").length === 0);
  check("a line the old speakable() mangled is now clean", spokenProblems([{ character: "Jax", text: "Cost $12, swept $240.50, −$4.54 at lag 620s" }]).length === 0);
  check("a glued letter and digit the speech layer cannot place is flagged", flags("a 3D chart").length === 1 && /glued/.test(flags("a 3D chart")[0]), flags("a 3D chart").join());
  check("letters then a digit are spelled, then the digit said (Q3, IC3)", spokenForm("Q3 results, the FBI's IC3") === "Q 3 results, the F B I's I C 3");
  check("a number the speech layer would move is flagged by the invariant, not by the checker's own rules", !numbersHeld("lag 620s", "lag 6 20 s"));
  check("a camelCase code name never survives (it is split into words)", spokenForm("setMaxCashFrac is yours") === "set max cash fraction is yours");
  check("a file name never survives", !/\.ts\b/.test(spokenForm("see src/lib/room/limits.ts and audit.ts")) && spokenForm("see audit.ts") === "see the audit file");
  check("an empty caption is not spoken", spokenForm("") === "" && spokenForm(" · ").length === 0);
  check("a long run with no punctuation is split at a conjunction, never inside a number", (() => {
    const run = `${Array(22).fill("the room waits").join(" ")} and then 240 dollars 50 cents more ${Array(18).fill("it holds").join(" ")}`;
    const pieces = chunkSpoken(run);
    return pieces.length >= 2 && pieces.every((p) => p.split(/\s+/).length <= 34) && pieces.join(" ") === run && JSON.stringify(numbersOf(run, true)) === JSON.stringify(numbersOf(pieces.join(" "), true)) && pieces.every((p) => !/^\d/.test(p) && !/^(dollars?|cents?)\b/.test(p));
  })());
  check("a run nothing can split is flagged, not silently sent to an engine that will cut it", spokenProblems([{ character: "Nova", text: Array(60).fill("word").join(" ") }]).length === 0 && chunkSpoken(Array(60).fill("word").join(" ")).length >= 2);
}

console.log("the real vocabulary: every ticker the desk can name");
{
  const fs = await import("node:fs");
  const themes = JSON.parse(fs.readFileSync(new URL("../src/data/invest-themes.json", import.meta.url), "utf8"));
  const { ALL_DOSSIERS } = await import("../src/lib/invest/dossiers.ts");
  const { TICKER_SAY } = await import("../src/lib/room/spoken-form.ts");
  const tickers = new Set(ALL_DOSSIERS.map((d) => d.ticker));
  for (const t of themes.themes) {
    for (const v of t.vehicles) tickers.add(v.ticker);
    for (const c of t.competitors) if (c.ticker) tickers.add(c.ticker);
  }
  const long = [...tickers].filter((t) => /^[A-Z]{5,}$/.test(t) && !TICKER_SAY[t]);
  check(`all ${tickers.size} tickers in the research file and dossiers have a reading (none of 5+ letters falls through to being lowercased)`, long.length === 0, long.join());
  const words = [...tickers].filter((t) => /^[A-Z]{3,4}$/.test(t) && !TICKER_SAY[t] && /[AEIOU]/.test(t) && spokenForm(t) === t.toLowerCase());
  check("no ticker that is spelled turned into a lowercase word by the shouted-word list", words.length === 0, words.join());
  check("a mapped ticker is said as a name, with no digits", Object.values(TICKER_SAY).every((v) => v && !/\d/.test(v)));
  const mangled = [...tickers].filter((t) => { const s = spokenForm(t); return !s || /[$%_]|\d/.test(s) || (s === s.toLowerCase() && !TICKER_SAY[t]); });
  check("every ticker comes out as letters or a name", mangled.length === 0, mangled.map((t) => `${t}→${spokenForm(t)}`).join());
}

console.log("the vocabulary");
{
  const bare = Object.entries(SPOKEN_EXPAND).filter(([k, v]) => !v || v === k);
  check("every expansion says something other than itself", bare.length === 0, bare.map(([k]) => k).join());
  check("an expansion adds no digit", Object.values(SPOKEN_EXPAND).every((v) => !/\d/.test(v)));
  check("the spelled tickers are the ones the desk trades", ["MNQ", "MES", "NQ", "ES", "QQQ", "SPY"].every((k) => SPOKEN_EXPAND[k]));
}

console.log("breath: a long caption is said as sentences");
{
  const long = "The Execution card would refuse the room's tickets on a $1,000 account. The broker side caps a ticket at 10% of broker cash, $100 on $1,000, and the room's cheaper strike is about $339. The paper seats run on the same checklist. Whether to go live before the paper record exists is yours.";
  const said = spokenForm(long);
  const pieces = chunkSpoken(said);
  check("a short caption stays one piece", chunkSpoken("Bell. We're open.").length === 1);
  check("a long one is several pieces, none past a breath", pieces.length >= 2 && pieces.every((p) => p.split(/\s+/).length <= MAX_PIECE_WORDS), pieces.map((p) => p.split(/\s+/).length).join());
  check("the pieces put the caption back together exactly", pieces.join(" ").replace(/\s+/g, " ") === said);
  check("a piece ends where a sentence ends", pieces.slice(0, -1).every((p) => /[.!?]$/.test(p)), JSON.stringify(pieces.map((p) => p.slice(-12))));
  check("no piece cuts a number: every number survives the split", numbersHeld(long, pieces.join(" ")));
  const onesentence = "Whether the room should take the trade depends on the target, and the target depends on where the draw is, and where the draw is depends on what got raided, and what got raided depends on the session, and the session is the one thing nobody here controls, so we wait for the open.";
  const split = chunkSpoken(spokenForm(onesentence));
  check("one long sentence splits at a comma, never mid-phrase", split.length >= 2 && split.slice(0, -1).every((p) => /,$/.test(p)) && split.join(" ") === spokenForm(onesentence), JSON.stringify(split.map((p) => p.slice(-14))));
  const plan = phrasePlan("Sterling", long);
  check("the plan carries the pieces, a breath between, the pitch off the rasp", plan.length >= 2 && plan.slice(0, -1).every((p) => p.gap > 0) && plan.at(-1).gap === 0 && plan.every((p) => p.pitch >= 0.98 && p.pitch <= 1.03));
  check("a question lifts its own piece a hair, inside the band", (() => { const q = phrasePlan("Jax", "Why are we flat? Nobody has a card yet, and the sample is thin, and the clock is not the edge, and the draw is far away, and the room is quiet today.")[0]; return q.text.endsWith("?") && q.pitch > 1.0 && q.pitch <= 1.03; })());
  check("the caption holds long enough for every piece and every breath", speakHoldSec("Sterling", long) > speakHoldSec("Sterling", "Bell. We're open."));
}

console.log("brevity: a long caption is said without its asides");
{
  const { digestOf, spokenDigest, DIGEST_ABOVE_WORDS, ASIDE_WORDS } = await import("../src/lib/room/spoken-form.ts");
  const sterling = "Cleared: 2× for $574 under a $1,000 cap, level first, −20% behind it, halt room $200. Pre-mortem: if it loses, it's the level, 77% for −$57, with T1 distance the biggest drag. For the record, on 146 real NY AM cards this gate's passes made +$2 a contract and its refusals −$7 — right way, not proven (z 0.61).";
  const nova = "QQQ Oct 6 776C at $3.32: model 31% to T1 in 8h, 29% before 11:00 (96% of T1s land inside 5 bars). T1 +$141, loss −$66, flat −$17 → EV −$2 a contract after $0.04 of spread.";
  check("a short caption is said whole", spokenDigest("Bell. We're open (the bell, the open, the day, the room).") === spokenForm("Bell. We're open (the bell, the open, the day, the room)."));
  check("the threshold is about sixteen seconds of speech", DIGEST_ABOVE_WORDS === 34 && ASIDE_WORDS === 5);
  check("a long parenthetical aside is taken out; the first sentence always stays", !/96%/.test(digestOf(nova)) && digestOf(nova).startsWith("QQQ Oct 6 776C"));
  check("a short parenthesis is data and stays ('($287)', '(+8 pts)')", digestOf("A ticket ($287) stopped (+8 pts) at once.") === "A ticket ($287) stopped (+8 pts) at once.");
  check("a sentence the author opened with 'For the record' is taken out", !/For the record/.test(digestOf(sterling)) && /Pre-mortem/.test(digestOf(sterling)));
  check("a first sentence that opens that way is not removed (there would be nothing left)", digestOf("For the record, the book is flat. Day +$0.") .startsWith("For the record, the book is flat."));
  const said = spokenDigest(sterling);
  check("the long ticket line is said in fewer words than it is written (80 → 44)", said.split(/\s+/).length < spokenForm(sterling).split(/\s+/).length - 20, `${said.split(/\s+/).length} vs ${spokenForm(sterling).split(/\s+/).length}`);
  check("what is said carries the caption's numbers minus the removed text, and every sign", numbersHeld(digestOf(sterling), said) && signsHeld(digestOf(sterling), said) && numbersHeld(digestOf(nova), spokenDigest(nova)));
  const minus = (all, kept) => {
    const left = [...all];
    for (const k of kept) {
      const i = left.indexOf(k);
      if (i >= 0) left.splice(i, 1);
    }
    return left;
  };
  const droppedText = "For the record, on 146 real NY AM cards this gate's passes made +$2 a contract and its refusals −$7 — right way, not proven (z 0.61).";
  check("the numbers the digest dropped are exactly the numbers in the removed text (a multiset difference, so a repeated '2' counts)", JSON.stringify(minus(numbersOf(sterling), numbersOf(digestOf(sterling)))) === JSON.stringify(numbersOf(droppedText)), JSON.stringify(minus(numbersOf(sterling), numbersOf(digestOf(sterling)))));
  const thin = `Yes. For the record, ${Array(40).fill("filler").join(" ")}.`;
  check("a digest that would leave under 14 words is not used: the whole caption is said", spokenDigest(thin) === spokenForm(thin) && /for the record/i.test(spokenDigest(thin)), spokenDigest(thin).slice(0, 60));
  const longAside = `${Array(20).fill("word").join(" ")}. ${Array(8).fill("more").join(" ")} (this aside has six whole words) ${Array(8).fill("end").join(" ")}.`;
  check("an aside is only dropped from a LONG line (a line at the threshold is said whole)", spokenDigest("Short line (this aside has six whole words) stays.") === spokenForm("Short line (this aside has six whole words) stays.") && !/aside/.test(spokenDigest(longAside)), spokenDigest(longAside).slice(-60));
  const plan = phrasePlan("Sterling", sterling);
  check("the floor says the digest: the plan's words are the digest's, not the whole caption's", plan.map((p) => p.text).join(" ").replace(/\s+/g, " ") === said && !/for the record/i.test(plan.map((p) => p.text).join(" ")));
  check("the caption on screen is untouched by it", /For the record/.test(sterling) && sterling.includes("(z 0.61)"));
  const flagged = (say) => spokenProblems([{ character: "Nova", text: nova }], { say });
  check("negative control: a digest that drops a number from the kept text is flagged", flagged(() => "Q Q Q October 6 776 call at 3 dollars 32 cents: model 31 percent to target 1 in 8 hours.").some((p) => /digest moved a number/.test(p)));
  check("negative control: a digest that drops a minus sign is flagged", flagged((raw) => spokenDigest(raw).replace(/minus 66/, "66")).some((p) => /digest dropped a sign|digest moved/.test(p)), flagged((raw) => spokenDigest(raw).replace(/minus 66/, "66")).join());
  check("the real digest passes the same checker", flagged(spokenDigest).length === 0, flagged(spokenDigest).join());
}

console.log("the clip: a cut is a finished thought");
{
  const text = "The Execution card would refuse the room's tickets on a $1,000 account. The broker side caps a ticket at 10% of broker cash (limits.ts) — $100 on $1,000 — and the room's cheaper strike is about $339. The paper seats run on the same checklist.";
  const c = clip(text, 150);
  check("it fits", c.length <= 151, String(c.length));
  check("it ends on a whole sentence when one fits (exactly that sentence, not a clause of the next)", clip(text, 100) === "The Execution card would refuse the room's tickets on a $1,000 account.", clip(text, 100));
  check("…and a cut that keeps under half the room does not take the sentence", /[.!?…]$/.test(c) && c.length <= 151, c);
  const noSentence = "Whether to go live before the paper record exists is yours, and the numbers are in the config file, and the three flags only you can flip are still shut";
  const k = clip(noSentence, 100);
  check("with no sentence it ends on a clause, closed with a full stop", k.length <= 101 && /[a-z]\.$/.test(k), k);
  const paren = "The ghost room refused it (the EV gate said no on the model, quoted not gating, and that is the whole story here";
  const p = clip(paren, 70);
  check("it never leaves a parenthesis open", (p.match(/\(/g) ?? []).length <= (p.match(/\)/g) ?? []).length, p);
  check("it never cuts a number in two", (() => { const t = "The edge is 0.65 and the sample is 1,143 tickets over 2026-10-05 in total across every card"; for (let n = 12; n < t.length; n++) { const out = clip(t, n); for (const num of ["0.65", "1,143", "2026-10-05"]) { const i = out.indexOf(num.slice(0, 2)); if (i >= 0 && out.slice(i).startsWith(num.slice(0, 2)) && !out.includes(num) && /\d$/.test(out.replace(/[.…]+$/, ""))) return false; } } return true; })());
  check("a short line is untouched", clip("Bell. We're open.", 150) === "Bell. We're open.");
  check("the old fallback still works for one long run of words", clip("word ".repeat(60).trim(), 40).endsWith("…"));
}

console.log("every line the room's meetings can say (the drill day, through the real pipeline)");
{
  const { playDrill } = await import("../src/lib/room/drill.ts");
  const seen = new Map();
  for (const step of playDrill()) for (const l of step.cycle?.output?.floor_dialogue_and_meetings ?? []) seen.set(l.text, l);
  const lines = [...seen.values()];
  const bad = spokenProblems(lines);
  check(`all ${lines.length} distinct meeting lines are speakable`, lines.length > 40 && bad.length === 0, bad.slice(0, 3).join(" || "));
  const money = lines.filter((l) => /\$\d/.test(l.text));
  check(`${money.length} of them carry money, and every one is spoken in dollars and cents`, money.length > 5 && money.every((l) => !/\$/.test(spokenForm(l.text)) && /dollar|cent/.test(spokenForm(l.text))));
  const signed = lines.filter((l) => /[−+]\$?\d/.test(l.text));
  check(`${signed.length} carry a plus or a minus, and every one is said`, signed.length > 3 && signed.every((l) => signsHeld(l.text, spokenForm(l.text))));
}

console.log("purity");
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/lib/room/spoken-form.ts", import.meta.url), "utf8");
  check("no network, no model, no clock, no randomness", !/\bfetch\s*\(|anthropic|\bxai\b|Math\.random|Date\.now\s*\(|new Date\s*\(\s*\)|speechSynthesis/.test(src));
  check("no control characters in the source (a doubled backslash once became a backspace in a regex)", ![...src].some((ch) => ch.charCodeAt(0) < 32 && !"\n\r\t".includes(ch)));
}

console.log(`\nspoken-form: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
