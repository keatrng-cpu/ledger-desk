/**
 * The research. One page per name, same columns, no exceptions.
 *
 * HOW TO READ THE GOVERNANCE BLOCK
 * `ceoSince: null` and `chair: null` are not laziness — they are the honest
 * state of a fact I could not confirm from a primary source in the session
 * that wrote this file. A null chair does not block a buy; a blank CEO
 * does, because "who is allocating the capital" is the whole point of the
 * column. Where a name is carried with an unconfirmed operator, the caveat
 * says so and the gate refuses it until someone checks the proxy statement.
 * That is the design: an unverified field costs you the trade, not your
 * memory of whether you verified it.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN
 * A score. There is no composite number ranking these names, because a
 * composite would launder a dozen judgement calls into one authoritative
 * digit and invite exactly the behaviour this tab exists to prevent — a
 * green number, a click, a five-year hold bought on a Tuesday impulse.
 * The columns stay separate and the trader does the weighing.
 *
 * THE PRICE COLUMN IS MISSING ON PURPOSE TOO
 * Nothing here says "buy below $X". A target price is a forecast wearing a
 * decimal point. What the tab does instead is show the forward multiple
 * against the 5.01% ten-year (captured 2026-09-18) so the comparison is
 * against the actual risk-free alternative rather than against a number
 * someone made up.
 */

import type { Dossier } from "./universe";

/**
 * The ten-year Treasury yield this file was written against, from
 * Alpha Vantage TREASURY_YIELD on the date shown. Every "is this cheap"
 * question on the tab is really "cheap against what", and this is the what.
 * Refresh it with the capture script; do not update it from memory.
 */
export const RISK_FREE = { yieldPct: 5.01, asOf: "2026-09-18", source: "alphavantage TREASURY_YIELD 10y" };

/**
 * BALLAST — the return you cannot out-think.
 *
 * VTI and ITOT are here and VOO is not, and that ordering is the single
 * most consequential line in the file. VOO is the default recommendation
 * everywhere, including from the other desk assistant. For a trader who
 * sells SPY options it is the wrong fund: same index, wash-sale ambiguity,
 * and nothing gained by taking the risk. Total market costs nothing extra
 * and moves the pair into the swap practitioners treat as clean.
 */
export const BALLAST: Dossier[] = [
  {
    ticker: "VTI",
    name: "Vanguard Total Stock Market ETF",
    kind: "fund",
    sleeve: "ballast",
    sells: "Every listed US company, weighted by size, in one line.",
    whoPays: "n/a — a fund, not a business. The holdings' customers are the whole US economy.",
    moat: "Cost and breadth. Nothing to out-think and nobody to out-manage.",
    useIn2035:
      "Yes by construction: if the index composition changes, the fund changes with it. This is the only holding on the tab that does not need a thesis to survive.",
    cycle: "structural",
    governance: {
      ceo: "n/a — index fund, no operating management",
      founderLed: false,
      ceoSince: null,
      chair: null,
      dualClass: false,
      insiderPct: null,
      successionNote: null,
    },
    killRule:
      "None. This position is never sold on a thesis break because it has no thesis. It is sold only to fund a life event, never to fund a trade.",
    maxWeight: 0.65,
    regulatory: null,
    caveat:
      "Total market is ~80%+ the same large caps as the S&P by weight, so the diversification versus VOO is real but modest. The reason to prefer it here is tax entanglement, not return.",
  },
  {
    ticker: "ITOT",
    name: "iShares Core S&P Total US Stock Market ETF",
    kind: "fund",
    sleeve: "ballast",
    sells: "The same job as VTI from a different issuer, tracking a different index provider.",
    whoPays: "n/a — a fund.",
    moat: "Cost and breadth.",
    useIn2035: "Yes, same construction argument as VTI.",
    cycle: "structural",
    governance: {
      ceo: "n/a — index fund, no operating management",
      founderLed: false,
      ceoSince: null,
      chair: null,
      dualClass: false,
      insiderPct: null,
      successionNote: null,
    },
    killRule: "None — see VTI.",
    maxWeight: 0.65,
    regulatory: null,
    caveat:
      "Holding BOTH VTI and ITOT is pointless duplication and arguably a wash-sale pair with each other. Pick one and stay with it.",
  },
  {
    ticker: "VXUS",
    name: "Vanguard Total International Stock ETF",
    kind: "fund",
    sleeve: "ballast",
    sells: "Developed and emerging markets outside the US.",
    whoPays: "n/a — a fund.",
    moat: "Breadth, and the only genuine diversification available on this tab.",
    useIn2035:
      "Yes. It is also the only line here that pays off in the specific world where US large-cap tech stops leading, which is precisely the world where both the options sleeve and the rest of this book do badly.",
    cycle: "structural",
    governance: {
      ceo: "n/a — index fund, no operating management",
      founderLed: false,
      ceoSince: null,
      chair: null,
      dualClass: false,
      insiderPct: null,
      successionNote: null,
    },
    killRule: "None.",
    maxWeight: 0.15,
    regulatory: null,
    caveat:
      "Has underperformed US equity for most of the last fifteen years, which is exactly why it is uncomfortable to hold and exactly why it diversifies. Do not judge it on trailing return.",
  },
  {
    ticker: "SGOV",
    name: "iShares 0-3 Month Treasury Bond ETF",
    kind: "fund",
    sleeve: "drypowder",
    sells: "Very short Treasury bills. The place dry powder waits.",
    whoPays: "n/a — a fund.",
    moat: "None needed. This is the risk-free rate in a wrapper.",
    useIn2035: "Yes — cash is always useful, and at a 5.01% ten-year the competing yield is not nothing.",
    cycle: "structural",
    governance: {
      ceo: "n/a — index fund, no operating management",
      founderLed: false,
      ceoSince: null,
      chair: null,
      dualClass: false,
      insiderPct: null,
      successionNote: null,
    },
    killRule: "None. Spent on the buy list at a -20% book drawdown, not on a good idea.",
    maxWeight: 0.15,
    regulatory: null,
    caveat:
      "At this book size a cash sleeve is mostly theatre — 12% of a $60 book is $7. It becomes real in year two or three. Broker sweep interest on idle RH cash may beat it net of any friction; check before buying a fund to hold cash.",
  },
];

/**
 * COMPOUNDERS — businesses that should still matter in 2035.
 *
 * Every one of these is carried with its problems stated. A dossier that
 * only lists reasons to own is an advertisement.
 */
export const COMPOUNDERS: Dossier[] = [
  {
    ticker: "GOOGL",
    name: "Alphabet Inc. Class A",
    kind: "company",
    sleeve: "compounder",
    sells: "Search advertising, YouTube, and cloud infrastructure.",
    whoPays: "Advertisers (the cash engine), enterprises (cloud), consumers (indirectly, with attention).",
    moat: "Distribution and data at a scale nobody can rebuild — default search placement, YouTube's library, and the ad auction that monetises both.",
    useIn2035:
      "Yes, and this is the one megacap whose AI exposure is a cost line rather than the whole thesis: if model capex normalises 40% the search and YouTube cash flows are still there.",
    cycle: "structural",
    governance: {
      ceo: "Sundar Pichai",
      founderLed: false,
      ceoSince: 2015,
      chair: null,
      dualClass: true,
      insiderPct: 1.596,
      successionNote:
        "Founders Page and Brin retain supervoting Class B stock and therefore control the company without running it. Buying GOOGL means accepting you have no vote.",
    },
    killRule:
      "An antitrust remedy that actually severs default search placement or forces divestiture of YouTube or Ad Manager — not a fine, not an appeal, an executed structural remedy.",
    maxWeight: 0.08,
    regulatory:
      "Permanent antitrust tax in both the US and EU. Treat legal expense as a recurring cost of doing business, not a one-off.",
    caveat:
      "The 17.8 trailing P/E is the lowest of the megacaps here and looks like a bargain, but forward P/E is 23.2 — HIGHER than trailing. That inversion means the market expects earnings to FALL, and the 294% trailing earnings growth confirms the trailing number is flattered by a one-off comparison. Do not buy this on the headline multiple.",
  },
  {
    ticker: "MSFT",
    name: "Microsoft Corporation",
    kind: "company",
    sleeve: "compounder",
    sells: "Enterprise software, Azure cloud, and the distribution layer for commercial AI.",
    whoPays: "Enterprises, overwhelmingly, on multi-year contracts.",
    moat: "Switching cost. Office and Windows are installed in the workflow of essentially every large organisation, and Azure is sold to the people who already sign those cheques.",
    useIn2035:
      "Yes. If models commoditise, the company that owns enterprise distribution captures more of the value, not less. That is the unusual property here.",
    cycle: "structural",
    governance: {
      ceo: "Satya Nadella",
      founderLed: false,
      ceoSince: 2014,
      chair: null,
      dualClass: false,
      insiderPct: 0.091,
      successionNote: null,
    },
    killRule:
      "Azure growth below 10% for four consecutive quarters, or an OpenAI stake written down while capex stays elevated. Either one breaks the 'capex becomes revenue' claim.",
    maxWeight: 0.08,
    regulatory: "Cloud and bundling scrutiny in the EU. Chronic, not existential.",
    caveat:
      "40.3% profit margin and 45.1% operating margin are extraordinary and are the thing to watch: AI infrastructure is capital-hungry in a way the old software business never was. Capex that never becomes free cash flow is the warning sign, and it will show up in margin before it shows up in the narrative.",
  },
  {
    ticker: "V",
    name: "Visa Inc. Class A",
    kind: "company",
    sleeve: "compounder",
    sells: "The rails that move card payments. Not credit — the network.",
    whoPays: "Banks and merchants, per transaction, forever.",
    moat: "A two-sided network with sixty years of head start and 66.1% operating margins to prove it. Nobody has built a competing global network from scratch in a generation.",
    useIn2035:
      "Yes. Payment volume tracks nominal GDP, which means this is one of the few holdings here with a built-in inflation pass-through.",
    cycle: "structural",
    governance: {
      ceo: "Ryan McInerney",
      founderLed: false,
      ceoSince: 2023,
      chair: null,
      dualClass: true,
      insiderPct: 0.085,
      successionNote:
        "Multi-class structure (A/B/C) is a legacy of the bank ownership at IPO rather than founder control. Class A holders vote; the economics are clean.",
    },
    killRule:
      "Interchange regulation that caps network fees in the US, or a real-time bank-transfer rail achieving material merchant adoption at the point of sale.",
    maxWeight: 0.06,
    regulatory:
      "Interchange is politically exposed in every jurisdiction. This is the single largest risk and it is a legislative one, not a competitive one.",
    caveat:
      "90.2% institutional ownership is the highest in this universe. There is no undiscovered value here; it is priced as the quality compounder it is, at 31.5 trailing.",
  },
  {
    ticker: "COST",
    name: "Costco Wholesale Corp",
    kind: "company",
    sleeve: "compounder",
    sells: "A membership. The retail is close to a break-even service provided to members.",
    whoPays: "Consumers, annually, in advance — with renewal rates that behave like a subscription business.",
    moat: "Scale purchasing passed back to the member, which raises renewal, which raises scale. Genuinely hard to copy because it requires accepting a 3.0% profit margin on purpose.",
    useIn2035: "Yes. This is the least AI-dependent holding in the book and that is the reason it is here.",
    cycle: "structural",
    governance: {
      ceo: "Ron Vachris",
      founderLed: false,
      ceoSince: 2024,
      chair: null,
      dualClass: false,
      insiderPct: 0.163,
      successionNote: "CEO seat changed hands recently; the operating culture is the asset, not the operator.",
    },
    killRule: "Membership renewal rate falling below 88% in the US, or a membership fee increase that fails to stick.",
    maxWeight: 0.06,
    regulatory: null,
    caveat:
      "45.2 trailing P/E for a 3.0% margin retailer growing revenue 11.6% is the most expensive thing in this book relative to what it does. Everyone knows the story. You are paying a large premium for durability, and at a 5.01% risk-free rate that premium has a real opportunity cost.",
  },
  {
    ticker: "LLY",
    name: "Eli Lilly and Company",
    kind: "company",
    sleeve: "compounder",
    sells: "Pharmaceuticals, dominated now by incretin (GLP-1) therapies.",
    whoPays: "Insurers, governments, and increasingly consumers directly.",
    moat: "Patents plus manufacturing capacity. The second is underrated — peptide capacity at scale took years and billions to build and cannot be conjured by a competitor with a good molecule.",
    useIn2035:
      "Conditional, and this is the honest answer: the current franchise faces patent expiry in the 2030s. Whether Lilly matters in 2035 depends on the pipeline, not on today's revenue.",
    cycle: "cyclical",
    governance: {
      ceo: "David Ricks",
      founderLed: false,
      ceoSince: 2017,
      chair: null,
      dualClass: false,
      insiderPct: 0.157,
      successionNote: null,
    },
    killRule:
      "Incretin pricing cut by US policy below the level that funds R&D, or two consecutive phase-3 pipeline failures in the post-GLP-1 programmes.",
    maxWeight: 0.05,
    regulatory:
      "Drug pricing is the most directly political line item in this book. Medicare negotiation is law and expands over time.",
    caveat:
      "Beta 0.502 — the lowest here, and the main reason it earns a place next to an options sleeve that is levered long tech. 47.7% revenue growth is exceptional and will not persist; the forward P/E of 24.5 against 39.2 trailing is the market already saying so.",
  },
];

/**
 * WATCH — researched, not buyable, and each one blocked for a stated reason.
 *
 * These are the names the AI-infrastructure story points at. Two of them
 * carry a fact that the story does not mention and that the fundamentals
 * snapshot makes unavoidable, so they are carried here rather than quietly
 * dropped.
 */
export const WATCH: Dossier[] = [
  {
    ticker: "NVDA",
    name: "NVIDIA Corporation",
    kind: "company",
    sleeve: "compounder",
    sells: "The training and inference silicon the entire AI build-out runs on, plus the CUDA software lock-in.",
    whoPays: "A handful of hyperscalers. Customer concentration is the thesis risk, not a footnote.",
    moat: "CUDA. The software ecosystem is a deeper moat than the chips and it is the thing a competitor cannot fab around.",
    useIn2035:
      "Unresolved. If AI capex normalises 40% this is the name that takes it, and 'the bottleneck of the build-out' is a description of today rather than a durable position.",
    cycle: "exposed",
    governance: {
      ceo: "Jensen Huang",
      founderLed: true,
      ceoSince: 1993,
      chair: null,
      dualClass: false,
      insiderPct: 4.008,
      successionNote:
        "Founder-CEO for 33 years and 4.0% insider ownership — by far the highest owner-operator alignment in this universe. It is also the highest key-person risk in the book.",
    },
    killRule:
      "An export-control regime that cuts data-center revenue run-rate by 30%, or a hyperscaler's in-house silicon displacing a full training generation.",
    maxWeight: 0.05,
    regulatory:
      "Export controls are an active, bipartisan, and unpredictable policy instrument pointed directly at this revenue line.",
    caveat:
      "Beta 2.217 — more than twice the market, and more than double anything else here. A 5% position in NVDA carries roughly the swing of an 11% position in VTI. The PEG of 0.47 says 'cheap against growth'; the beta says the growth assumption is the whole position. Size it as the volatility it is, not the multiple it shows.",
  },
  {
    ticker: "AAPL",
    name: "Apple Inc.",
    kind: "company",
    sleeve: "compounder",
    sells: "Hardware that carries an increasingly large, increasingly high-margin services attachment.",
    whoPays: "Consumers, plus Google for search default placement — a payment that is itself an antitrust exhibit.",
    moat: "Brand and ecosystem switching cost, the highest consumer consent of anything in this book.",
    useIn2035: "Yes on the installed base; the open question is whether it leads or rents the AI layer.",
    cycle: "structural",
    governance: {
      ceo: "Tim Cook",
      founderLed: false,
      ceoSince: 2011,
      chair: null,
      dualClass: false,
      insiderPct: 1.648,
      successionNote:
        "A CEO transition is the live governance question here and has been widely reported as imminent. That is a research item to resolve before buying, not a headline to react to.",
    },
    killRule:
      "Loss of the Google search default payment without replacement, or two consecutive years of services revenue decline.",
    maxWeight: 0.06,
    regulatory: "App Store economics under attack in the EU and US simultaneously.",
    caveat:
      "38.9 trailing and 35.1 forward — the smallest gap between the two of any megacap here, meaning the market expects little earnings growth to bail out the multiple. Analyst ratings are also the weakest in this universe: 5 sell-side sell or strong-sell ratings against 25 buys, where MSFT has zero. Not disqualifying, but it is the only megacap here with visible dissent.",
  },
  {
    ticker: "ETN",
    name: "Eaton Corporation PLC",
    kind: "company",
    sleeve: "compounder",
    sells: "Electrical power management — switchgear, distribution, the physical layer data centers cannot run without.",
    whoPays: "Data center builders, utilities, industrials, aerospace.",
    moat: "Installed base, specification lock-in, and long lead times on grid-critical equipment.",
    useIn2035: "Yes — electricity demand is the most durable part of the AI story and the least dependent on which model wins.",
    cycle: "cyclical",
    governance: {
      ceo: "",
      founderLed: false,
      ceoSince: null,
      chair: null,
      dualClass: false,
      insiderPct: 0.072,
      successionNote: null,
    },
    killRule: "Data center electrical orders declining two consecutive quarters while backlog shrinks.",
    maxWeight: 0.05,
    regulatory: null,
    caveat:
      "BLOCKED, and for two independent reasons. First, I could not confirm the current CEO from a primary source, so the governance column is blank and the gate refuses it — go read the proxy. Second, and more interesting: quarterly EARNINGS GROWTH IS -15.9% while revenue grew 21.4%, at a 44.4 trailing P/E. The picks-and-shovels story is being priced as a growth compounder while its actual earnings are falling. That deserves an answer before a dollar goes in.",
  },
  {
    ticker: "CEG",
    name: "Constellation Energy Corp",
    kind: "company",
    sleeve: "compounder",
    sells: "Nuclear and other generation, increasingly under long-term contracts to data centers.",
    whoPays: "Utilities, states, and hyperscalers signing multi-decade power purchase agreements.",
    moat: "You cannot build a nuclear fleet. The existing one is the asset and it is not reproducible on any relevant timescale.",
    useIn2035: "Yes, structurally — the reactors will still be there and electricity demand is not falling.",
    cycle: "cyclical",
    governance: {
      ceo: "Joe Dominguez",
      founderLed: false,
      ceoSince: 2022,
      chair: null,
      dualClass: false,
      insiderPct: 0.335,
      successionNote: null,
    },
    killRule:
      "A data center power purchase agreement cancelled or renegotiated downward, or merchant power prices falling below the contracted floor for two quarters.",
    maxWeight: 0.04,
    regulatory:
      "NRC licensing and FERC interconnection rules are the business. A regulatory change here is not a headwind, it is the P&L.",
    caveat:
      "Quarterly earnings growth of -46.8% against 23.0% revenue growth, and the stock sits around 40% below its 52-week high of 410.41 with the 50-day below the 200-day. The AI-power narrative and this company's actual earnings are pointing in opposite directions right now. That does not make it a bad business — it makes the current price a question rather than an entry.",
  },
];

export const ALL_DOSSIERS: Dossier[] = [...BALLAST, ...COMPOUNDERS, ...WATCH];

export function dossierFor(ticker: string): Dossier | null {
  return ALL_DOSSIERS.find((d) => d.ticker === ticker) ?? null;
}
