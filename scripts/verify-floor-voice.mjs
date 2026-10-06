/**
 * The floor speaks the caption, in a person's pattern. It does not write a line.
 *
 * The spoken form keeps every digit. Patterns are delivery (pause, pitch, pace),
 * and the tab only speaks while the speaker toggle is on.
 */
import { readFileSync } from "node:fs";
import { digitsHeld, phrasePlan, speakable, VOICE_CAST } from "../src/lib/room/floor-voice.ts";

const sound = readFileSync("src/components/room/floor-sound.ts", "utf8");
const tab = readFileSync("src/components/room/trading-floor-tab.tsx", "utf8");
let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? "ok" : "FAIL"}  ${name}`);
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
check("unlock is the gesture prime", /warm\.volume = 0\.01/.test(sound));
check("sound file has no trade path", !/evaluateEntry|EXEC_FLAGS|contracts_quantity|paper-book/.test(sound));
check("tab speaks only while voices are on", /if \(!soundOnRef\.current\) return;[\s\S]*sound\.current\?\.say\(line\)/.test(tab));
check("turning voices off hushes", /sound\.current\?\.hush\(\)/.test(tab));
check("toggle still unlocks on the click", /sound\.current\?\.unlock\(\)/.test(tab));

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("floor voice: patterned, caption only");
