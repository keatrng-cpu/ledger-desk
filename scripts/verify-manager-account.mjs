/**
 * ManagerRoomState.account checks (read-only RH block). Invoked from verify-rh-autofire-gates.mjs.
 */
export async function verifyManagerAccount(rh, check) {
  const m = await import("../src/lib/execution/manager-account.ts");
  const d = m.DEFAULT_MANAGER_ROOM_ACCOUNT;
  check("default account is Individual snapshot", [d.source, d.label, d.accountMaskLast4, d.isSnapshot], ["rh_live", "Individual", "7477", true]);
  check("default cash/BP 984.12 / 11.56", [d.cashUsd, d.optionsBuyingPowerUsd], [984.12, 11.56]);
  check("envelope 150/550", [d.envelopeMinUsd, d.envelopeMaxUsd], [150, 550]);
  check("BP 11.56 cannot fill envelope", d.canFillEnvelope, false);
  check("monitor line arm blocked", m.managerAccountLine(d), "BP $11.56 · below $150 envelope, arm blocked");
  check("preferred account 415577477", m.RH_PREFERRED_ACCOUNT_NUMBER, "415577477");
  check("BP 150 fills", m.toManagerRhAccount({ cashUsd: 0, optionsBuyingPowerUsd: 150 }).canFillEnvelope, true);
  check("BP 149.99 does not fill", m.toManagerRhAccount({ cashUsd: 0, optionsBuyingPowerUsd: 149.99 }).canFillEnvelope, false);
  const fromConn = m.managerRhAccountFromConnector({
    account: { account_number: "415577477", brokerage_account_type: "individual", agentic_allowed: false, option_level: "option_level_2" },
    portfolio: { cash: "984.12", buying_power: { buying_power: "11.5600" } },
    asOf: "2026-10-06T01:45:00.000Z",
  });
  check("connector mapper", [fromConn.cashUsd, fromConn.optionsBuyingPowerUsd, fromConn.accountMaskLast4, fromConn.label, fromConn.canFillEnvelope, fromConn.isSnapshot], [984.12, 11.56, "7477", "Individual", false, false]);
  check("gate refuses null account", m.accountPlaceGate(null).ok, false);
  check("gate refuses Individual (not agent-accessible)", m.accountPlaceGate(d).ok, false);
  const marginOk = m.toManagerRhAccount({ cashUsd: 984.12, optionsBuyingPowerUsd: 984.12, agenticAllowed: true, optionLevel: "option_level_2", accountMaskLast4: "7477" });
  check("gate passes when accessible + BP ≥ 150", m.accountPlaceGate(marginOk).ok, true);
  check("gate refuses low BP even if accessible", m.accountPlaceGate({ ...marginOk, optionsBuyingPowerUsd: 11.56, canFillEnvelope: false }).ok, false);
  const base = { gatesStillOk: true, liveArmedNow: true, confirmedInWriting: true, reviewHadBlockingAlert: false, agenticAllowed: true, optionsLevelOk: true };
  check("mayPlaceAfterReview refuses default account", rh.mayPlaceAfterReview({ ...base, account: d }).ok, false);
  check("mayPlaceAfterReview refuses null account", rh.mayPlaceAfterReview({ ...base, account: null }).ok, false);
  check("mayPlaceAfterReview ok with fillable accessible account", rh.mayPlaceAfterReview({ ...base, account: marginOk }).ok, true);
}
