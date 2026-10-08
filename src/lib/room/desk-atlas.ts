/**
 * The desk brain. Forge Atlas is a markdown packet you re-read. This is the
 * thing the floor actually uses.
 *
 * Read order, and it is enforced:
 *   1. NOW — one line per topic. A new fact replaces the line. It does not append.
 *   2. recall(query) — the one node that matches, plus the nodes it touches.
 *   3. A shelf, only when that shelf is the question.
 * The settled SMC book is pinned. Speech quotes the line, not the textbook.
 *
 * Characters write. A close, a new card, or a person at the brain tab improves
 * a node in place and keeps the prior text on the node. Confidence moves when
 * the tape agrees or does not. Nothing here places a trade.
 *
 * The four schools (ICT, TJR, PB Blake, PB Patty) are seeded from the trader's own
 * description (src/data/school-brief.json): nine facets each plus the two hybrids,
 * pinned on the SMC shelf. A school node answers `recall` only when the query names
 * the school, so "bias" or "target" alone still reach the desk's own lines.
 */
import { noteNerve } from "./brain-traffic";
import { BOOK } from "./brain-feed";
import { FACETS, HYBRIDS, SCHOOL_AVATAR, SCHOOL_BRIEF, SCHOOL_KEYS, SCHOOL_SAY, type Facet, type SchoolKey } from "@/lib/trading/school-brief";

export type AtlasShelf = "now" | "discretion" | "smc" | "market" | "backtest";

export interface AtlasPrior {
  at: number;
  text: string;
}

export interface AtlasNode {
  id: string;
  shelf: AtlasShelf;
  title: string;
  text: string;
  who: string;
  at: number;
  /** 0–100. Pinned teaching starts high. A fresh observation starts low. */
  confidence: number;
  /** Times this node was confirmed or rewritten. */
  n: number;
  pinned: boolean;
  tags: string[];
  prior: AtlasPrior[];
}

export interface AtlasEdge {
  from: string;
  to: string;
  why: string;
}

export interface DeskAtlas {
  version: 1;
  updatedAt: number;
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  last: { cardKey: string | null; hour: number; exitId: string | null; news: boolean };
}

export interface AtlasPulse {
  nowMs: number;
  etMin: number;
  cardKey: string | null;
  cardLine: string | null;
  exitId: string | null;
  exitLine: string | null;
  newsOn: boolean;
}

export interface AtlasRecall {
  hit: AtlasNode | null;
  neighbors: AtlasNode[];
  /** True when the hit is pinned or already confirmed — do not re-teach it. */
  settled: boolean;
}

export const ATLAS_KEY = "ledger-desk-atlas-v1";
export const ATLAS_EVENT = "ledger-atlas";

const SHELVES: AtlasShelf[] = ["now", "discretion", "smc", "market", "backtest"];

type Seed = Omit<AtlasNode, "at" | "prior">;

const SEED: Seed[] = [
  { id: "now:account", shelf: "now", title: "Account", who: "Vince", confidence: 90, n: 1, pinned: true, tags: ["robinhood", "agentic"], text: "Robinhood Agentic ••6158 is the only account. Buying power is live. Alpaca is not a broker." },
  { id: "now:goal", shelf: "now", title: "Goal", who: "Gemma", confidence: 90, n: 1, pinned: true, tags: ["goal"], text: "Turn this account into $5,000 in 30 trading days. Size is the lever. A new rule is not." },
  { id: "now:session", shelf: "now", title: "Session", who: "Gemma", confidence: 80, n: 1, pinned: true, tags: ["session", "clock"], text: "The chart leads until 16:00 ET. Eleven o'clock cuts size. It does not stop the search." },
  { id: "now:entry", shelf: "now", title: "Entry", who: "Nova", confidence: 88, n: 1, pinned: true, tags: ["entry", "ce", "chase"], text: "A missed touch waits for the pullback into the array or its CE. An extension is not an entry." },
  { id: "now:card", shelf: "now", title: "Card", who: "Nova", confidence: 60, n: 0, pinned: false, tags: ["card"], text: "No live card yet. Do not invent one." },
  { id: "now:school", shelf: "now", title: "School", who: "Nova", confidence: 80, n: 1, pinned: true, tags: ["school", "ict", "tjr"], text: "No school read yet. The four schools grade the card that is on." },
  { id: "now:chart", shelf: "now", title: "Chart", who: "Gemma", confidence: 80, n: 1, pinned: true, tags: ["chart", "ladder", "nq", "es"], text: "No chart read yet. NQ and ES structure lands here, higher, middle, and lower." },
  { id: "now:backtest", shelf: "now", title: "Backtest", who: "Vince", confidence: 80, n: 1, pinned: true, tags: ["backtest", "lesson"], text: "No new backtest lesson. The joint book stays on the backtest shelf." },
  { id: "now:journal", shelf: "now", title: "Journal", who: "Sterling", confidence: 80, n: 1, pinned: true, tags: ["journal", "close", "grok"], text: "Grok reports back to this floor: whether the ticket was taken, the pnl, and a journal paragraph. Sterling reads that onto the book." },
  { id: "now:precision", shelf: "now", title: "Precision", who: "Jax", confidence: 80, n: 1, pinned: true, tags: ["tape", "noise", "lag"], text: "No precision read yet. Print age and the last minute's noise land here. A note, not a gate." },
  { id: "now:wire", shelf: "now", title: "Wire", who: "Vince", confidence: 92, n: 1, pinned: true, tags: ["wire", "databento", "robinhood", "grok", "chart", "floor", "brain", "strategy"], text: "One card is the wire. Databento or the live gateway is the futures tape, with its lag. The strategy, the chart levels, and the brain word are on that card. The floor hands a cleared ticket to Grok. Grok places on Robinhood Agentic and reports placed, stood, managing, or closed back onto this book. A stale tape is not armed. Nothing else places." },
  { id: "now:read", shelf: "now", title: "Read", who: "Vince", confidence: 84, n: 1, pinned: true, tags: ["read", "book"], text: "No book read yet. The book speaks once the chart and another line are both in." },
  { id: "now:news", shelf: "now", title: "News", who: "Gemma", confidence: 85, n: 1, pinned: true, tags: ["news"], text: "News and the clock change size and the bar to take it. They do not block a B+ or better when the chart is there." },
  { id: "disc:sterling", shelf: "discretion", title: "Sterling", who: "Sterling", confidence: 84, n: 1, pinned: true, tags: ["sterling", "veto"], text: "Sterling's ledger is a note. It is not a veto." },
  { id: "disc:place", shelf: "discretion", title: "Place", who: "Vince", confidence: 86, n: 1, pinned: true, tags: ["place", "robinhood", "grok"], text: "A cleared setup is handed to Grok on this floor. Grok hears what we say through the LedgerDesk connector, then reviews and places on Agentic. We do not place it ourselves." },
  { id: "disc:band", shelf: "discretion", title: "Band", who: "Nova", confidence: 86, n: 1, pinned: true, tags: ["band", "b+"], text: "B+ and higher are live. Below that is a note. B+ is one contract." },
  { id: "disc:envelope", shelf: "discretion", title: "Envelope", who: "Sterling", confidence: 82, n: 1, pinned: true, tags: ["risk", "size"], text: "Debit stays between $50 and $550, even when that is a large share of the account." },
  { id: "smc:sequence", shelf: "smc", title: "Sequence", who: "Nova", confidence: 92, n: 1, pinned: true, tags: ["sequence", "sweep", "displacement"], text: "The entries are AMD, TJR, reversal, the 1m to 5m inverse, and the gap tap. A missing step is a wait. The raid is not the fill." },
  { id: "smc:amd", shelf: "smc", title: "AMD", who: "Gemma", confidence: 88, n: 1, pinned: true, tags: ["amd", "judas"], text: "Accumulation is the range. Manipulation is the sweep. Distribution is the retrace after the shift. Do not buy the wick out of the range." },
  { id: "smc:tjr", shelf: "smc", title: "TJR", who: "Jax", confidence: 88, n: 1, pinned: true, tags: ["tjr", "sweep"], text: "Sweep, then the shift, then the retrace into the gap the displacement left. Stop beyond the sweep. Do not chase the break." },
  { id: "smc:reversal", shelf: "smc", title: "Reversal", who: "Vince", confidence: 86, n: 1, pinned: true, tags: ["reversal", "cisd"], text: "A reversal is a raid that failed and delivery that changed. A sweep that closed through and held is the break. Do not fade it." },
  { id: "smc:inverse", shelf: "smc", title: "Inverse", who: "Sterling", confidence: 88, n: 1, pinned: true, tags: ["inverse", "ifvg"], text: "After a sweep in bias, the entry is the 1m to 5m inverse. Five minutes is the highest. Do not enter inside the gap just traded into." },
  { id: "smc:gaptap", shelf: "smc", title: "Gap tap", who: "Nova", confidence: 86, n: 1, pinned: true, tags: ["gap", "continuation"], text: "A tap of the higher-timeframe gap, then displacement that leaves a gap, or the inverse of the gap the tap formed. Inside the gap is not the entry." },
  { id: "smc:ltf", shelf: "smc", title: "1m to 5m", who: "Sterling", confidence: 90, n: 1, pinned: true, tags: ["1m", "5m", "inverse"], text: "The 1m to 5m is the entry only. Every slower rung, on NQ and ES together, is the bias. A ladder against the trade is a note. It does not stand the ticket down." },
  { id: "smc:leader", shelf: "smc", title: "Leader", who: "Nova", confidence: 90, n: 1, pinned: true, tags: ["nq", "es", "smt"], text: "Read NQ and ES together. Trade the index that inverted first. The other stands down. An unswept PDH, PDL, or session pool is the bias." },
  { id: "smc:draw", shelf: "smc", title: "Open draw", who: "Gemma", confidence: 90, n: 1, pinned: true, tags: ["target", "draw"], text: "A pool or a gap that already traded is spent. No second entry in the same leg." },
  { id: "smc:sweep", shelf: "smc", title: "Liquidity", who: "Jax", confidence: 90, n: 1, pinned: true, tags: ["liquidity", "sweep", "raid"], text: "Liquidity is the pool of stops. The sweep takes it. The fill is after the sweep, not during it." },
  { id: "smc:displacement", shelf: "smc", title: "Displacement", who: "Nova", confidence: 92, n: 1, pinned: true, tags: ["displacement", "mss"], text: "Displacement is the close that leaves the range. It confirms the shift. It is not the chase." },
  { id: "smc:inversion", shelf: "smc", title: "Inversion", who: "Nova", confidence: 90, n: 1, pinned: true, tags: ["inversion", "ifvg"], text: "An inversion is a close back through a broken level. The entry is that close, or the return to it." },
  { id: "smc:ifvg", shelf: "smc", title: "IFVG", who: "Nova", confidence: 88, n: 1, pinned: true, tags: ["ifvg", "fvg", "inversion"], text: "An IFVG is the gap that flipped. Trade the close that inverted, then the return into the gap." },
  { id: "smc:ce", shelf: "smc", title: "CE", who: "Vince", confidence: 90, n: 1, pinned: true, tags: ["ce", "entry"], text: "CE is the midpoint of a gap price is still inside. It is not a target out in the extension." },
  { id: "smc:mitigation", shelf: "smc", title: "Mitigation", who: "Sterling", confidence: 88, n: 1, pinned: true, tags: ["mitigation", "ob"], text: "A mitigation block is a failed second push into a prior zone. It is context. It is not the order." },
  { id: "smc:mss", shelf: "smc", title: "MSS", who: "Nova", confidence: 88, n: 1, pinned: true, tags: ["mss", "choch", "displacement"], text: "MSS breaks the dealing range the other way. Wait for displacement after it before calling it a shift." },
  { id: "smc:ob", shelf: "smc", title: "Order block", who: "Nova", confidence: 84, n: 1, pinned: true, tags: ["ob", "displacement"], text: "An order block is the last opposite candle before displacement. A close through it kills it." },
  { id: "smc:ote", shelf: "smc", title: "OTE", who: "Gemma", confidence: 80, n: 1, pinned: true, tags: ["ote", "ce"], text: "OTE is the 62–79% return into the leg. It is a location. It is not a signal by itself." },
  { id: "smc:po3", shelf: "smc", title: "Power of 3", who: "Gemma", confidence: 90, n: 1, pinned: true, tags: ["po3", "amd", "judas"], text: "Power of 3 is accumulation, the Judas manipulation, then distribution. Do not buy the wick out of the range." },
  { id: "smc:pd", shelf: "smc", title: "Premium and discount", who: "Gemma", confidence: 90, n: 1, pinned: true, tags: ["premium", "discount", "dealing"], text: "Longs take the array in discount. Shorts take it in premium. The dealing-range midpoint is the line between them. It is not an entry." },
  { id: "smc:dol", shelf: "smc", title: "Draw on liquidity", who: "Gemma", confidence: 90, n: 1, pinned: true, tags: ["dol", "erl", "irl"], text: "External liquidity is the draw. Internal liquidity is the partial. A pool that already traded is not the draw." },
  { id: "smc:bos", shelf: "smc", title: "Break of structure", who: "Vince", confidence: 88, n: 1, pinned: true, tags: ["bos", "choch"], text: "A break of structure continues the leg. A change of character is the first break the other way. Neither is the fill until a candle closes through." },
  { id: "smc:breaker", shelf: "smc", title: "Breaker", who: "Sterling", confidence: 88, n: 1, pinned: true, tags: ["breaker"], text: "A breaker is a failed order block that held from the other side. The entry is the return into it after the shift, not the break itself." },
  { id: "smc:smt", shelf: "smc", title: "SMT", who: "Nova", confidence: 90, n: 1, pinned: true, tags: ["smt", "nq", "es"], text: "SMT is NQ and ES failing to take the same high or low. It names the leader. It is not a ticket." },
  { id: "smc:killzone", shelf: "smc", title: "Kill zone", who: "Gemma", confidence: 86, n: 1, pinned: true, tags: ["killzone", "silver", "macro"], text: "ICT delivers in the London window, the New York index window, and the Silver Bullet hours. On this desk the clock changes size. It does not block the chart." },
  { id: "smc:retest", shelf: "smc", title: "Retest", who: "Vince", confidence: 90, n: 1, pinned: true, tags: ["retest", "poi"], text: "The fill is the retest of the gap or the order block the displacement left. The impulse is not the order." },
  { id: "mkt:hours", shelf: "market", title: "Hours", who: "Vince", confidence: 94, n: 1, pinned: true, tags: ["hours", "session"], text: "QQQ and SPY options trade 09:30–16:15 ET. There are no extended-hours options." },
  { id: "mkt:lunch", shelf: "market", title: "Lunch", who: "Gemma", confidence: 86, n: 1, pinned: true, tags: ["lunch", "size"], text: "Eleven to one is thinner. Size down. Keep reading the chart until the cash close." },
  { id: "mkt:judas", shelf: "market", title: "Judas", who: "Jax", confidence: 86, n: 1, pinned: true, tags: ["judas", "open"], text: "09:30–09:45 is the raid. The entry is after the sub-15m resolves, not on the spike." },
  { id: "mkt:open", shelf: "market", title: "Open", who: "Jax", confidence: 84, n: 1, pinned: true, tags: ["open", "retest"], text: "The cash open takes both sides. The first impulse is not the trade. The retest is." },
  { id: "mkt:bias", shelf: "market", title: "Bias", who: "Gemma", confidence: 84, n: 1, pinned: true, tags: ["bias", "htf"], text: "Higher-timeframe bias sizes the ticket. It does not erase a B+ sequence on the chart." },
  { id: "bt:path", shelf: "backtest", title: "PATH band", who: "Nova", confidence: 80, n: 1, pinned: true, tags: ["path", "band"], text: "PATH B+ and higher is the fire band. A grade below that does not get a ticket." },
  { id: "bt:paper", shelf: "backtest", title: "Paper record", who: "Vince", confidence: 82, n: 1, pinned: true, tags: ["paper", "robinhood"], text: "Paper fills are not a gate. Robinhood does not wait on an Alpaca record." },
  { id: "bt:chase", shelf: "backtest", title: "Chase", who: "Sterling", confidence: 78, n: 1, pinned: true, tags: ["chase", "ce"], text: "Chasing the extension after a missed CE is the losing pattern. The pullback is the measured entry." },
  { id: "bt:book", shelf: "backtest", title: "Joint book", who: "Vince", confidence: 82, n: 1, pinned: true, tags: ["book", "joint", "fit", "draw"], text: BOOK },
  { id: "bt:lunch", shelf: "backtest", title: "Lunch size", who: "Sterling", confidence: 74, n: 1, pinned: true, tags: ["lunch", "size"], text: "Full size through lunch is the leak. Afternoon size stays smaller. The search does not." },
];

export const schoolNodeId = (school: SchoolKey, facet: Facet): string => `school:${school}:${facet}`;
/** The words that name a school. A facet word ("bias", "target") does not: that is the desk's own line. */
const SCHOOL_NAMES = new Set(["ict", "tjr", "blake", "patty", "pb", "hybrid"]);

/** The trader's brief as brain nodes. A facet whose style differs from a measured desk rule carries that rule in the same node. */
function schoolSeeds(): Seed[] {
  const out: Seed[] = [];
  for (const s of SCHOOL_KEYS) {
    for (const f of FACETS) {
      const b = SCHOOL_BRIEF[s].facets[f];
      out.push({
        id: schoolNodeId(s, f),
        shelf: "smc",
        title: `${SCHOOL_SAY[s]} ${f}`,
        who: SCHOOL_AVATAR[s],
        confidence: 88,
        n: 1,
        pinned: true,
        tags: [s, SCHOOL_SAY[s].toLowerCase(), ...(s === "blake" || s === "patty" ? ["pb"] : []), f],
        text: b.deskNote ? `${b.short} ${b.deskNote}` : b.short,
      });
    }
  }
  const pair = { ict_tjr: ["ict", "tjr"], blake_patty: ["blake", "patty", "pb"] } as const;
  for (const id of ["ict_tjr", "blake_patty"] as const) {
    const h = HYBRIDS[id];
    out.push({
      id: `school:hybrid:${id}`,
      shelf: "smc",
      title: h.name,
      who: id === "ict_tjr" ? "Gemma" : "Nova",
      confidence: 84,
      n: 1,
      pinned: true,
      tags: ["hybrid", ...pair[id]],
      text: h.deskNote ? `${h.short} ${h.deskNote}` : h.short,
    });
  }
  return out;
}
SEED.push(...schoolSeeds());

function schoolEdges(): AtlasEdge[] {
  const out: AtlasEdge[] = [];
  for (const s of SCHOOL_KEYS) {
    out.push({ from: schoolNodeId(s, "bias"), to: schoolNodeId(s, "entry"), why: `${SCHOOL_SAY[s]}'s direction comes before its entry` });
    out.push({ from: schoolNodeId(s, "entry"), to: schoolNodeId(s, "target"), why: `where ${SCHOOL_SAY[s]} aims once in` });
    out.push({ from: schoolNodeId(s, "entry"), to: schoolNodeId(s, "arrays"), why: `the array ${SCHOOL_SAY[s]} rests at` });
    out.push({ from: "smc:sequence", to: schoolNodeId(s, "entry"), why: `${SCHOOL_SAY[s]}'s version of the sequence` });
  }
  out.push({ from: "school:hybrid:ict_tjr", to: schoolNodeId("ict", "entry"), why: "the OTE half" });
  out.push({ from: "school:hybrid:ict_tjr", to: schoolNodeId("tjr", "entry"), why: "the sweep and the first gap" });
  out.push({ from: "school:hybrid:blake_patty", to: schoolNodeId("blake", "timeframes"), why: "the 15 minute frame" });
  out.push({ from: "school:hybrid:blake_patty", to: schoolNodeId("patty", "entry"), why: "the breaker and gap" });
  return out;
}

const EDGES: AtlasEdge[] = [
  { from: "now:account", to: "disc:place", why: "the account Grok places on after the floor hands the ticket over" },
  { from: "now:goal", to: "disc:envelope", why: "size is how the goal is attempted" },
  { from: "now:entry", to: "smc:ce", why: "the missed-entry rule is the CE rule" },
  { from: "now:entry", to: "bt:chase", why: "the measured reason not to chase" },
  { from: "now:news", to: "mkt:lunch", why: "clock and news both size, neither blocks" },
  { from: "now:school", to: "smc:sequence", why: "the schools grade the sequence on the card" },
  { from: "now:chart", to: "mkt:bias", why: "the ladder is the chart's bias" },
  { from: "now:wire", to: "disc:place", why: "the floor hands the same card Grok places from" },
  { from: "now:wire", to: "now:chart", why: "the chart levels ride the card" },
  { from: "now:wire", to: "now:journal", why: "Grok's report comes back on the same card" },
  { from: "now:precision", to: "now:wire", why: "tape lag is on the card, and it is a note until it is stale" },
  { from: "now:precision", to: "now:chart", why: "the tape sits on the chart. It is a note, not a gate." },
  { from: "now:read", to: "now:card", why: "one line the five share, built from the lines already in the book" },
  { from: "now:school", to: "now:read", why: "the schools are in the one line" },
  { from: "now:precision", to: "now:read", why: "the tape is in the one line" },
  { from: "now:backtest", to: "bt:book", why: "a graded card joins the measured book" },
  { from: "now:journal", to: "bt:paper", why: "a close is what the journal remembers" },
  { from: "disc:sterling", to: "disc:band", why: "a note on size, not a stop" },
  { from: "disc:band", to: "bt:path", why: "the band the studies actually fired" },
  { from: "smc:sequence", to: "smc:amd", why: "the session cycle" },
  { from: "smc:sequence", to: "smc:tjr", why: "sweep, shift, retrace" },
  { from: "smc:sequence", to: "smc:reversal", why: "the failed raid" },
  { from: "smc:sequence", to: "smc:inverse", why: "the 1m to 5m close" },
  { from: "smc:sequence", to: "smc:gaptap", why: "continuation off the tap" },
  { from: "smc:sequence", to: "smc:ltf", why: "the minute the entry is on" },
  { from: "smc:sequence", to: "smc:leader", why: "which index gets the trade" },
  { from: "smc:sequence", to: "smc:draw", why: "the target has to still be open" },
  { from: "smc:sequence", to: "smc:sweep", why: "first step" },
  { from: "smc:sequence", to: "smc:displacement", why: "second step" },
  { from: "smc:sequence", to: "smc:inversion", why: "the close that counts" },
  { from: "smc:inversion", to: "smc:ifvg", why: "the gap the inversion leaves" },
  { from: "smc:ifvg", to: "smc:ce", why: "midpoint only while price is inside" },
  { from: "smc:displacement", to: "smc:mss", why: "a shift without displacement is a label" },
  { from: "smc:displacement", to: "smc:ob", why: "the candle displacement leaves behind" },
  { from: "smc:mitigation", to: "smc:ob", why: "a failed second push, not a new entry" },
  { from: "smc:ote", to: "smc:ce", why: "both are locations, not signals" },
  { from: "smc:amd", to: "smc:po3", why: "the session cycle is power of three" },
  { from: "smc:sequence", to: "smc:pd", why: "the array has to sit in the right half" },
  { from: "smc:draw", to: "smc:dol", why: "external liquidity is the draw" },
  { from: "smc:mss", to: "smc:bos", why: "a shift is a close, not a label" },
  { from: "smc:ob", to: "smc:breaker", why: "a failed block that held the other way" },
  { from: "smc:leader", to: "smc:smt", why: "the divergence that names the leader" },
  { from: "mkt:judas", to: "smc:killzone", why: "the open raid sits inside his hours" },
  { from: "smc:displacement", to: "smc:retest", why: "the impulse leaves the array the fill uses" },
  { from: "smc:pd", to: "smc:ote", why: "OTE is a discount or premium location" },
  { from: "mkt:judas", to: "mkt:open", why: "the raid and the retest" },
  { from: "mkt:bias", to: "disc:band", why: "bias sizes a live band" },
  { from: "mkt:lunch", to: "bt:lunch", why: "why lunch size is cut" },
  { from: "bt:paper", to: "disc:place", why: "the record that must not gate the account" },
];
EDGES.push(...schoolEdges());

function cloneSeed(now: number): DeskAtlas {
  return {
    version: 1,
    updatedAt: now,
    nodes: SEED.map((n) => ({ ...n, tags: [...n.tags], at: now, prior: [] })),
    edges: EDGES.map((e) => ({ ...e })),
    last: { cardKey: null, hour: -1, exitId: null, news: false },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function isAtlas(x: unknown): x is DeskAtlas {
  return !!x && typeof x === "object" && (x as DeskAtlas).version === 1 && Array.isArray((x as DeskAtlas).nodes);
}

export function loadAtlas(): DeskAtlas | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(ATLAS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isAtlas(parsed)) return null;
    // An atlas saved before a seed was added still gets it (the school nodes arrived 2026-10-07); a current one is returned as stored.
    return SEED.every((s) => parsed.nodes.some((n) => n.id === s.id)) ? parsed : mergeAtlas(parsed, null);
  } catch {
    return null;
  }
}

export function saveAtlas(a: DeskAtlas): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(ATLAS_KEY, JSON.stringify(a));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(ATLAS_EVENT));
  } catch {
    /* a full disk does not stop the floor */
  }
}

/** Keep every pinned seed, then the newer copy of anything both sides wrote. */
export function mergeAtlas(a: DeskAtlas | null | undefined, b: DeskAtlas | null | undefined, now = Date.now()): DeskAtlas {
  const base = cloneSeed(now);
  const incoming = [a, b].filter(isAtlas);
  if (!incoming.length) return base;
  const byId = new Map(base.nodes.map((n) => [n.id, n]));
  const seeds = new Map(base.nodes.map((n) => [n.id, n]));
  for (const src of incoming) {
    for (const n of src.nodes) {
      const cur = byId.get(n.id);
      // The seeds are stamped with the merge time, so "newer wins" let the seed beat every rewrite and every grade on every merge:
      // a live card's line went back to "No live card yet" and a school node lost what the tape had taught it. Against a seed, a stored
      // node wins when the brain has changed it (rewritten: it has a prior text; confirmed or graded: its count moved). An untouched
      // stored copy still gives way, so a seed edited in code reaches an atlas saved before the edit.
      const touched = (n.n ?? 1) > (cur?.n ?? 1) || (n.prior?.length ?? 0) > 0;
      const wins = !cur || (cur === seeds.get(n.id) ? touched : n.at >= cur.at);
      if (wins) byId.set(n.id, { ...n, prior: (n.prior ?? []).slice(0, 5), tags: n.tags ?? [] });
    }
  }
  const nodes = [...byId.values()].filter((n) => n.pinned || byId.has(n.id));
  const pinned = nodes.filter((n) => n.pinned);
  const rest = nodes.filter((n) => !n.pinned).sort((x, y) => y.at - x.at).slice(0, 40);
  const keep = new Set([...pinned, ...rest].map((n) => n.id));
  const edgeKey = (e: AtlasEdge) => `${e.from}>${e.to}`;
  const edges = new Map<string, AtlasEdge>();
  for (const e of base.edges) edges.set(edgeKey(e), e);
  for (const src of incoming) for (const e of src.edges ?? []) if (keep.has(e.from) && keep.has(e.to)) edges.set(edgeKey(e), e);
  const newest = incoming.reduce((m, s) => Math.max(m, s.updatedAt), 0);
  const lastSrc = incoming.reduce((m, s) => (s.updatedAt >= m.updatedAt ? s : m));
  return {
    version: 1,
    updatedAt: newest,
    nodes: [...pinned, ...rest],
    edges: [...edges.values()],
    last: lastSrc.last ?? base.last,
  };
}

export function nodeById(a: DeskAtlas, id: string): AtlasNode | null {
  return a.nodes.find((n) => n.id === id) ?? null;
}

export function shelfOf(a: DeskAtlas, shelf: AtlasShelf): AtlasNode[] {
  return a.nodes.filter((n) => n.shelf === shelf).sort((x, y) => y.confidence - x.confidence || y.at - x.at);
}

export function nowLines(a: DeskAtlas): AtlasNode[] {
  const order = ["now:read", "now:wire", "now:precision", "now:card", "now:school", "now:chart", "now:backtest", "now:journal", "now:entry", "now:session", "now:news", "now:account", "now:goal"];
  return order.map((id) => nodeById(a, id)).filter((n): n is AtlasNode => !!n);
}

export function neighborsOf(a: DeskAtlas, id: string): AtlasNode[] {
  const ids = new Set<string>();
  for (const e of a.edges) {
    if (e.from === id) ids.add(e.to);
    else if (e.to === id) ids.add(e.from);
  }
  return [...ids].map((x) => nodeById(a, x)).filter((n): n is AtlasNode => !!n);
}

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9+]+/).filter((w) => w.length > 1);
}

/** The one node the question needs, and what it touches. Not the book. */
export function recall(a: DeskAtlas, query: string): AtlasRecall {
  const q = tokens(query);
  if (!q.length) return { hit: null, neighbors: nowLines(a).slice(0, 4), settled: true };
  let best: AtlasNode | null = null;
  let score = 0;
  for (const n of a.nodes) {
    // A school's node answers only when the question names the school ("ict bias"); "bias" alone is the desk's own line.
    if (n.id.startsWith("school:") && !q.some((w) => SCHOOL_NAMES.has(w) && n.tags.includes(w))) continue;
    const bag = tokens(`${n.title} ${n.text} ${n.tags.join(" ")}`);
    let s = 0;
    for (const w of q) if (bag.includes(w)) s += n.title.toLowerCase().includes(w) ? 3 : 1;
    s += n.confidence / 100;
    if (s > score) {
      score = s;
      best = n;
    }
  }
  if (!best || score < 1.2) return { hit: null, neighbors: [], settled: false };
  return { hit: best, neighbors: neighborsOf(a, best.id).slice(0, 4), settled: best.pinned || best.confidence >= 75 };
}

/** One sentence for the floor. Settled teaching is not repeated. */
export function atlasSpeak(a: DeskAtlas | null | undefined, focus = ""): string | null {
  if (!a) return null;
  if (focus) {
    const r = recall(a, focus);
    if (r.hit && !r.settled) return r.hit.text;
    if (r.hit) return `${r.hit.title} is already settled. ${nodeById(a, "now:card")?.text ?? r.hit.text}`;
  }
  return nodeById(a, "now:card")?.text ?? nodeById(a, "now:entry")?.text ?? null;
}

function rewrite(a: DeskAtlas, id: string, text: string, who: string, now: number, bump: number): DeskAtlas {
  const cur = nodeById(a, id);
  if (!cur || cur.text === text) return a;
  noteNerve(who, "hub", cur.title, now);
  const next: AtlasNode = {
    ...cur,
    text,
    who,
    at: now,
    n: cur.n + 1,
    confidence: clamp(cur.confidence + bump, 8, 99),
    prior: [{ at: cur.at, text: cur.text }, ...cur.prior].slice(0, 5),
  };
  return { ...a, updatedAt: now, nodes: a.nodes.map((n) => (n.id === id ? next : n)) };
}

export function improveAtlas(a: DeskAtlas, input: { shelf: AtlasShelf; title: string; text: string; who?: string; nowMs?: number }): DeskAtlas {
  const text = input.text.trim();
  const title = input.title.trim();
  if (!text || !title) return a;
  const now = input.nowMs ?? Date.now();
  const who = input.who?.trim() || "Desk";
  const id = `${input.shelf}:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32)}`;
  const cur = nodeById(a, id);
  if (cur) return rewrite(a, id, text, who, now, 4);
  if (!SHELVES.includes(input.shelf) || input.shelf === "now") {
    const slot = nodeById(a, `now:${title.toLowerCase()}`);
    if (slot) return rewrite(a, slot.id, text, who, now, 2);
  }
  const node: AtlasNode = {
    id,
    shelf: input.shelf === "now" ? "discretion" : input.shelf,
    title,
    text,
    who,
    at: now,
    confidence: 48,
    n: 1,
    pinned: false,
    tags: tokens(title).slice(0, 4),
    prior: [],
  };
  noteNerve(who, "hub", title, now);
  return { ...a, updatedAt: now, nodes: [node, ...a.nodes] };
}

export function gradeAtlas(a: DeskAtlas, id: string, right: boolean, now = Date.now()): DeskAtlas {
  const cur = nodeById(a, id);
  if (!cur) return a;
  const next = { ...cur, at: now, n: cur.n + 1, confidence: clamp(cur.confidence + (right ? 6 : -8), 8, 99) };
  noteNerve(cur.who, "hub", cur.title, now);
  return { ...a, updatedAt: now, nodes: a.nodes.map((n) => (n.id === id ? next : n)) };
}

function sessionLine(etMin: number): string {
  if (etMin < 9 * 60 + 30) return "Premarket. Read the range. Do not invent a ticket.";
  if (etMin >= 11 * 60 && etMin < 13 * 60) return "Lunch. Size is down. The search stays on until 16:00.";
  if (etMin >= 16 * 60) return "Cash session is done for new risk. Manage what is open.";
  return "The chart leads. Size follows the band.";
}

/** What the floor learned this cycle. Same card does not write again. */
export function absorbAtlas(prev: DeskAtlas | null | undefined, pulse: AtlasPulse): DeskAtlas {
  let a = mergeAtlas(prev, loadAtlas(), pulse.nowMs);
  const hour = Math.floor(pulse.etMin / 60);
  if (pulse.cardKey && pulse.cardKey !== a.last.cardKey && pulse.cardLine) {
    a = rewrite(a, "now:card", pulse.cardLine, "Nova", pulse.nowMs, 2);
  }
  if (hour !== a.last.hour) a = rewrite(a, "now:session", sessionLine(pulse.etMin), "Gemma", pulse.nowMs, 0);
  if (pulse.newsOn !== a.last.news) {
    a = rewrite(
      a,
      "now:news",
      pulse.newsOn
        ? "News is on. Size down. A B+ or better on the chart is still live."
        : "News is not a block. Size and confidence follow the chart.",
      "Gemma",
      pulse.nowMs,
      0,
    );
  }
  if (pulse.exitId && pulse.exitId !== a.last.exitId && pulse.exitLine) {
    a = improveAtlas(a, { shelf: "backtest", title: `Close ${pulse.exitId}`, text: pulse.exitLine, who: "Sterling", nowMs: pulse.nowMs });
  }
  const last = { cardKey: pulse.cardKey ?? a.last.cardKey, hour, exitId: pulse.exitId ?? a.last.exitId, news: pulse.newsOn };
  if (a.last.cardKey === last.cardKey && a.last.hour === last.hour && a.last.exitId === last.exitId && a.last.news === last.news && a.updatedAt === (prev?.updatedAt ?? a.updatedAt)) {
    return prev && prev.nodes.length ? prev : a;
  }
  const next = { ...a, last };
  if (next.updatedAt !== (prev?.updatedAt ?? -1) || next.last !== prev?.last) saveAtlas(next);
  return next;
}

/** The four reads on the brain desk. Scores are the node's own confidence, never a decoration. */
const LOGIC_ROWS: { id: string; bars: string[] }[] = [
  { id: "smc:sequence", bars: ["smc:ltf", "smc:amd", "smc:po3"] },
  { id: "smc:displacement", bars: ["smc:retest", "smc:ce"] },
  { id: "smc:leader", bars: ["smc:smt", "smc:ltf"] },
  { id: "smc:draw", bars: ["smc:dol", "smc:sweep"] },
];

export interface LogicBar {
  id: string;
  label: string;
  confidence: number;
}

export interface LogicRow {
  id: string;
  title: string;
  text: string;
  confidence: number;
  bars: LogicBar[];
}

export function collectiveLogic(a: DeskAtlas): LogicRow[] {
  return LOGIC_ROWS.map((row) => {
    const n = nodeById(a, row.id);
    const bars = row.bars
      .map((id) => {
        const b = nodeById(a, id);
        return b ? { id, label: b.title, confidence: b.confidence } : null;
      })
      .filter((b): b is LogicBar => !!b);
    return { id: row.id, title: n?.title ?? row.id, text: n?.text ?? "", confidence: n?.confidence ?? 0, bars };
  });
}

export const ATLAS_SHELVES: { id: AtlasShelf; label: string; owner: string; job: string }[] = [
  { id: "now", label: "Now", owner: "Gemma", job: "Current truth. One line per topic. Replaced, never stacked." },
  { id: "discretion", label: "Discretion", owner: "Sterling", job: "Rules of taste. Rewritten in place. The old line stays on the node." },
  { id: "smc", label: "SMC", owner: "Nova", job: "Settled terms. Recalled, not re-taught." },
  { id: "market", label: "Market", owner: "Jax", job: "How this session behaves. Clock, raid, bias." },
  { id: "backtest", label: "Backtest", owner: "Vince", job: "What the tape already paid or cost. New closes land here." },
];

/** The five personal brains. Each one connects to the desk brain. None of them keeps a private copy of it. */
export const BRAIN_CREW = ["Gemma", "Jax", "Nova", "Sterling", "Vince"] as const;
export type BrainWho = (typeof BRAIN_CREW)[number];

export interface PersonNote {
  at: number;
  text: string;
  /** Desk node this note came from. */
  about: string;
}

export interface PersonBrain {
  who: BrainWho;
  /** Desk node id → the `at` this person has already taken in. */
  known: Record<string, number>;
  notes: PersonNote[];
}

export interface PeopleBrains {
  version: 1;
  people: Record<BrainWho, PersonBrain>;
  /** One line waiting to be said. Cleared once the floor has had it. */
  pending: { who: BrainWho; text: string; at: number } | null;
  /** Best probability and expectancy already written onto the desk. A new line has to beat these. */
  best: { pT1: number | null; expR: number | null };
}

export const PEOPLE_KEY = "ledger-people-brains-v1";

function blankPerson(who: BrainWho): PersonBrain {
  return { who, known: {}, notes: [] };
}

export function freshPeople(): PeopleBrains {
  return {
    version: 1,
    people: {
      Gemma: blankPerson("Gemma"),
      Jax: blankPerson("Jax"),
      Nova: blankPerson("Nova"),
      Sterling: blankPerson("Sterling"),
      Vince: blankPerson("Vince"),
    },
    pending: null,
    best: { pT1: null, expR: null },
  };
}

function asWho(name: string): BrainWho {
  return (BRAIN_CREW as readonly string[]).includes(name) ? (name as BrainWho) : "Nova";
}

function loadPeople(): PeopleBrains | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(PEOPLE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PeopleBrains;
    return p?.version === 1 && p.people ? p : null;
  } catch {
    return null;
  }
}

function savePeople(p: PeopleBrains): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PEOPLE_KEY, JSON.stringify(p));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(ATLAS_EVENT));
  } catch {
    /* full disk does not stop the floor */
  }
}

/**
 * Connect the five to the desk.
 * The first time, they already know the settled book — opening the floor is not a roll call.
 * After that, only a desk node that actually changed is taken in, by its owner, once.
 */
export function syncPeople(prev: PeopleBrains | null | undefined, desk: DeskAtlas, now: number): PeopleBrains {
  const base = prev?.version === 1 && prev.people ? prev : loadPeople() ?? freshPeople();
  const people = { ...base.people };
  for (const who of BRAIN_CREW) {
    if (!people[who]) people[who] = blankPerson(who);
  }
  const first = BRAIN_CREW.every((who) => Object.keys(people[who].known).length === 0);
  if (first) {
    for (const who of BRAIN_CREW) {
      const known = { ...people[who].known };
      for (const n of desk.nodes) known[n.id] = n.at;
      people[who] = { ...people[who], known };
    }
    const next = { version: 1 as const, people, pending: null, best: base.best ?? { pT1: null, expR: null } };
    savePeople(next);
    return next;
  }
  let pending = base.pending;
  if (pending && now - pending.at > 90_000) pending = null;
  const unseen = nowLines(desk).filter((n) => BRAIN_CREW.some((who) => (people[who].known[n.id] ?? 0) < n.at));
  const one = unseen.sort((a, b) => b.at - a.at)[0];
  if (one && !pending) {
    const who = asWho(one.who);
    const text =
      who === "Jax"
        ? `Desk moved. I want it, at the array. ${one.text}`
        : who === "Sterling"
          ? `Desk moved. Size only. ${one.text}`
          : who === "Vince"
            ? `Desk moved. Robinhood stays armed for the touch. ${one.text}`
            : one.text;
    const notes = [{ at: now, text, about: one.id }, ...people[who].notes].slice(0, 12);
    people[who] = { ...people[who], notes };
    for (const w of BRAIN_CREW) {
      people[w] = { ...people[w], known: { ...people[w].known, [one.id]: one.at } };
    }
    pending = { who, text, at: now };
    noteNerve("hub", who, one.title, now);
    for (const other of BRAIN_CREW) if (other !== who) noteNerve(who, other, one.title, now);
  }
  const next = { version: 1 as const, people, pending, best: base.best ?? { pT1: null, expR: null } };
  if (next.pending !== base.pending || one) savePeople(next);
  return next;
}

export function peopleKnown(p: PeopleBrains | null | undefined): number {
  if (!p) return 0;
  const ids = new Set<string>();
  for (const who of BRAIN_CREW) for (const id of Object.keys(p.people[who]?.known ?? {})) ids.add(id);
  return ids.size;
}

export interface BrainOffer {
  who: BrainWho;
  text: string;
  about: string;
  shelf: AtlasShelf;
  nowMs: number;
  /** Realized result. Positive paid the book. Negative stays personal. */
  pnl: number | null;
  pT1: number | null;
  expR: number | null;
}

/**
 * A person may always write their own brain.
 * The desk brain takes the line only when it raises probability, expectancy, or realized P&L.
 * A loss is remembered by the person and lowers confidence. It does not become a rule.
 */
export function offerToBrains(
  people: PeopleBrains | null | undefined,
  desk: DeskAtlas | null | undefined,
  offer: BrainOffer,
): { people: PeopleBrains; desk: DeskAtlas } {
  const p = people?.version === 1 && people.people ? { ...people, best: people.best ?? { pT1: null, expR: null } } : freshPeople();
  const d = desk && desk.version === 1 ? desk : mergeAtlas(null, null, offer.nowMs);
  const who = offer.who;
  const person = p.people[who] ?? blankPerson(who);
  const best = { ...p.best };
  const paid = offer.pnl != null && offer.pnl > 0;
  const oddsUp =
    (offer.pT1 != null && (best.pT1 == null || offer.pT1 > best.pT1 + 0.02)) ||
    (offer.expR != null && (best.expR == null || offer.expR > best.expR + 0.05));
  const recent = person.notes[0];
  if (recent && recent.about === offer.about && offer.nowMs - recent.at < 10 * 60_000 && !paid && !oddsUp) {
    return { people: p, desk: d };
  }
  const notes = [{ at: offer.nowMs, text: offer.text, about: offer.about }, ...person.notes].slice(0, 12);
  let nextDesk = d;
  let pending = p.pending;
  if (paid || oddsUp) {
    nextDesk = improveAtlas(d, {
      shelf: paid ? "backtest" : offer.shelf === "now" ? "discretion" : offer.shelf,
      title: offer.about,
      text: offer.text,
      who,
      nowMs: offer.nowMs,
    });
    if (offer.pT1 != null && (best.pT1 == null || offer.pT1 > best.pT1)) best.pT1 = offer.pT1;
    if (offer.expR != null && (best.expR == null || offer.expR > best.expR)) best.expR = offer.expR;
    pending = { who, text: offer.text, at: offer.nowMs };
  } else if (offer.pnl != null && offer.pnl < 0) {
    const id = `backtest:${offer.about.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    if (nodeById(d, id)) nextDesk = gradeAtlas(d, id, false, offer.nowMs);
  }
  const nextPeople: PeopleBrains = {
    version: 1,
    best,
    pending,
    people: { ...p.people, [who]: { ...person, notes } },
  };
  savePeople(nextPeople);
  return { people: nextPeople, desk: nextDesk };
}
