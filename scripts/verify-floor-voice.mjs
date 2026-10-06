/**
 * The floor speaks the caption, in a person's pattern and the line's tone.
 * It does not write a line, and a new caption waits instead of cutting.
 */
import { readFileSync } from "node:fs";
import { digitsHeld, phrasePlan, speakHoldSec, speakable, toneOf, VOICE_CAST } from "../src/lib/room/floor-voice.ts";

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
check("verdict waits, then drops", sterling.length >= 2 && sterling[0].gap > sterling.at(-1).gap && sterling.at(-1).pitch < sterling[0].pitch);
check("jax clips faster than sterling", jax[0].rate > sterling[0].rate && jax[0].gap < sterling[0].gap);
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

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("floor voice: queued, toned, caption only");
