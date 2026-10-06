/**
 * The floor speaks the caption. It does not write a line.
 *
 * Static: the utterance is the line text, the cast is the five, and the tab
 * only speaks while the speaker toggle is on. No trade path in the sound file.
 */
import { readFileSync } from "node:fs";

const sound = readFileSync("src/components/room/floor-sound.ts", "utf8");
const tab = readFileSync("src/components/room/trading-floor-tab.tsx", "utf8");
let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? "ok" : "FAIL"}  ${name}`);
  if (!ok) failed++;
};

check("utterance is the caption text", /new SpeechSynthesisUtterance\(text\)/.test(sound));
check("say takes the line", /say\(line: \{ character: Character; text: string \}\)/.test(sound));
check("cast is the five", ["Gemma", "Jax", "Nova", "Sterling", "Vince"].every((n) => sound.includes(`${n}:`)));
check("unlock is the gesture prime", /warm\.volume = 0\.01/.test(sound));
check("sound file has no trade path", !/evaluateEntry|EXEC_FLAGS|contracts_quantity|paper-book/.test(sound));
check("tab speaks only while voices are on", /if \(!soundOnRef\.current\) return;[\s\S]*sound\.current\?\.say\(line\)/.test(tab));
check("turning voices off hushes", /sound\.current\?\.hush\(\)/.test(tab));
check("toggle still unlocks on the click", /sound\.current\?\.unlock\(\)/.test(tab));

if (failed) {
  console.error(`\\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("floor voice: caption only");
