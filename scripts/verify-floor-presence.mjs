/**
 * The face and the hands follow the line. A mutant that drops a cue fails here.
 *   npx tsx scripts/verify-floor-presence.mjs
 */
const P = await import("../src/lib/room/floor-presence.ts");

let fail = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

check("m closes the mouth", P.visemeAt("mmm", 0) === "mm");
check("i widens it", P.visemeAt("iii", 0) === "ee");
check("o rounds it", P.visemeAt("ooo", 0) === "oh");
check("a opens it", P.visemeAt("aaa", 0) === "aa");
check("silence is a closed rest", P.visemeAt("", 1) === "rest" && P.presenceOf("Jax", null, 1, false).viseme === "rest");
check("a closed mouth is shorter than an open one", P.visemeScale("mm").y < P.visemeScale("aa").y);

const face = (who, text) => P.presenceOf(who, text, 0.02, true);
check("noise furrows the brow and looks down", face("Jax", "last minute is 3.1z, a noise bar").brow === "down" && face("Jax", "last minute is 3.1z, a noise bar").look === "down");
check("a paid line lifts the brow", face("Vince", "QQQ puts paid 40 dollars").brow === "up");
let blinksDiffer = false;
for (let t = 0; t < 6; t += 0.05) {
  if (P.presenceOf("Jax", "hello", t, false).blink !== P.presenceOf("Nova", "hello", t, false).blink) blinksDiffer = true;
}
check("blinks are not in lockstep", blinksDiffer);

check("a sweep points", P.gestureFor("Jax", "the sweep took the high") === "POINTING");
check("a shift gestures at the wall", P.gestureFor("Nova", "displacement confirms the shift") === "GESTICURING_AT_WALL");
check("an inverse points", P.gestureFor("Sterling", "the 1m inverse") === "POINTING");
check("the whiteboard gets the marker", P.gestureFor("Nova", "the entry is the CE") === "WRITING_ON_WHITEBOARD");
check("noise is a facepalm", P.gestureFor("Jax", "that print is a noise bar") === "FACEPALM");
check("a loss is a facepalm", P.gestureFor("Vince", "puts cost 40 dollars") === "FACEPALM");
check("paid is a cheer", P.gestureFor("Vince", "the target hit and it paid") === "CHEER");
check("do not chase crosses the arms", P.gestureFor("Jax", "do not chase the break") === "CROSSING_ARMS");
check("a fit is a nod", P.gestureFor("Nova", "ICT fits this short") === "NODDING");
check("Sterling's note crosses her arms", P.gestureFor("Sterling", "this is a note") === "CROSSING_ARMS");
check("Gemma leans back at lunch", P.gestureFor("Gemma", "lunch cuts size") === "LEAN_BACK");
check("Nova analyzes a school", P.gestureFor("Nova", "the school sequence") === "ANALYZING");
check("Jax points at the leader", P.gestureFor("Jax", "ES is the leader") === "POINTING");
check("Vince approves a place", P.gestureFor("Vince", "Agentic sent the ticket") === "THUMBS_UP");
check("a ladder is a watch", P.gestureFor("Gemma", "higher timeframe down") === "WATCH");
check("a journal is the tablet", P.gestureFor("Sterling", "the journal closed it") === "CHECKING_TABLET");
check("debit is the tablet", P.gestureFor("Sterling", "debit is 200") === "CHECKING_TABLET");
check("premium is analysis", P.gestureFor("Gemma", "the array is in premium") === "ANALYZING");
check("an order block points", P.gestureFor("Nova", "the order block held") === "POINTING");
check("killzone hours are explained", P.gestureFor("Gemma", "the London killzone") === "EXPLAINING");
check("power of three paces", P.gestureFor("Gemma", "accumulation then manipulation") === "PACING");
check("a quiet line does not invent a gesture", P.gestureFor("Jax", "good morning") === null);
check("nobody gestures without a line", P.gestureFor("Jax", null) === null);

console.log(fail ? `\n${fail} failed` : "\nall passed");
process.exit(fail ? 1 : 0);
