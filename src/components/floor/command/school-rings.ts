/**
 * School met/total rings — same mapping SmcPlaybook uses for MetRing.
 * Kept here so the Brain command card can show the live read without mounting the full playbook.
 */
import { SCHOOLS, type CanonStack, type SchoolId } from "@/lib/trading/smc-canon";

const SCHOOL_ORDER: SchoolId[] = ["ict", "smc", "tjr", "blake", "patty", "ronan"];

const STEP_FACTORS: Record<SchoolId, (string[] | null)[]> = {
  ict: [["htf"], null, ["time"], ["sweep", "pd_half"], ["overlap"], ["ltf"]],
  smc: [["pd_half"], ["htf"], ["sweep"], ["ltf"], ["overlap"]],
  tjr: [["sweep"], ["mtf"], ["ltf"], null, null],
  blake: [["htf"], ["pd_half"], ["sweep"], ["ltf"], null],
  patty: [["pd_half"], ["ltf"], null, null, null],
  ronan: [["htf"], ["pd_half"], ["ltf"], null],
};

function stepStates(id: SchoolId, stack: CanonStack | null | undefined) {
  const map = STEP_FACTORS[id] ?? [];
  return SCHOOLS[id].sequence.map((_, i) => {
    const ids = map[i];
    if (!stack || !ids) return null;
    const fs = ids.map((fid) => stack.factors.find((f) => f.id === fid));
    if (fs.some((f) => !f)) return null;
    return fs.every((f) => f!.pass);
  });
}

/** Aggregate met/total across schools that have live-checkable steps. */
export function schoolRings(stack: CanonStack | null | undefined): {
  met: number;
  total: number;
  bySchool: { id: SchoolId; name: string; met: number; total: number }[];
} {
  const bySchool = SCHOOL_ORDER.map((id) => {
    const st = stepStates(id, stack);
    const checkable = st.filter((x) => x != null);
    const met = checkable.filter(Boolean).length;
    return {
      id,
      name: SCHOOLS[id].name.split(" ")[0] ?? id,
      met,
      total: checkable.length,
    };
  }).filter((s) => s.total > 0);

  const met = bySchool.reduce((a, s) => a + s.met, 0);
  const total = bySchool.reduce((a, s) => a + s.total, 0);
  return { met, total, bySchool };
}
