/**
 * The floor speaks the caption, in a person's pattern and the line's tone.
 * It does not write a line, and a new caption waits instead of cutting.
 * Digits, units, signs and code names are said the way the desk says them.
 * The spoken form itself is src/lib/room/spoken-form.ts; verify-spoken-form.mjs pins its rules, the number invariant, the property
 * test and the corpus check. The readings below are the ones the floor's own tests have always pinned (an amount, a sign, a unit, a
 * strike, a code name), kept here so a change to the voice cannot quietly change what a person hears for them.
 */
import { readFileSync } from "node:fs";
import { digitsHeld, phrasePlan, speakHoldSec, speakable, toneOf, assignVoices, voiceGender, VOICE_CAST } from "../src/lib/room/floor-voice.ts";

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
check("say plans the line", /phrasePlan\(line\.character, line\.text, line\.animation\)/.test(sound));
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

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("floor voice: queued, toned, desk-spoken, caption only");
