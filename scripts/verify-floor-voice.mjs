/**
 * The floor speaks the caption, in a person's pattern, one person at a time. It does not write a line.
 *
 * The spoken form keeps every digit. Patterns are delivery (pause, pitch, pace), and the tab only speaks while the
 * speaker toggle is on. Turn-taking: the scene holds a line until its voice has finished it (with a ceiling), the
 * next person waits a natural beat, and a line that arrives early waits for the phrase in the air — nobody is cut
 * off mid-word and nobody talks over anybody.
 */
import { readFileSync } from "node:fs";
import { digitsHeld, handoffMs, phrasePlan, sayMs, speakable, VOICE_CAST } from "../src/lib/room/floor-voice.ts";

const sound = readFileSync("src/components/room/floor-sound.ts", "utf8");
const tab = readFileSync("src/components/room/trading-floor-tab.tsx", "utf8");
const scene = readFileSync("src/components/room/floor-scene.ts", "utf8");
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok" : "FAIL"}  ${name}${ok || detail == null ? "" : ` — ${detail}`}`);
  if (!ok) failed++;
};

const sample = "The rule is the rule. Banking at T1 cost more than it saved, at 0.65.";
const sterling = phrasePlan("Sterling", sample);
const jax = phrasePlan("Jax", sample);
const nova = phrasePlan("Nova", "E[R] ranks cards well. The top fifth was 12 percent.");
const spoken = speakable("B+ on MNQ, floor 0.65, $12, 0-1 DTE.");

check("utterance is a phrase of the caption", /new SpeechSynthesisUtterance\(p\.text\)/.test(sound));
check("say plans the line", /phrasePlan\(line\.character, line\.text\)/.test(sound));
check("cast is the five", ["Gemma", "Jax", "Nova", "Sterling", "Vince"].every((n) => VOICE_CAST[n]));
check("five patterns", new Set(Object.values(VOICE_CAST).map((c) => c.pattern)).size === 5);
check("pitches stay near speech", Object.values(VOICE_CAST).every((c) => c.pitch >= 0.9 && c.pitch <= 1.06));
check("digits survive the spoken form", digitsHeld("B+ on MNQ, floor 0.65, $12, 0-1 DTE.", spoken));
check("plus is said, not skipped", spoken.includes("B plus") && spoken.includes("M N Q"));
check("verdict waits, then drops", sterling.length >= 2 && sterling[0].gap > sterling.at(-1).gap && sterling.at(-1).pitch < sterling[0].pitch);
check("jax clips faster than sterling", jax[0].rate > sterling[0].rate && jax[0].gap < sterling[0].gap);
check("nova slows on the figure", nova.some((p) => /\d/.test(p.text) && p.rate < VOICE_CAST.Nova.rate));

// Said the way a person on the desk says it — and still the same digits.
const said = [
  ["$1,000 account", /1,000 dollars/],
  ["+$128 on the close", /plus 128 dollars/],
  ["−$33 on QQQ Oct 6 782C", /minus 33 dollars on Q Q Q Oct 6 782 call/],
  ["I'm watching the 5m close.", /5 minute close/],
  ["NQ +12 in 47 s.", /plus 12 in 47 seconds/],
  ["Stop outside 0.5-1.5 ATR: −0.24R/card.", /0\.5 to 1\.5 A T R: minus 0\.24 R per card/],
  ["PDH 30,080, 79 pts above.", /P D H 30,080, 79 points above/],
  ["0DTE A+ after 9:45", /0 D T E A plus/],
  ["maxCashFracPerTrade in exec/limits.ts is yours", /max cash frac per trade in the limits file is yours/],
  ["SERVER_RUNNER_BUILT is false", /server runner built is false/],
  ["P(T1) 27%, E[R] +0.01R", /the odds of T1 27 percent, expected R plus 0\.01 R/],
  ["3 × QQQ Oct 6 782C", /^3 Q Q Q Oct 6 782 call$/],
  ["0/9 PATH, 1:1 at 09:45 ET", /0 of 9 PATH, 1 to 1 at 09:45 E T/],
];
for (const [raw, want] of said) {
  const s = speakable(raw);
  check(`spoken: ${raw}`, want.test(s) && digitsHeld(raw, s), s);
}
check("a clipped caption settles on a full stop", /\.$/.test(speakable("T1 28% · loss…")));
check("a short sentence is one breath (commas stay inside it)", phrasePlan("Gemma", "Draw on liquidity for NQ, PDH, 79 pts above.").length === 1);
check("a long run still breathes at a comma", phrasePlan("Vince", "The room's two strikes run high, one at the cap, the ladder goes from the bottom to the money, down to delta, and the seats may reach it while the room stays on two strikes.").length >= 2);

// Turn-taking.
const q = { character: "Jax", text: "And how long till it gets there?" };
const a = { character: "Sterling", text: "As long as it takes, Jax." };
const v = { character: "Vince", text: "Noted." };
check("the end of an exchange is a real pause", handoffMs(a, null) >= 700);
check("a person carrying on is a short breath", handoffMs(v, { character: "Vince", text: "Still going." }) < handoffMs(v, { character: "Gemma", text: "Raid, then delivery." }));
check("Sterling lets the room land before a verdict", handoffMs(v, { character: "Sterling", text: "No." }) > handoffMs(v, { character: "Gemma", text: "No." }));
check("an answer to a question comes quicker than a new point", handoffMs(q, { character: "Gemma", text: "Soon." }) < handoffMs(v, { character: "Gemma", text: "Soon." }));
check("nobody starts in under a fifth of a second", [handoffMs(q, a), handoffMs(v, a), handoffMs(a, q)].every((ms) => ms >= 200));
check("a line's spoken length grows with its words", sayMs("Nova", "One. Two.") < sayMs("Nova", "The model's top fifth priced higher than it realized, so I rank and I don't bank."));

check("say reports when the line is done", /say\(line: \{ character: Character; text: string \}, onDone\?: \(\) => void\): boolean/.test(sound) && /onDone\?\.\(\)/.test(sound));
check("a new line waits for the phrase in the air (no mid-word cancel)", /if \(this\.uttering\) \{[\s\S]*this\.afterPhrase = start;/.test(sound) && /PREEMPT_CAP_MS/.test(sound));
check("the scene holds the line until the voice releases it", /holdLine\(idx: number, maxMs: number\)/.test(scene) && /releaseLine\(idx: number\)/.test(scene) && /!this\.voiceWait && this\.lineIdx < this\.lines\.length/.test(scene));
check("the hold has a ceiling, so a silent engine cannot stall the room", /wall >= this\.voiceWait\.until\) this\.voiceWait = null/.test(scene));
check("the next speaker waits the handoff beat", /handoffMs\(cur, next\)/.test(scene));
check("an urgent exchange waits for the sentence in progress", /if \(this\.voiceWait\) \{[\s\S]*this\.queue\.unshift\(b\)/.test(scene));
check("a cycle meeting waits for the sentence in progress", /this\.pendingMeeting = out\.floor_dialogue_and_meetings/.test(scene));
check("the tab holds the scene on a line it voices", /sound\.current\?\.say\(line, \(\) => sceneRef\.current\?\.releaseLine\(i\)\)/.test(tab) && /sceneRef\.current\?\.holdLine\(i,/.test(tab));

check("unlock is the gesture prime", /warm\.volume = 0\.01/.test(sound));
check("sound file has no trade path", !/evaluateEntry|EXEC_FLAGS|contracts_quantity|paper-book/.test(sound));
check("tab speaks only while voices are on", /if \(!soundOnRef\.current\) return;\s*if \(line\?\.text\) voice\(i, line\)/.test(tab));
check("turning voices off hushes and lets the scene go", /sound\.current\?\.hush\(\);\s*sceneRef\.current\?\.dropVoiceHold\(\)/.test(tab));
check("toggle still unlocks on the click", /sound\.current\?\.unlock\(\)/.test(tab));

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("floor voice: patterned, caption only, one person at a time");
