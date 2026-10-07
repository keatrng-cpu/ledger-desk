/**
 * Manager → agentAgree wiring checks (design step 5).
 * Invoked from verify-rh-autofire-gates.mjs.
 */
export async function verifyManagerAgree(gates, rh, check, ARMED_FLAGS, FUNDED = null) {
  const agree = await import("../src/lib/execution/manager-agree.ts");

  check("null ManagerCall → false", agree.agentAgreeFromManagerCall(null), false);
  check("undefined ManagerCall → false", agree.agentAgreeFromManagerCall(undefined), false);
  check("agentAgree false → false", agree.agentAgreeFromManagerCall({ agentAgree: false }), false);
  check("agentAgree true → true", agree.agentAgreeFromManagerCall({ agentAgree: true }), true);
  check("ManagerRoomState null call → false", agree.agentAgreeFromManagerRoomState({ call: null }), false);
  check(
    "ManagerRoomState AGREED call → true",
    agree.agentAgreeFromManagerRoomState({ call: { agentAgree: true } }),
    true,
  );

  const floorArmed = {
    verdict: "ARMED",
    deskContracts: 2,
    band: "A+",
    confluence: 0.72,
  };
  const session = {
    pathActionable: true,
    optionsSessionOpen: true,
    newsBlackout: false,
    riskHalt: false,
    oneBookBlocked: false,
    // Fresh funded get_portfolio read so the BP gate is not what these checks hit.
    account: FUNDED,
    // Floor rule signals (fail closed when missing).
    ceTouch: true,
    tapeAgeSec: 5,
    dte: 1,
  };

  const fromManager = rh.candidateFromFloorPathStand({
    floor: floorArmed,
    ...session,
    manager: { call: { agentAgree: true } },
    agentAgree: false,
  });
  check("candidate agentAgree from ManagerRoomState.call", fromManager.agentAgree, true);

  const fromCall = rh.candidateFromFloorPathStand({
    floor: floorArmed,
    ...session,
    managerCall: { agentAgree: true },
  });
  check("candidate agentAgree from ManagerCall", fromCall.agentAgree, true);

  const absent = rh.candidateFromFloorPathStand({
    floor: floorArmed,
    ...session,
  });
  check("Manager absent + no explicit → agentAgree false", absent.agentAgree, false);

  const explicit = rh.candidateFromFloorPathStand({
    floor: floorArmed,
    ...session,
    agentAgree: true,
  });
  check("legacy explicit agentAgree still works", explicit.agentAgree, true);

  const managerNull = rh.candidateFromFloorPathStand({
    floor: floorArmed,
    ...session,
    manager: null,
    agentAgree: true,
  });
  check("manager: null falls safe (false) over explicit true", managerNull.agentAgree, false);

  const gatedOk = gates.evaluateRhAutofireGates(fromManager, ARMED_FLAGS);
  check("Manager agree + armed gates still ok", gatedOk.ok, true);

  const gatedNo = gates.evaluateRhAutofireGates(absent, ARMED_FLAGS);
  check("Manager-absent refuses (absence is not a yes)", [gatedNo.ok, gatedNo.gate ?? "ok"], [false, "agent"]);

  const softFloor = rh.candidateFromFloorPathStand({
    floor: { ...floorArmed, verdict: "WATCH" },
    ...session,
    manager: { call: { agentAgree: true } },
  });
  check(
    "Manager agree does not soften Floor WATCH",
    gates.evaluateRhAutofireGates(softFloor, ARMED_FLAGS).gate,
    "floor",
  );
}
