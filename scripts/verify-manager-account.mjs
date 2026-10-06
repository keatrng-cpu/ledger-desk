/**
 * ManagerRoomState.account checks (read-only RH block). Invoked from verify-rh-autofire-gates.mjs.
 * Trade account (Keaton 2026-10-06, revised): Agentic 995386158 (••6158). Individual 7477 display-only.
 */
export async function verifyManagerAccount(rh, check) {
  const m = await import("../src/lib/execution/manager-account.ts");
  const d = m.DEFAULT_MANAGER_ROOM_ACCOUNT;
  check("default account is Agentic snapshot", [d.source, d.label, d.accountNumber, d.accountMaskLast4, d.isSnapshot, d.agenticAllowed, d.optionLevel], ["rh_live", "Agentic", "995386158", "6158", true, true, "option_level_2"]);
  check("default cash/BP 0 / 0 until funded", [d.cashUsd, d.optionsBuyingPowerUsd], [0, 0]);
  check("envelope 150/550", [d.envelopeMinUsd, d.envelopeMaxUsd], [150, 550]);
  check("BP 0 cannot fill envelope", d.canFillEnvelope, false);
  check("monitor line arm blocked", m.managerAccountLine(d), "BP $0.00 · below $150 envelope, arm blocked");
  check("preferred account 995386158 / 6158 / Agentic", [m.RH_PREFERRED_ACCOUNT_NUMBER, m.RH_PREFERRED_ACCOUNT_MASK_LAST4, m.RH_PREFERRED_ACCOUNT_LABEL], ["995386158", "6158", "Agentic"]);
  const ind = m.RH_INDIVIDUAL_SNAPSHOT_2026_10_06;
  check("Individual snapshot kept display-only", [ind.accountNumber, ind.accountMaskLast4, ind.cashUsd, ind.optionsBuyingPowerUsd, ind.agenticAllowed, ind.isSnapshot], ["415577477", "7477", 984.12, 11.56, false, true]);
  check("Individual monitor line", m.managerAccountLine(ind), "BP $11.56 · below $150 envelope, arm blocked");
  check("BP 150 fills", m.toManagerRhAccount({ cashUsd: 0, optionsBuyingPowerUsd: 150 }).canFillEnvelope, true);
  check("BP 149.99 does not fill", m.toManagerRhAccount({ cashUsd: 0, optionsBuyingPowerUsd: 149.99 }).canFillEnvelope, false);
  const unk = m.toManagerRhAccount({ cashUsd: 0, optionsBuyingPowerUsd: null });
  check("unknown BP stays NaN (not $0), canFill false", [Number.isNaN(unk.optionsBuyingPowerUsd), unk.canFillEnvelope, m.managerAccountLine(unk)], [true, false, "BP unknown · arm blocked"]);
  const fromConn = m.managerRhAccountFromConnector({
    account: { account_number: "995386158", brokerage_account_type: "agentic", agentic_allowed: true, option_level: "option_level_2" },
    portfolio: { cash: "0", buying_power: { buying_power: "0.0000" } },
    asOf: "2026-10-06T01:50:00.000Z",
  });
  check("connector mapper (Agentic, unfunded)", [fromConn.accountNumber, fromConn.accountMaskLast4, fromConn.optionsBuyingPowerUsd, fromConn.agenticAllowed, fromConn.canFillEnvelope, fromConn.isSnapshot], ["995386158", "6158", 0, true, false, false]);
  const connNoBp = m.managerRhAccountFromConnector({ account: { account_number: "995386158", agentic_allowed: true, option_level: "option_level_2" }, portfolio: { cash: "1000" } });
  check("connector missing buying_power → gate bp_unknown", m.accountPlaceGate(connNoBp).gate, "bp_unknown");

  check("gate refuses null account", m.accountPlaceGate(null).ok, false);
  check("gate refuses default Agentic $0 snapshot", m.accountPlaceGate(d).ok, false);
  check("gate refuses Individual snapshot (wrong account)", m.accountPlaceGate(ind).gate, "bp_wrong_account");
  const funded = m.toManagerRhAccount({ cashUsd: 1000, optionsBuyingPowerUsd: 1000, agenticAllowed: true, optionLevel: "option_level_2", accountNumber: "995386158", label: "Agentic" });
  check("gate passes fresh funded Agentic", m.accountPlaceGate(funded).ok, true);
  check("gate refuses Individual even if accessible + funded", m.accountPlaceGate({ ...funded, accountNumber: "415577477", accountMaskLast4: "7477" }).gate, "bp_wrong_account");
  check("gate refuses mask-only 6158 (no account number)", m.accountPlaceGate({ ...funded, accountNumber: null }).gate, "bp_wrong_account");
  check("gate refuses funded snapshot", m.accountPlaceGate({ ...funded, isSnapshot: true }).gate, "bp_snapshot");
  check("gate refuses NaN BP", m.accountPlaceGate({ ...funded, optionsBuyingPowerUsd: NaN }).gate, "bp_unknown");
  check("gate refuses low BP even with lying canFillEnvelope", m.accountPlaceGate({ ...funded, optionsBuyingPowerUsd: 11.56, canFillEnvelope: true }).gate, "bp_below_envelope");
  check("gate refuses debit > BP", m.accountPlaceGate({ ...funded, optionsBuyingPowerUsd: 300 }, { requiredDebitUsd: 400 }).gate, "bp_ticket");

  // Hard BP gate (rh-autofire-gates.ts) also needs a fresh get_portfolio read at review.
  const NOW = Date.UTC(2026, 9, 6, 13, 35, 0);
  const fresh = { label: "Agentic ••6158", accountNumber: "995386158", accountType: "limited_margin", cash: 1000, buyingPower: 1000, agenticAllowed: true, optionLevel: "option_level_2", asOfMs: NOW, source: "get_portfolio" };
  const base = { gatesStillOk: true, liveArmedNow: true, confirmedInWriting: true, reviewHadBlockingAlert: false, agenticAllowed: true, optionsLevelOk: true, accountAtReview: fresh, debitTotal: 400, nowMs: NOW };
  check("mayPlaceAfterReview refuses when Manager account key absent", rh.mayPlaceAfterReview(base).ok, false);
  check("mayPlaceAfterReview refuses default account", rh.mayPlaceAfterReview({ ...base, account: d }).ok, false);
  check("mayPlaceAfterReview refuses null account", rh.mayPlaceAfterReview({ ...base, account: null }).ok, false);
  check("mayPlaceAfterReview refuses Individual block", rh.mayPlaceAfterReview({ ...base, account: { ...funded, accountNumber: "415577477" } }).ok, false);
  check("mayPlaceAfterReview ok with fresh funded Agentic", rh.mayPlaceAfterReview({ ...base, account: funded }).ok, true);
  check("Manager block ok but no fresh get_portfolio → refuse (hard BP gate)", rh.mayPlaceAfterReview({ ...base, account: funded, accountAtReview: undefined }).ok, false);
}
