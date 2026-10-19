import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const { gradeStrategyAgainstMarket } = await import("../src/lib/trading/strategy-grade.ts");

// The recalibration recuts edges to the fit this real function produces; pin its shape.
test("a complete high-structure setup out-fits a bare one (the signal the recut ranks on)", () => {
  const rich = gradeStrategyAgainstMarket("continuation",
    ["mid_bias","htf2_bias","ifvg","displacement","cisd","structure","mss","daily_bias","pd"], { htfOk: true, killzoneOk: true, conditionsOk: true });
  const bare = gradeStrategyAgainstMarket("tjr", ["sweep_significant"], { htfOk: true });
  assert.ok(rich.fit > bare.fit, "richer setup must score higher");
  assert.ok(rich.fit >= 0 && rich.fit <= 0.99, "fit is a bounded ratio");
});

test("fit is monotone in structure coverage (more structure keys -> >= fit)", () => {
  const few = gradeStrategyAgainstMarket("tjr", ["sweep_significant","ifvg","structure"], { htfOk: true });
  const many = gradeStrategyAgainstMarket("tjr", ["sweep_significant","ifvg","structure","mss","mid_bias","displacement"], { htfOk: true });
  assert.ok(many.fit >= few.fit);
});
