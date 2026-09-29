/**
 * The Discuss tab's schedule (ai-sync.ts): which of the 6 fixed ET
 * checkpoints is due, dedupe by ET calendar day, weekend shutout, and the
 * "Read: bias · confidence" tag parse. Pure — no network, no model call.
 *
 * Run: npx tsx scripts/verify-ai-sync.mjs
 */
let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);

const S = await import("../src/lib/coach/ai-sync.ts");

// A known Monday: 2026-09-28 is a Monday per this session's date.
const et = (time, dateIso = "2026-09-28") => {
  const [h, m] = time.split(":").map(Number);
  // Build a UTC instant that reads as `time` ET on that date (ET = UTC-4 in September, EDT).
  return new Date(`${dateIso}T${String(h + 4).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
};

console.log("\nwhich slot is due");
check("all 6 times are listed, in order", S.AI_SYNC_TIMES.map((t) => t.slot), ["09:25", "09:32", "09:35", "09:40", "09:45", "10:00"]);
check("09:25:00 ET is due", S.dueAiSyncSlot(et("09:25"), new Set())?.slot, "09:25");
check("09:25:30 ET (same minute) is still due", S.dueAiSyncSlot(et("09:25:30".replace(":30", "")), new Set())?.slot, "09:25");
check("09:26 ET is not a slot", S.dueAiSyncSlot(et("09:26"), new Set()), null);
check("09:24 ET is not yet due", S.dueAiSyncSlot(et("09:24"), new Set()), null);
check("10:00 ET is due (the last checkpoint)", S.dueAiSyncSlot(et("10:00"), new Set())?.slot, "10:00");
check("10:01 ET is past every checkpoint", S.dueAiSyncSlot(et("10:01"), new Set()), null);

console.log("\ndedupe — once per slot per ET day");
const firstDue = S.dueAiSyncSlot(et("09:32"), new Set());
ok("09:32 is due with no prior fires", firstDue);
check("already-fired key blocks a second fire the same minute", S.dueAiSyncSlot(et("09:32"), new Set([firstDue.key])), null);
const tuesdayDue = S.dueAiSyncSlot(et("09:32", "2026-09-29"), new Set([firstDue.key]));
ok("the SAME slot on a DIFFERENT ET day is due again (a new key)", tuesdayDue && tuesdayDue.key !== firstDue.key);

console.log("\nweekends are shut");
check("Saturday never fires", S.dueAiSyncSlot(et("09:35", "2026-09-26"), new Set()), null);
check("Sunday never fires", S.dueAiSyncSlot(et("09:35", "2026-09-27"), new Set()), null);

console.log("\nthe trailing 'Read: bias · confidence' tag — a badge off the model's own words");
check(
  "the two-paragraph shape ending in the tag parses",
  S.parseDiscussRead("Structure looks aligned...\n\nGiven the numbers, roughly 60/40 in favor.\n\nRead: bullish · confidence medium"),
  { bias: "bullish", confidence: "medium" },
);
check("case-insensitive, and a hyphen instead of the middle dot", S.parseDiscussRead("Read: BEARISH - confidence High"), { bias: "bearish", confidence: "high" });
check("a comma separator also parses", S.parseDiscussRead("Read: neutral, confidence low"), { bias: "neutral", confidence: "low" });
check("no tag at all (e.g. a round-2 reply) is null, not guessed", S.parseDiscussRead("I'd add that the ladder is still 65% aligned, otherwise agreed."), { bias: null, confidence: null });
check("null text", S.parseDiscussRead(null), { bias: null, confidence: null });
check("empty text", S.parseDiscussRead(""), { bias: null, confidence: null });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
