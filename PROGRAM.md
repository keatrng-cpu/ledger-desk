# Program Definition — DRAFT, NOT YET IN FORCE

**Status: unsigned draft. Do not seal this file until every `DECIDE:` block below is resolved.**

---

## Why this document exists, and why it is dated before the returns

A track record is a claim about a **program**: a defined strategy, run in
defined accounts, measured a defined way. If the definition is written after
the returns are known, every choice in it — which accounts counted, which
months counted, how the fee was modelled — is a choice made with knowledge of
the answer. A verifier, an examiner, and any allocator worth taking money from
all treat a definition written after the fact as worth approximately nothing,
and they are right to.

Writing it first is the only version that costs nothing and proves something.
That is the entire reason this file is being created before a single fill.

Once resolved and sealed (`npm run seal`, then commit and push), this document
is pinned to a public timestamp. Changing it later is permitted — strategies
evolve — but the change becomes visible and dated, which is the property that
makes the original credible.

---

## The decision this document forces first

**The MNQ/ES futures signal and the Robinhood QQQ/SPY options sleeve are two
different programs, and they cannot be one track record.**

Three independent reasons, each sufficient on its own:

1. **Different regulators.** Advising on MNQ/ES for compensation makes you a
   Commodity Trading Advisor (CFTC/NFA). Advising on QQQ/SPY options makes you
   an investment adviser (SEC or state). Two statutes, no overlap.
2. **CFTC Reg. 4.35 forbids combining them.** "Accounts that differ materially
   with respect to rates of return may not be presented in the same composite."
   A $150 options debit with a −25% working stop and a 1-contract MNQ position
   with a structural stop do not have the same return distribution.
3. **Relevance.** A futures record advertised to prospective *securities*
   clients is weak on relevance: MNQ/ES results do not straightforwardly
   evidence skill in QQQ/SPY options. The options sleeve is a *translation* of
   the futures signal, and the translation has its own error.

> **DECIDE: which program is the record?**
>
> - **(a) Futures only (MNQ/MES).** Trade the instrument the desk actually
>   models. Removes the translation error, and the CTA path it leads to is the
>   cheapest real license in the US. Recommended.
> - **(b) Options only (QQQ/SPY).** Keeps the current sleeve. Leads to the RIA
>   path, which costs more and where a 3-year record cannot populate the
>   5- and 10-year columns that Rule 206(4)-1(d)(2) requires with equal
>   prominence.
> - **(c) Both, as two separately-defined programs with two continuous,
>   never-merged records.** Legitimate but doubles the record-keeping and the
>   compliance calendar forever.
>
> Choosing (a) does not mean abandoning the options sleeve — it means the
> sleeve stops being part of the record and becomes what it already is:
> personal trading, kept separate.

---

## 1. Program identity

| Field | Value |
|---|---|
| Program name | `DECIDE:` |
| Instruments | `DECIDE:` — per the block above |
| Inception date | `DECIDE:` — the first day of the first full month traded under this definition. Once set, **the series may never have a gap.** A missing month is permanent and an excluded month is a cherry-picking finding. |
| Strategy | SMC/ICT sequence: draw on liquidity → sweep polarity → dealing-range half → LTF displacement + MSS → retrace into a fresh same-side array. Gated by `src/lib/aplus/config.ts` (confluence floor 0.65) and `src/lib/trading/profit-rules.ts` (one book/day, ~9 PATH/month, per-killzone cap, daily/weekly halt). |
| Discretion | Full discretion, single decision-maker. Entries require the mechanical gate to pass; the gate may never be overridden upward. Standing down on a passing gate is permitted and is journaled. |

## 2. Accounts

| Field | Value |
|---|---|
| Custodian | `DECIDE:` — see the custody note below |
| Account(s) included | `DECIDE:` — objective criterion, not a list to be curated later |
| Inclusion rule | **Every** account traded under this strategy is in the record. No account is added or removed based on its performance. |
| Capital source | Proprietary (the trader's own money). This must be **prominently labelled as proprietary** and set forth separately in any presentation — CFTC Reg. 4.35 requires it, and the same disclosure discipline satisfies the SEC side. |

**Custody note.** The record's evidential value comes from records a third
party produced and can hand over without touching your machine. The practical
test is whether a CPA or verifier can be given direct, read-only,
**trade-level, machine-readable** access. A broker that exports only PDF
statements through an app fails that test. This is not brand preference — it
is the difference between "my journal says" and "the custodian's file says."

## 3. Measurement

| Field | Value |
|---|---|
| Return method | Time-weighted return, **compounded monthly**, per CFTC Reg. 4.35: net performance divided by beginning net asset value. |
| Nominal account size | `DECIDE:` — **required, and required NOW.** NFA Interpretive Notice 9025 requires results computed at full nominal funding. Deciding this after a drawdown is the single most common way a futures track record becomes unusable. |
| Valuation timing | Month-end close, same source every month. Source labelled (`live_gateway` / Databento / Yahoo) per the desk's existing provenance discipline. |
| Gross vs net | Both, with net **at least as prominent** as gross, same methodology, same periods — Rule 206(4)-1(d)(1). |
| Model fee | `DECIDE:` — proprietary capital pays no advisory fee, so "net" must be computed using a **model fee equal to what would actually be charged**, and that fee must be disclosed. Pick it now; picking it later invites picking the flattering one. |
| Periods presented | 1-, 5- and 10-year with equal prominence, ending no less recent than the most recent calendar year-end, or the life of the program where shorter — Rule 206(4)-1(d)(2). CTA side: most recent five calendar years plus year-to-date — Reg. 4.35. |

## 4. Records

| Field | Value |
|---|---|
| Source records | Custodian daily and monthly statements **plus** trade-level export, preserved raw and append-only. |
| Retention | **6 years minimum**, first 2 readily accessible. (Advisers Act Rule 204-2(e)(1) and CFTC Reg. 1.31 both set 5; Exchange Act Rule 17a-4 sets 6 for the top tier. Keeping one policy at the longest figure is simpler than keeping three.) |
| Ex-ante decision record | Every PATH decision — grade, entry, stop, T1/T2, invalidation, quote source and `lagSec` — sealed into the hash chain at decision time (`src/lib/journal/attest.ts`), with the tip anchored publicly (`attestations/SEALS.log`). |
| Sole-authorship evidence | Sole login. No shared credentials. No undocumented third-party signals. Where an external input influenced a trade, it is named in the trade's `reason`. |

**Why sole authorship is a field and not an afterthought.** The controlling SEC
staff position on advertising performance earned in a personal account before
a firm existed (*Conway Asset Management*, 27 Jan 1989) turns on two
conditions: that **no individual or entity other than the named person played
a significant part** in the results, and that the advertised accounts were not
materially different from that person's other accounts. Both are unprovable in
hindsight. They are cheap to evidence contemporaneously and impossible to
manufacture later.

## 5. Standing prohibitions

These are not aspirations. Each one closes a door that cannot be reopened.

1. **No backtest or hypothetical equity curve is ever published in connection
   with this program.** NFA Compliance Rule 2-29(c)(4) prohibits hypothetical
   presentation outright once three months of actual results exist for a
   program. One public backtest chart creates a document that must be
   reconciled forever. The desk's TradeZella backtest stays internal.
2. **No holding out.** Advising 15 or fewer persons *and* not holding yourself
   out generally to the public is a self-executing CTA exemption requiring no
   filing at all. Publishing a track record to attract allocators is holding
   out. The sequence is record → entity → registration → publish, never
   publish → registration.
3. **No simulated-fill platform is ever presented as the record.** Evaluation
   accounts and signal-copying platforms produce results not achieved by any
   real portfolio, which is the definition of hypothetical performance. They
   may be marketing. They may never be the track record.
4. **No gap, no exclusion, no restatement of a closed month.** Corrections go
   through an `amend` link that is itself sealed and dated.

## 6. What the hash chain does and does not claim

Stated plainly here so it is never overstated to anyone else.

**It claims:** these records existed, in this form, no later than the date of
the public seal that covers them. Because each link commits to the one before
it, altering any historical trade breaks every later link — including links
whose hashes are already published.

**It does not claim:** that the trades were profitable, that they were executed
at the prices stated, or that they were executed at all. **Custodian statements
prove what filled. The chain proves what was said before it filled.** Only the
pair is interesting, and neither substitutes for the other.

**It is also not a compliance deliverable.** No rule that would apply here
requires it: Advisers Act Rule 204-2 has no WORM or audit-trail mandate, and
Exchange Act Rule 17a-4(f) — which does — applies to broker-dealers, which this
is not. The chain exists because the *ex-ante* question ("did you really call
it before it happened?") is the one question a track record normally cannot
answer, not because anyone demands it.

---

## Sign-off

This definition takes effect when every `DECIDE:` is resolved, this file is
committed, and `npm run seal` has anchored the chain tip in a pushed commit.

| | |
|---|---|
| Resolved on | — |
| Program inception | — |
| First seal commit | — |
