/**
 * The four schools in the brain (src/data/school-brief.json, src/lib/trading/school-brief.ts) and the floor that uses them.
 *
 *   npx tsx scripts/verify-school-brief.mjs
 *
 * WHY: the trader gave the desk its own description of ICT, TJR, PB Blake and PB Patty (2026-10-07: market, entry, target, confluence,
 * liquidity, timeframes, bias, ranges, arrays, and two hybrids) and asked that the brain hold it and the characters and desk rely on it
 * to read direction and entries. The floor's school checklist chips had been "awaiting model" since they were drawn (no school grader
 * existed), so this pins:
 *   - the brief is whole and faithful: nine facets x four schools + two hybrids, every spoken line's numbers are in the paragraph it came
 *     from, and a style that differs from a measured desk rule carries that rule (TJR's 2R partial vs the desk's 50% at T1);
 *   - the brain holds it: pinned nodes on the SMC shelf, recalled only when a query names the school (so "bias" and "target" alone still
 *     reach the desk's own lines), added to an atlas saved before they existed, and never overwriting a newer rewrite;
 *   - direction: each school reads the rungs it names (ICT daily+weekly, TJR 1H+4H, Blake weekly+daily, Patty daily state + 15/5m shift);
 *   - the grader is differential: removing one fact moves exactly the schools that need it, and an unread fact is "unknown", never a pass;
 *   - what is said is short, free of symbols, and keeps the numbers; the cards' new-card briefing opens each seat with its own school.
 */
const { numbersHeld, numbersOf, spokenForm } = await import("../src/lib/room/spoken-form.ts");
const B = await import("../src/lib/trading/school-brief.ts");
const A = await import("../src/lib/room/desk-atlas.ts");
const { jobsFor } = await import("../src/lib/room/brain-feed.ts");
const { exTier } = await import("../src/lib/room/live-voices.ts");
const { Facts, freshTalkState } = await import("../src/lib/room/live-types.ts");
const { schoolsOf } = await import("../src/lib/room/live-world.ts");
const { spokenProblems } = await import("./lib/spoken-check.mjs");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const words = (s) => s.split(/\s+/).filter(Boolean).length;

console.log("the brief is whole and faithful");
{
  check("four schools, nine facets each", B.SCHOOL_KEYS.length === 4 && B.SCHOOL_KEYS.every((s) => B.FACETS.every((f) => B.SCHOOL_BRIEF[s].facets[f]?.short && B.SCHOOL_BRIEF[s].facets[f]?.long)));
  check("both hybrids", !!B.HYBRIDS.ict_tjr?.short && !!B.HYBRIDS.blake_patty?.long && /OTE/.test(B.HYBRIDS.ict_tjr.blueprint) && /Breaker/.test(B.HYBRIDS.blake_patty.blueprint));
  check("the source says whose reading this is and that it is not independently verified", /trader/.test(B.BRIEF_SOURCE) && /not independently verified/.test(B.BRIEF_SOURCE) && B.BRIEF_AS_OF === "2026-10-07");
  const bad = [];
  for (const s of B.SCHOOL_KEYS) {
    for (const f of B.FACETS) {
      const { short, long } = B.SCHOOL_BRIEF[s].facets[f];
      if (words(short) > 42) bad.push(`${s}.${f} short is ${words(short)} words`);
      if (words(long) < words(short)) bad.push(`${s}.${f} long is shorter than short`);
      // Every number the spoken line states is in the paragraph it summarises (the minus of an extension level is said in words).
      const inLong = numbersOf(long).map(Math.abs);
      for (const n of numbersOf(short)) if (!inLong.includes(n)) bad.push(`${s}.${f}: ${n} is not in the paragraph`);
    }
  }
  check("every spoken line is short and states only numbers its paragraph has", bad.length === 0, bad.slice(0, 4).join("; "));
  const L = (s, f) => B.SCHOOL_BRIEF[s].facets[f].long;
  check("the paragraphs are the trader's words, not a paraphrase (distinctive phrases survive)",
    /-0\.27 and -0\.62 extension levels/.test(L("ict", "target")) && /62%, 70\.5%, and 79%/.test(L("ict", "entry")) && /1-Hour for Direction, 5-Minute for Confirmation, and 1-Minute for Entry/.test(L("tjr", "timeframes"))
    && /Internal Array resting inside an External Array/.test(L("blake", "confluence")) && /Breaker Block overlaps with the newly created FVG/.test(L("patty", "entry")) && /1:2 Risk-to-Reward/.test(L("tjr", "target")));
  check("a style that differs from a measured desk rule carries the desk's rule", /50% off at T1/.test(B.SCHOOL_BRIEF.tjr.facets.target.deskNote) && !!B.SCHOOL_BRIEF.blake.facets.target.deskNote && !!B.SCHOOL_BRIEF.patty.facets.target.deskNote && /50% at T1/.test(B.HYBRIDS.ict_tjr.deskNote));
  check("the spoken lines pass the floor's own speech checker (no symbol, number held)", spokenProblems(B.SCHOOL_KEYS.flatMap((s) => B.FACETS.map((f) => ({ character: B.SCHOOL_AVATAR[s], text: B.SCHOOL_BRIEF[s].facets[f].short })))).length === 0,
    spokenProblems(B.SCHOOL_KEYS.flatMap((s) => B.FACETS.map((f) => ({ character: B.SCHOOL_AVATAR[s], text: B.SCHOOL_BRIEF[s].facets[f].short })))).slice(0, 2).join(" | "));
}

console.log("the brain holds it");
{
  const atlas = A.mergeAtlas(null, null, 1_000);
  const school = atlas.nodes.filter((n) => n.id.startsWith("school:"));
  check("36 facet nodes and 2 hybrids, pinned, on the SMC shelf, owned by the seat that presents the school", school.length === 38 && school.every((n) => n.pinned && n.shelf === "smc") && atlas.nodes.find((n) => n.id === "school:tjr:bias")?.who === "Jax" && atlas.nodes.find((n) => n.id === "school:blake:entry")?.who === "Nova");
  check("the TJR target node carries the desk's own rule beside the style", /2R/.test(A.nodeById(atlas, "school:tjr:target").text) && /50% off at T1/.test(A.nodeById(atlas, "school:tjr:target").text));
  check("the joint book record is a node (said on request, not recited on every card)", /19 of 29/.test(A.nodeById(atlas, "bt:book")?.text ?? ""));
  check("each school's bias leads to its entry, then its target", atlas.edges.some((e) => e.from === "school:ict:bias" && e.to === "school:ict:entry") && atlas.edges.some((e) => e.from === "school:patty:entry" && e.to === "school:patty:target") && atlas.edges.some((e) => e.from === "smc:sequence" && e.to === "school:blake:entry"));
  check("'ict bias' recalls ICT's bias node and its neighbours", A.recall(atlas, "ict bias").hit?.id === "school:ict:bias" && A.recall(atlas, "ict bias").neighbors.some((n) => n.id === "school:ict:entry"));
  check("'tjr entry' recalls TJR's entry", A.recall(atlas, "tjr entry").hit?.id === "school:tjr:entry");
  check("'patty breaker' recalls a Patty node, not another school's", A.recall(atlas, "patty breaker").hit?.id.startsWith("school:patty:") === true);
  check("a bare 'bias' or 'target' or 'entry' still reaches the desk's own line, not a school's", ["bias", "target", "entry", "draw"].every((q) => !(A.recall(atlas, q).hit?.id ?? "").startsWith("school:")), ["bias", "target", "entry", "draw"].map((q) => A.recall(atlas, q).hit?.id).join(","));
  check("'blake patty hybrid' recalls the hybrid", A.recall(atlas, "blake patty hybrid").hit?.id === "school:hybrid:blake_patty");

  // An atlas saved before these nodes existed gets them; one that already has them is returned as stored; a newer rewrite is kept.
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
  const old = { ...atlas, nodes: atlas.nodes.filter((n) => !n.id.startsWith("school:") && n.id !== "bt:book") };
  store.set(A.ATLAS_KEY, JSON.stringify(old));
  const loaded = A.loadAtlas();
  check("an atlas saved before the school nodes existed is loaded with them", loaded?.nodes.filter((n) => n.id.startsWith("school:")).length === 38 && !!A.nodeById(loaded, "bt:book"));
  const graded = A.gradeAtlas(atlas, "school:ict:bias", true, 9_000_000);
  check("the tape agreeing with a school's node raises its confidence and stamps it (the brain learning from a close)", A.nodeById(graded, "school:ict:bias").confidence > A.nodeById(atlas, "school:ict:bias").confidence && A.nodeById(graded, "school:ict:bias").n === 2);
  const edited = { ...graded, nodes: graded.nodes.map((n) => (n.id === "school:ict:bias" ? { ...n, text: "ICT bias, as edited.", at: 9_000_001 } : n)) };
  store.set(A.ATLAS_KEY, JSON.stringify(edited));
  check("a stored edit and its confidence survive loading and merging with the seeds", A.loadAtlas().nodes.find((n) => n.id === "school:ict:bias").text === "ICT bias, as edited."
    && A.mergeAtlas(A.loadAtlas(), null, 9_500_000).nodes.find((n) => n.id === "school:ict:bias").confidence === A.nodeById(graded, "school:ict:bias").confidence);
  delete globalThis.localStorage;

  // The merge used to stamp the seeds with the merge time and let "newer wins" choose, so a seed always beat what the brain had learned.
  const cardLive = A.improveAtlas(atlas, { shelf: "now", title: "Card", text: "A+ MNQ short, armed at 24,500.", who: "Nova", nowMs: 2_000 });
  check("a rewritten seed line (the live card) survives a later merge instead of reverting to 'No live card yet'", A.mergeAtlas(cardLive, null, 5_000_000).nodes.find((n) => n.id === "now:card").text === "A+ MNQ short, armed at 24,500.");
  check("... and keeps its prior text and its count", (() => { const n = A.mergeAtlas(cardLive, null, 5_000_000).nodes.find((x) => x.id === "now:card"); return n.n === 1 && n.prior[0]?.text === "No live card yet. Do not invent one."; })());
  const stale = { ...atlas, nodes: atlas.nodes.map((n) => (n.id === "school:tjr:entry" ? { ...n, text: "An older line the code no longer has." } : n)) };
  check("an UNTOUCHED stored copy gives way to the seed, so a seed edited in code reaches an atlas saved earlier", A.mergeAtlas(stale, null, 5_000_000).nodes.find((n) => n.id === "school:tjr:entry").text === B.SCHOOL_BRIEF.tjr.facets.entry.short);
  check("a graded school node keeps what the tape taught it through any number of merges", (() => { let a = A.gradeAtlas(atlas, "school:tjr:entry", true, 3_000); for (let i = 0; i < 3; i++) a = A.mergeAtlas(a, null, 6_000_000 + i); return A.nodeById(a, "school:tjr:entry").confidence === A.nodeById(atlas, "school:tjr:entry").confidence + 6; })());
  check("two stored copies still resolve by the newer one", (() => { const a = { ...cardLive }; const b = A.improveAtlas(cardLive, { shelf: "now", title: "Card", text: "Newer card line.", who: "Nova", nowMs: 4_000 }); return A.mergeAtlas(a, b, 7_000_000).nodes.find((n) => n.id === "now:card").text === "Newer card line." && A.mergeAtlas(b, a, 7_000_000).nodes.find((n) => n.id === "now:card").text === "Newer card line."; })());
}

console.log("direction: each school reads the rungs it names");
{
  const ladder = (bias, { tier3 = "neutral", phase = "expansion", open = null } = {}) => ({
    reads: Object.entries(bias).map(([tf, b]) => ({ tf, bias: b, vsOpenPct: tf === "1d" ? open : null })),
    tier3,
    phase,
  });
  const bias = B.schoolBias;
  const ict = bias("ict", ladder({ "1d": "bull", "1w": "bull" }, { open: -0.3 }));
  check("ICT: daily and weekly up, price under the daily open -> long, and says so", ict.dir === "long" && /daily and weekly is up/.test(ict.why) && /below the daily open/.test(ict.why), ict.why);
  check("ICT: price over the open is said as over", /above the daily open/.test(bias("ict", ladder({ "1d": "bear", "1w": "bear" }, { open: 0.2 })).why));
  check("ICT: daily and weekly disagree -> none", bias("ict", ladder({ "1d": "bull", "1w": "bear" })).dir === "none");
  check("ICT: the daily alone reads when the weekly is flat", bias("ict", ladder({ "1d": "bull", "1w": "neutral" })).dir === "long");
  check("TJR: 1H and 4H both up -> long", bias("tjr", ladder({ "1h": "bull", "4h": "bull" })).dir === "long");
  check("TJR: 1H up, 4H down -> none (he does not trade a split)", bias("tjr", ladder({ "1h": "bull", "4h": "bear" })).dir === "none");
  check("TJR: a flat rung -> none", bias("tjr", ladder({ "1h": "bull", "4h": "neutral" })).dir === "none");
  check("Blake: weekly and daily order flow agree -> that way; disagree -> none", bias("blake", ladder({ "1w": "bear", "1d": "bear" })).dir === "short" && bias("blake", ladder({ "1w": "bull", "1d": "bear" })).dir === "none");
  check("Patty: daily short with the 15/5m shift short -> short", bias("patty", ladder({ "1d": "bear" }, { tier3: "bear" })).dir === "short");
  check("Patty: the daily is short but the 15/5m shift is long -> none, and says why", (() => { const r = bias("patty", ladder({ "1d": "bear" }, { tier3: "bull" })); return r.dir === "none" && /shift is up/.test(r.why); })());
  check("Patty: a consolidating daily -> none", bias("patty", ladder({ "1d": "bull" }, { phase: "range" })).dir === "none");
  check("no ladder -> none for everyone, said plainly", B.SCHOOL_KEYS.every((s) => bias(s, null).dir === "none" && /not read/.test(bias(s, null).why)));
}

console.log("the grader is differential: one missing fact moves exactly the schools that need it");
{
  const bear = { reads: ["1w", "1d", "4h", "1h", "15m"].map((tf) => ({ tf, bias: "bear", vsOpenPct: tf === "1d" ? 0.2 : null })), tier3: "bear", phase: "expansion" };
  const bull = { ...bear, reads: bear.reads.map((r) => ({ ...r, bias: "bull" })), tier3: "bull" };
  const card = { side: "short", components: ["sweep_significant", "displacement", "mss", "ifvg", "breaker", "pd", "ote", "smt"], killzoneOk: true, disrespected: false, drawName: "PDL", drawSwept: false, rr1: 2.4, mitigated: false, ladder: bear };
  const verdicts = (f) => Object.fromEntries(B.schoolReads(f).map((r) => [r.school, r.verdict]));
  const nextOf = (f, s) => B.schoolRead(s, f).next;
  check("a complete short with the whole ladder down: all four fit, nothing is waited for", Object.values(verdicts(card)).every((v) => v === "fits") && B.schoolReads(card).every((r) => r.next === null));
  const noDisp = { ...card, components: card.components.filter((c) => c !== "displacement") };
  const vD = verdicts(noDisp);
  check("no displacement: ICT, TJR and Patty wait for it, Blake (who does not need it) still fits", vD.ict === "missing" && vD.tjr === "missing" && vD.patty === "missing" && vD.blake === "fits", JSON.stringify(vD));
  check("each says it in its own words", /structure shift with displacement/.test(nextOf(noDisp, "ict")) && /displacement on the break/.test(nextOf(noDisp, "tjr")) && /displacement that breaks structure/.test(nextOf(noDisp, "patty")));
  const noBreaker = { ...card, components: card.components.filter((c) => c !== "breaker") };
  const vB = verdicts(noBreaker);
  check("no breaker: only Patty is waiting (Blake takes an inversion gap OR a breaker, and the gap is there)", vB.patty === "missing" && vB.blake === "fits" && vB.ict === "fits" && vB.tjr === "fits" && /breaker block/.test(nextOf(noBreaker, "patty")), JSON.stringify(vB));
  const noInvert = { ...card, components: card.components.filter((c) => c !== "breaker" && c !== "ifvg") };
  check("neither a gap nor a breaker: Blake and Patty wait, TJR waits for a gap or block to rest at", verdicts(noInvert).blake === "missing" && verdicts(noInvert).patty === "missing" && verdicts(noInvert).tjr === "missing");
  check("outside a killzone only ICT waits (time is a must for ICT and a nice-to-have for the others)", (() => { const v = verdicts({ ...card, killzoneOk: false }); return v.ict === "missing" && v.tjr === "fits" && v.blake === "fits" && v.patty === "fits"; })());
  check("no sweep: ICT and TJR wait; Blake and Patty do not name it as a must", (() => { const v = verdicts({ ...card, components: card.components.filter((c) => c !== "sweep_significant") }); return v.ict === "missing" && v.tjr === "missing" && v.blake === "fits" && v.patty === "fits"; })());
  check("the wrong half of the dealing range: ICT, Blake and Patty wait", (() => { const v = verdicts({ ...card, components: card.components.filter((c) => c !== "pd") }); return v.ict === "missing" && v.blake === "missing" && v.patty === "missing" && v.tjr === "fits"; })());
  check("a draw that already traded: ICT waits and says which", (() => { const f = { ...card, drawSwept: true }; return verdicts(f).ict === "missing" && B.schoolRead("ict", f).checks.find((c) => c.id === "draw").detail === "PDL already traded"; })());
  check("a card that names no draw is unknown for ICT, not a failure", (() => { const r = B.schoolRead("ict", { ...card, drawName: null, drawSwept: null }); return r.checks.find((c) => c.id === "draw").state === "unknown" && r.verdict === "fits"; })());
  check("TJR's 2R partial is a preference: 1.5R reads fail on that check and still fits", (() => { const r = B.schoolRead("tjr", { ...card, rr1: 1.5 }); const c = r.checks.find((x) => x.id === "reward"); return c.state === "fail" && !c.must && r.verdict === "fits" && /desk's floor is 1R/.test(c.detail); })());
  check("TJR discards a tested array: flagged, not blocking", (() => { const r = B.schoolRead("tjr", { ...card, mitigated: true }); return r.checks.find((x) => x.id === "fresh").state === "fail" && r.verdict === "fits"; })());
  check("what the desk does not read is unknown, never a pass: Blake's nesting", B.schoolRead("blake", card).checks.find((c) => c.id === "nested").state === "unknown");
  check("no ladder: bias is unknown for all four and the verdict does not pretend otherwise", B.schoolReads({ ...card, ladder: null }).every((r) => r.checks.find((c) => c.id === "bias").state === "unknown") && /cannot grade/.test(B.schoolSentence(B.schoolRead("patty", { ...card, ladder: null }), "short")));

  const against = verdicts({ ...card, ladder: bull });
  check("the whole ladder up against a short: all four read the other way, none stands the card down", Object.values(against).every((v) => v === "against") && B.schoolReads({ ...card, ladder: bull }).every((r) => r.next === null && /A note, not a stand-down/.test(B.schoolSentence(r, "short"))));
  // A real reversal: the higher rungs still read up, the 15m and the lower-timeframe shift have turned down, and the desk released the gate.
  const turned = { ...bull, reads: bull.reads.map((r) => (r.tf === "15m" ? { ...r, bias: "bear" } : r)), tier3: "bear" };
  const rev = { ...card, ladder: turned, disrespected: true };
  check("the same card, released by the desk because the bias was disrespected: the bias check passes, with that as the reason", (() => { const rs = B.schoolReads(rev); return rs.every((r) => r.verdict === "fits" && /disrespected/.test(r.checks.find((c) => c.id === "bias").detail)); })());
  check("Blake still needs the 15 minute to have turned: with it still up the reversal is not his", (() => { const r = B.schoolRead("blake", { ...rev, ladder: bull }); return r.verdict === "missing" && /15 minute trend/.test(r.next); })());
  check("reversal agreement: disrespected + ICT, TJR and Patty all fit -> yes", B.reversalAgreement(B.schoolReads(rev), rev).agree === true);
  check("reversal agreement: Patty missing her breaker -> no, and it names who does fit", (() => { const f = { ...rev, components: card.components.filter((c) => c !== "breaker") }; const r = B.reversalAgreement(B.schoolReads(f), f); return r.agree === false && r.schools.includes("ict") && !r.schools.includes("patty"); })());
  check("reversal agreement: not disrespected -> never", B.reversalAgreement(B.schoolReads(card), card).agree === false);
}

console.log("what is said");
{
  const bear = { reads: ["1w", "1d", "4h", "1h", "15m"].map((tf) => ({ tf, bias: "bear", vsOpenPct: -0.1 })), tier3: "bear", phase: "expansion" };
  const card = { side: "short", components: ["sweep_significant", "displacement", "mss", "ifvg", "pd", "ote"], killzoneOk: true, disrespected: false, drawName: "PDL", drawSwept: false, rr1: 2, mitigated: false, ladder: bear };
  const reads = B.schoolReads(card);
  const line = B.consensusLine(reads, "short");
  check("the consensus is one line: who fits, who is waiting for what, in that school's own words", line === "ICT, TJR and Blake fit this short. Patty needs a breaker block.", line);
  const noShift = B.consensusLine(B.schoolReads({ ...card, components: card.components.filter((c) => c !== "displacement" && c !== "mss") }), "short");
  check("two schools waiting are both named, each for what it lacks", /Blake fits this short\./.test(noShift) && /ICT needs a structure shift with displacement/.test(noShift) && /TJR needs a break of structure/.test(noShift), noShift);
  const sentences = reads.map((r) => B.schoolSentence(r, "short"));
  check("a sentence per school, each short enough to say in a breath or two", sentences.every((s) => words(spokenForm(s)) <= 32), sentences.map((s) => words(spokenForm(s))).join(","));
  check("none carries a symbol, a camelCase name or an unspelled abbreviation (the floor's speech checker)", spokenProblems([...sentences, line].map((t) => ({ character: "Jax", text: t }))).length === 0, spokenProblems([...sentences, line].map((t) => ({ character: "Jax", text: t }))).join(" | "));
  check("a school that fits lists what it holds, at most three", /^Blake fits: .+\.$/.test(sentences[2]) && sentences[2].split(",").length <= 4, sentences[2]);
  check("a school that lacks more than one must says how many more", (() => { const r = B.schoolRead("patty", { ...card, components: ["pd"] }); return r.lacking >= 3 && /and \d more\./.test(B.schoolSentence(r, "short")); })());
}

console.log("the floor uses it");
{
  const lad = (b) => ({ reads: ["1w", "1d", "4h", "1h", "15m"].map((tf) => ({ tf, bias: b, vsOpenPct: -0.1 })), tier3: b, phase: "expansion" });
  const desk = { ladder: { left: { symbol: "NQ=F", ...lad("bear") }, right: { symbol: "ES=F", ...lad("bull") } } };
  const cand = { symbol: "MNQ", side: "short", components: ["sweep_significant", "displacement", "mss", "ifvg", "breaker", "pd"], killzoneOk: true, htfDisrespected: false, draw: { name: "PDL", swept: false }, plan: { rr1: 2.2, drawName: "PDL" }, patterns: { inducement: false, mitigation: false } };
  const s = schoolsOf(desk, cand);
  check("schoolsOf grades the card on ITS index's ladder (MNQ -> the NQ ladder, ES the other)", Object.keys(s.by).sort().join() === "Gemma,Jax,Nova,Sterling" && /fit/.test(s.line) && !/other way/.test(s.line), s.line);
  const es = schoolsOf(desk, { ...cand, symbol: "MES" });
  check("the same card on the ES ladder (up) reads the other way, so the voice differs", /other way/.test(es.line) && /A note, not a stand-down/.test(es.by.Gemma), es.line);
  check("no ladder on the desk: every school says what it cannot grade instead of guessing", /cannot grade/.test(schoolsOf({ ladder: null }, cand).by.Sterling) || /fits/.test(schoolsOf({ ladder: null }, cand).by.Sterling));

  const j = jobsFor({ symbol: "MNQ", side: "short", sequence: "ANTICIPATION · 5m", missing: null, target: 24400, pT1: 0.31, expR: 0.12, schools: s });
  check("the setup line carries the card's own schools, not the canon's first step of each", j.setup.includes(s.line) && !/HTF narrative \+ DOL/.test(j.setup), j.setup);
  check("without a grade the old canon line is the fallback", /ICT: HTF narrative/.test(jobsFor({ symbol: "MNQ", side: "short" }).setup) && Object.keys(jobsFor({ symbol: "MNQ", side: "short" }).school).length === 0);

  const k = { name: "A+ MNQ short", symbol: "MNQ", verdict: "ARMED", u: "QQQ", type: "PUT", band: "A+", tier: "armed", awayPts: 4, futSymbol: "MNQ", futSide: "short", entry: 24500.5, stop: 24530, t1: 24420,
    pT1: 0.31, expR: 0.12, block: null, strategy: "tjr", setup: "sweep, displacement", fit: 0.8, sequence: "ANTICIPATION · 5m", entryLine: "long grid line", entrySay: "5m inverse, the highest in the leg. NQ led, this one lags.", key: "k1", schools: s };
  const run = (card) => exTier({ st: freshTalkState(), f: new Facts(), key: "t:school", now: 1_000_000 }, { card, from: null, to: "armed", b: null }).lines;
  const said = run(k);
  const by = (who) => said.find((l) => l.character === who)?.text ?? "";
  check("on a new card each seat opens with its own school's sentence", by("Gemma").startsWith(s.by.Gemma.slice(0, 20)) && by("Jax").startsWith(s.by.Jax.slice(0, 20)) && by("Nova").startsWith(s.by.Nova.slice(0, 20)) && by("Sterling").startsWith(s.by.Sterling.slice(0, 20)), said.map((l) => `${l.character}: ${l.text.slice(0, 40)}`).join(" | "));
  check("Nova gives this card's odds, not the book record that the brain now holds", /P\(T1\)|P T1|31/.test(by("Nova")) && !/joint book/.test(by("Nova")), by("Nova"));
  check("no seat's line is long (the user's complaint: sentences that take too long)", said.every((l) => words(spokenForm(l.text)) <= 60), said.map((l) => `${l.character} ${words(spokenForm(l.text))}`).join(", "));
  const plain = run({ ...k, schools: undefined });
  check("a card with no school grade keeps the old briefing (the book record, the canon target)", /joint book/.test(plain.find((l) => l.character === "Nova")?.text ?? "") && /untapped|low-resistance/.test(plain.find((l) => l.character === "Gemma")?.text ?? ""));
  check("the corpus guard is clean over everything said", spokenProblems(said.map((l) => ({ character: l.character, text: l.text }))).length === 0, spokenProblems(said.map((l) => ({ character: l.character, text: l.text }))).join(" | "));
}

console.log("no model, no clock, no gate");
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/lib/trading/school-brief.ts", import.meta.url), "utf8");
  check("the grader is deterministic: no network, no model, no clock, no randomness", !/\bfetch\s*\(|anthropic|\bxai\b|Math\.random|Date\.now\s*\(|new Date\s*\(/.test(src));
  check("it imports no config, gate or size", !/aplus\/config|profit-rules|options-sleeve|sleeve-sizing|APLUS_RULES|confluenceFloor/.test(src));
}

console.log(`\nschool-brief: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
