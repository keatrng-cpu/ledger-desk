/**
 * The floor speaks the caption, in a person's pattern and the line's tone.
 * It does not write a line, and a new caption waits instead of cutting.
 * Digits, units, signs and code names are said the way the desk says them.
 * The spoken form itself is src/lib/room/spoken-form.ts; verify-spoken-form.mjs pins its rules, the number invariant, the property
 * test and the corpus check. The readings below are the ones the floor's own tests have always pinned (an amount, a sign, a unit, a
 * strike, a code name), kept here so a change to the voice cannot quietly change what a person hears for them.
 */
import { readFileSync } from "node:fs";
import { digitsHeld, phrasePlan, speakHoldSec, speakable, toneOf, assignVoices, voiceGender, VOICE_CAST, isNaturalVoice } from "../src/lib/room/floor-voice.ts";

const sound = readFileSync("src/components/room/floor-sound.ts", "utf8");
const tab = readFileSync("src/components/room/trading-floor-tab.tsx", "utf8");
const scene = readFileSync("src/components/room/floor-scene.ts", "utf8");
let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? "ok" : "FAIL"}  ${name}`);
  if (!ok) failed++;
};

const sample = "The rule is the rule. Banking at T1 cost more than it saved, at 0.65.";
const sterling = phrasePlan("Sterling", sample);
const jax = phrasePlan("Jax", sample);
const raid = phrasePlan("Jax", "They swept the high. Judas raid, then it failed.");
const stop = phrasePlan("Vince", "Stopped. The halt is on.");
const structure = phrasePlan("Gemma", "The draw is still premium, discount below.");
const spoken = speakable("B+ on MNQ, floor 0.65, $12, 0-1 DTE.");

check("utterance is a phrase of the caption", /new SpeechSynthesisUtterance\(p\.text\)/.test(sound));
check("say plans the line (the natural plan only for a natural voice)", /phrasePlan\(line\.character, line\.text, line\.animation, \{ natural: isNaturalVoice\(/.test(sound));
check("a new line waits", /this\.queue\.push/.test(sound) && /Only hush\(\)/.test(sound));
check("hush is the only cut", /hush\(\): void[\s\S]*speechSynthesis\?\.cancel/.test(sound));
check("cast is the five", ["Gemma", "Jax", "Nova", "Sterling", "Vince"].every((n) => VOICE_CAST[n]));
check("five patterns", new Set(Object.values(VOICE_CAST).map((c) => c.pattern)).size === 5);
check("digits survive the spoken form", digitsHeld("B+ on MNQ, floor 0.65, $12, 0-1 DTE.", spoken));
check("plus is said, not skipped", spoken.includes("B plus") && spoken.includes("M N Q"));

const said = [
  ["$1,000 account", /1,000 dollars/],
  ["+$128 on the close", /plus 128 dollars/],
  ["−$33 on QQQ Oct 6 782C", /minus 33 dollars on Q Q Q October 6 782 call/],
  ["I'm watching the 5m close.", /5 minute close/],
  ["NQ +12 in 47 s.", /plus 12 in 47 seconds/],
  ["Stop outside 0.5-1.5 ATR: −0.24R/card.", /0\.5 to 1\.5 A T R: minus 0\.24 R per card/],
  ["PDH 30,080, 79 pts above.", /P D H 30,080, 79 points above/],
  ["0DTE A+ after 9:45", /0 D T E A plus/],
  ["maxCashFracPerTrade in exec/limits.ts is yours", /max cash fraction per trade in the limits file is yours/],
  ["SERVER_RUNNER_BUILT is false", /server runner built is false/],
  ["P(T1) 27%, E[R] +0.01R", /chance of target 1, 27 percent, expected R plus 0\.01 R/],
  ["3 × QQQ Oct 6 782C", /^3 Q Q Q October 6 782 call$/],
  ["0/9 PATH, 1:1 at 09:45 ET", /0 of 9 path, 1 to 1 at 09:45 Eastern/],
];
for (const [raw, want] of said) {
  const s = speakable(raw);
  check(`spoken: ${raw}`, want.test(s) && digitsHeld(raw, s), s);
}
check("a clipped caption settles on a full stop", /\.$/.test(speakable("T1 28% · loss…")));

check("jax is quicker than sterling", jax[0].rate > sterling[0].rate);
check("pitch stays off the rasp", [...sterling, ...jax, ...raid, ...stop].every((p) => p.pitch >= 0.98 && p.pitch <= 1.03));
check("raid rises above a stop", raid[0].pitch > stop[0].pitch && raid[0].rate > stop[0].rate);
check("stop is the stop tone", toneOf("Stopped. The halt is on.") === "stop");
check("structure leans on the word", structure.some((p) => /premium|discount/i.test(p.text) && p.tone === "structure"));
check("caption holds for the voice", speakHoldSec("Sterling", sample) > 4 && /speakHoldSec\(line\.character/.test(scene));
check("unlock is the gesture prime", /warm\.volume = 0\.01/.test(sound));
check("sound file has no trade path", !/evaluateEntry|EXEC_FLAGS|contracts_quantity|paper-book/.test(sound));
check("tab speaks only while voices are on", /if \(!soundOnRef\.current \|\| !line\?\.text\) return;[\s\S]*sound\.current\?\.say\(line\)/.test(tab));
check("a finished caption does not hush", !/else sound\.current\?\.hush\(\)/.test(tab));
check("turning voices off hushes", /sound\.current\?\.hush\(\)/.test(tab));
check("toggle still unlocks on the click", /sound\.current\?\.unlock\(\)/.test(tab));
check("a person keeps their locked voice", /voiceFor\(job\.who\)/.test(sound) && !/pickVoice\(/.test(sound));

const installed = [
  { name: "Google US English", voiceURI: "us", lang: "en-US" },
  { name: "Google UK English Female", voiceURI: "ukf", lang: "en-GB" },
  { name: "Google UK English Male", voiceURI: "ukm", lang: "en-GB" },
  { name: "Samantha", voiceURI: "sam", lang: "en-US" },
  { name: "Daniel", voiceURI: "dan", lang: "en-GB" },
  { name: "Karen", voiceURI: "kar", lang: "en-AU" },
  { name: "Rishi", voiceURI: "ri", lang: "en-IN" },
  { name: "Alex", voiceURI: "al", lang: "en-US" },
];
const cast = assignVoices(installed);
const again = assignVoices(installed);
const nameOf = (uri) => installed.find((v) => v.voiceURI === uri)?.name ?? "";
check("assignment does not rotate", JSON.stringify(cast) === JSON.stringify(again));
check("gemma is female", voiceGender(nameOf(cast.Gemma)) === "female");
check("nova is female", voiceGender(nameOf(cast.Nova)) === "female");
check("jax is male", voiceGender(nameOf(cast.Jax)) === "male");
check("sterling is male", voiceGender(nameOf(cast.Sterling)) === "male");
check("vince is male", voiceGender(nameOf(cast.Vince)) === "male");
check("women do not share a man", cast.Gemma !== cast.Jax && cast.Nova !== cast.Sterling);
const malesOnly = installed.filter((v) => voiceGender(v.name) === "male");
const womenShutOut = assignVoices(malesOnly);
check("no male voice for gemma", womenShutOut.Gemma === null && womenShutOut.Nova === null);
check("a saved male voice is not kept for gemma", assignVoices(installed, { Gemma: "dan" }).Gemma !== "dan");
check("one female voice is shared, not swapped", assignVoices(installed.filter((v) => v.voiceURI === "ukf" || voiceGender(v.name) === "male")).Nova === "ukf");
const deskVoices = [
  { name: "Microsoft Zira", voiceURI: "zira", lang: "en-US" },
  { name: "Samantha", voiceURI: "sam", lang: "en-US" },
  { name: "Microsoft Fred", voiceURI: "fred", lang: "en-US" },
  { name: "Microsoft Guy Online (Natural)", voiceURI: "guy", lang: "en-US" },
  { name: "Google UK English Male", voiceURI: "ukm", lang: "en-GB" },
];
const smoother = assignVoices(deskVoices);
check("nova skips zira", smoother.Nova === "sam");
check("sterling skips fred", smoother.Sterling === "guy");
check("a saved fred is dropped", assignVoices(deskVoices, { Sterling: "fred" }).Sterling === "guy");
check("nova and sterling sit near a natural pace", VOICE_CAST.Nova.rate >= 0.98 && VOICE_CAST.Sterling.rate >= 0.98);
check("the utterance uses the voice's own language", /u\.lang = voice\?\.lang/.test(sound));

console.log("natural voices: American, each person's own register, varied cadence");
{
  const crew = ["Gemma", "Jax", "Nova", "Sterling", "Vince"];
  const line = "The sweep took the high at 782.50. Is that a raid? No, it is a stop run! The draw is below, so we wait.";
  const nat = Object.fromEntries(crew.map((w) => [w, phrasePlan(w, line, undefined, { natural: true })]));
  const leg = Object.fromEntries(crew.map((w) => [w, phrasePlan(w, line, undefined, { natural: false })]));
  const mean = (a, k) => a.reduce((s, p) => s + p[k], 0) / a.length;
  const spread = (plans, k) => {
    const m = crew.map((w) => mean(plans[w], k));
    return Math.max(...m) - Math.min(...m);
  };
  check("natural: the five differ in pitch by at least 0.10", spread(nat, "pitch") >= 0.1);
  check("control: the legacy plan cannot tell them apart by pitch (under 0.05), so the check above is meaningful", spread(leg, "pitch") < 0.05);
  check("natural: the five differ in pace by at least 0.15", spread(nat, "rate") >= 0.15);
  const byRate = [...crew].sort((a, b) => mean(nat[a], "rate") - mean(nat[b], "rate"));
  const byPitch = [...crew].sort((a, b) => mean(nat[a], "pitch") - mean(nat[b], "pitch"));
  check("Sterling is the slowest and the lowest, Jax the fastest", byRate[0] === "Sterling" && byRate[4] === "Jax" && byPitch[0] === "Sterling");
  check("Gemma is the brightest voice", byPitch[4] === "Gemma");
  const g = nat.Jax;
  check("the line is spoken as several pieces", g.length >= 3, String(g.length));
  check("a question lifts: its piece sits above the sentence before it, for every person", crew.every((w) => { const p = nat[w]; const i = p.findIndex((x) => x.text.endsWith("?")); return i > 0 && p[i].pitch > p[i - 1].pitch; }));
  check("a sentence end breathes: full-stop and question pauses are 200 ms or more, the last piece has none", g.slice(0, -1).filter((p) => /[.?]$/.test(p.text)).every((p) => p.gap >= 200) && g[g.length - 1].gap === 0);
  check("three or more distinct pitch values in one line: not a drone", new Set(g.map((p) => p.pitch.toFixed(3))).size >= 3);
  check("the same line is spoken the same way every time (deterministic)", JSON.stringify(phrasePlan("Gemma", line, undefined, { natural: true })) === JSON.stringify(phrasePlan("Gemma", line, undefined, { natural: true })));
  check("two different lines differ a little for the same person (not stamped)", phrasePlan("Nova", "Range used is forty percent.", undefined, { natural: true })[0].rate !== phrasePlan("Nova", "Range used is fifty percent.", undefined, { natural: true })[0].rate);
  const calm = "The room is quiet and the tape is flat.";
  const stopN = mean(phrasePlan("Vince", "Stopped. The halt is on.", undefined, { natural: true }), "rate") - mean(phrasePlan("Vince", calm, undefined, { natural: true }), "rate");
  const stopL = mean(phrasePlan("Vince", "Stopped. The halt is on.", undefined, { natural: false }), "rate") - mean(phrasePlan("Vince", calm, undefined, { natural: false }), "rate");
  check("a stop slows a natural voice at least twice as far as a legacy one", stopN < 0 && stopN <= stopL * 2, stopN.toFixed(3) + " vs " + stopL.toFixed(3));
  check("natural plans keep the punctuation the voice can use; the legacy plan strips it", nat.Sterling.some((p) => p.text.includes(",") || /[.?!]$/.test(p.text)) && !leg.Sterling.some((p) => p.text.includes(",") || p.text.endsWith(".")));
  const digits = (plans) => plans.map((p) => p.text).join(" ").replace(/[^0-9]/g, "");
  check("no digit moves between the two plans, or inside a natural one", crew.every((w) => digits(nat[w]) === digits(leg[w])) && digits(nat.Jax).length > 0);
  check("legacy plan unchanged: pitch stays in 0.98 to 1.03", crew.every((w) => leg[w].every((p) => p.pitch >= 0.98 && p.pitch <= 1.03)));
  check("natural plan stays inside what an engine takes (pitch 0.82-1.2, rate 0.85-1.3)", crew.every((w) => nat[w].every((p) => p.pitch >= 0.82 && p.pitch <= 1.2 && p.rate >= 0.85 && p.rate <= 1.3)));
  check("which voices count as natural", isNaturalVoice("Microsoft Aria Online (Natural) - English (United States)") && isNaturalVoice("Samantha (Enhanced)") && isNaturalVoice("Ava (Premium)") && !isNaturalVoice("Microsoft David Desktop - English (United States)") && !isNaturalVoice("Google US English") && !isNaturalVoice("English (America) espeak") && !isNaturalVoice(null));
  const v = (name, voiceURI, lang) => ({ name, voiceURI, lang });
  const edge = [
    v("Microsoft Aria Online (Natural) - English (United States)", "aria", "en-US"),
    v("Microsoft Jenny Online (Natural) - English (United States)", "jenny", "en-US"),
    v("Microsoft Michelle Online (Natural) - English (United States)", "michelle", "en-US"),
    v("Microsoft Guy Online (Natural) - English (United States)", "guy", "en-US"),
    v("Microsoft Davis Online (Natural) - English (United States)", "davis", "en-US"),
    v("Microsoft Tony Online (Natural) - English (United States)", "tony", "en-US"),
    v("Microsoft Andrew Online (Natural) - English (United States)", "andrew", "en-US"),
    v("Microsoft Sonia Online (Natural) - English (United Kingdom)", "sonia", "en-GB"),
    v("Microsoft Ryan Online (Natural) - English (United Kingdom)", "ryan", "en-GB"),
    v("Microsoft Libby Online (Natural) - English (United Kingdom)", "libby", "en-GB"),
    v("Google UK English Female", "guf", "en-GB"),
  ];
  const cast = assignVoices(edge);
  const us = new Set(["aria", "jenny", "michelle", "guy", "davis", "tony", "andrew"]);
  check("American first: with American voices to spare nobody gets a British one", crew.every((w) => us.has(cast[w])), JSON.stringify(cast));
  check("five people, five different voices when the browser has them", new Set(crew.map((w) => cast[w])).size === 5, JSON.stringify(cast));
  check("the gender gate holds on the cast", ["Gemma", "Nova"].every((w) => voiceGender(edge.find((x) => x.voiceURI === cast[w]).name) === "female") && ["Jax", "Sterling", "Vince"].every((w) => voiceGender(edge.find((x) => x.voiceURI === cast[w]).name) === "male"));
  const oneUs = assignVoices([v("Microsoft Aria Online (Natural) - English (United States)", "aria", "en-US"), v("Microsoft Sonia Online (Natural) - English (United Kingdom)", "sonia", "en-GB"), v("Microsoft Ryan Online (Natural) - English (United Kingdom)", "ryan", "en-GB")]);
  check("with a single American voice the British ones stay available as a fallback", Object.values(oneUs).every(Boolean), JSON.stringify(oneUs));
  check("a saved British voice is replaced once American ones exist", assignVoices(edge, { Gemma: "sonia" }).Gemma !== "sonia");
}

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("floor voice: queued, toned, desk-spoken, caption only");
