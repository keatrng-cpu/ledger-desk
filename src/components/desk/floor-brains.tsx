import { useEffect, useMemo, useState } from "react";
import {
  ATLAS_EVENT,
  ATLAS_SHELVES,
  BRAIN_CREW,
  collectiveLogic,
  mergeAtlas,
  loadAtlas,
  peopleKnown,
  shelfOf,
  type AtlasShelf,
  type BrainWho,
  type LogicRow,
  type PeopleBrains,
  PEOPLE_KEY,
} from "@/lib/room/desk-atlas";
import { NERVE_EVENT, recentNerves, type Nerve, type NerveEnd } from "@/lib/room/brain-traffic";
import { crewOf, learnCrewYears } from "@/lib/room/crew-years";
import book from "@/data/perfect-entry-book.json";

const CREW: Record<BrainWho, { school: string; color: string; ink: string; lobe: string; seat: string }> = {
  Gemma: { school: "ICT", color: "#67e8f9", ink: "#042f2e", lobe: "Structure Lobe", seat: "The draw" },
  Jax: { school: "TJR", color: "#7dd3fc", ink: "#082f49", lobe: "Execution Lobe", seat: "The raid" },
  Nova: { school: "Blake", color: "#c4b5fd", ink: "#2e1065", lobe: "Memory", seat: "The number" },
  Sterling: { school: "Patty", color: "#a5b4fc", ink: "#1e1b4b", lobe: "Risk Lobe", seat: "The size" },
  Vince: { school: "SMC", color: "#5eead4", ink: "#042f2e", lobe: "Orderflow Lobe", seat: "The order" },
};

const SHELF_TINT: Record<AtlasShelf, string> = {
  now: "#2dd4bf",
  discretion: "#fca5a5",
  smc: "#7dd3fc",
  market: "#fb923c",
  backtest: "#bef264",
};

/** Diagram space. Four lobes, Nova above the hub, the book in the middle. */
const HUB = { x: 470, y: 318 };
const SEAT_AT: Record<BrainWho, { x: number; y: number }> = {
  Gemma: { x: 148, y: 168 },
  Jax: { x: 792, y: 168 },
  Nova: { x: 470, y: 92 },
  Vince: { x: 148, y: 478 },
  Sterling: { x: 792, y: 478 },
};

const RINGS: [BrainWho, BrainWho][] = [
  ["Gemma", "Jax"],
  ["Jax", "Sterling"],
  ["Sterling", "Vince"],
  ["Vince", "Gemma"],
  ["Gemma", "Sterling"],
  ["Jax", "Vince"],
  ["Nova", "Gemma"],
  ["Nova", "Jax"],
];

function readPeople(): PeopleBrains | null {
  try {
    const raw = localStorage.getItem(PEOPLE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PeopleBrains;
    return p?.version === 1 ? p : null;
  } catch {
    return null;
  }
}

function curve(x1: number, y1: number, x2: number, y2: number, bend: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const mx = (x1 + x2) / 2 - dy * bend;
  const my = (y1 + y2) / 2 + dx * bend;
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

function liveBetween(nerves: Nerve[], a: NerveEnd, b: NerveEnd): Nerve | null {
  for (let i = nerves.length - 1; i >= 0; i--) {
    const n = nerves[i]!;
    if ((n.from === a && n.to === b) || (n.from === b && n.to === a)) return n;
  }
  return null;
}

/** The desk core and the five minds that read it. Nerves move only on a real send. */
export function FloorBrains() {
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [who, setWho] = useState<BrainWho | null>(null);
  const [shelf, setShelf] = useState<AtlasShelf>("smc");
  useEffect(() => {
    const sync = () => setTick((n) => n + 1);
    const pulse = () => setNow(Date.now());
    window.addEventListener(ATLAS_EVENT, sync);
    window.addEventListener(NERVE_EVENT, pulse);
    window.addEventListener("focus", sync);
    learnCrewYears();
    const id = window.setInterval(pulse, 1000);
    return () => {
      window.removeEventListener(ATLAS_EVENT, sync);
      window.removeEventListener(NERVE_EVENT, pulse);
      window.removeEventListener("focus", sync);
      window.clearInterval(id);
    };
  }, []);
  void tick;
  const desk = useMemo(() => mergeAtlas(loadAtlas(), null), [tick]);
  const people = readPeople();
  const nodes = shelfOf(desk, shelf);
  const shelfMeta = ATLAS_SHELVES.find((s) => s.id === shelf)!;
  const focus = who ? people?.people[who] : null;
  const known = who ? Object.keys(focus?.known ?? {}).length : peopleKnown(people);
  const logic = useMemo(() => collectiveLogic(desk), [desk]);
  const live = recentNerves(now);
  const latest = live[live.length - 1] ?? null;

  return (
    <section className="overflow-hidden rounded-[var(--radius-sm)] border border-cyan-400/20 bg-[#03060d]">
      <style>{`
        @keyframes nerve {
          to { stroke-dashoffset: -36; }
        }
        .nerve { stroke-dasharray: 3 7; animation: nerve 1.15s linear infinite; }
        @keyframes corepulse {
          50% { opacity: 0.45; }
        }
        .corepulse { animation: corepulse 3.2s ease-in-out infinite; }
      `}</style>
      <div className="border-b border-white/10 px-4 py-3 text-center">
        <h3 className="text-[18px] font-semibold tracking-[0.18em] text-white sm:text-[22px]">MODULAR BRAIN ECOSYSTEM</h3>
        <p className="mt-1 text-[11px] tracking-wide text-cyan-200/70">Agents fuel each other · Learn from the whole · SMC and ICT, one book</p>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.55fr)_minmax(260px,0.72fr)]">
        <svg viewBox="0 0 940 600" className="h-auto w-full" role="img" aria-label="Modular brain. Paths light only when a seat sends.">
          <defs>
            <radialGradient id="well" cx="50%" cy="48%" r="62%">
              <stop offset="0%" stopColor="#0c1830" />
              <stop offset="55%" stopColor="#050814" />
              <stop offset="100%" stopColor="#03060d" />
            </radialGradient>
            <radialGradient id="hubglow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.85" />
              <stop offset="45%" stopColor="#6366f1" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
            </radialGradient>
            <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect width="940" height="600" fill="url(#well)" />
          {Array.from({ length: 18 }, (_, i) => (
            <circle key={i} cx={40 + ((i * 97) % 880)} cy={30 + ((i * 53) % 540)} r={i % 4 === 0 ? 1.4 : 0.7} fill="#67e8f9" opacity={0.25} />
          ))}

          {BRAIN_CREW.map((name) => (
            <Bundle key={`hub-${name}`} a="hub" b={name} live={liveBetween(live, "hub", name)} />
          ))}
          {RINGS.map(([a, b]) => (
            <Bundle key={`${a}-${b}`} a={a} b={b} live={liveBetween(live, a, b)} />
          ))}

          <circle cx={HUB.x} cy={HUB.y} r="78" fill="url(#hubglow)" className="corepulse" />
          {[46, 58, 70].map((r) => (
            <circle key={r} cx={HUB.x} cy={HUB.y} r={r} fill="none" stroke="#67e8f9" strokeOpacity={r === 58 ? 0.7 : 0.28} />
          ))}
          <circle cx={HUB.x} cy={HUB.y} r="40" fill="#070b16" stroke="#e0fbff" strokeOpacity="0.85" />
          <text x={HUB.x} y={HUB.y - 4} textAnchor="middle" fill="white" fontSize="11" fontWeight="700" letterSpacing="1.4">
            LOGIC
          </text>
          <text x={HUB.x} y={HUB.y + 12} textAnchor="middle" fill="#a5f3fc" fontSize="9" letterSpacing="1.6">
            & MEMORY HUB
          </text>

          <Memory nova={SEAT_AT.Nova} on={who === "Nova"} known={Object.keys(people?.people.Nova?.known ?? {}).length} total={desk.nodes.length} onClick={() => setWho(who === "Nova" ? null : "Nova")} />

          {(["Gemma", "Jax", "Vince", "Sterling"] as const).map((name) => (
            <Lobe
              key={name}
              name={name}
              on={who === name}
              known={Object.keys(people?.people[name]?.known ?? {}).length}
              total={desk.nodes.length}
              hot={live.some((n) => n.from === name || n.to === name)}
              onClick={() => setWho(who === name ? null : name)}
            />
          ))}

          {latest && (
            <text x="470" y="586" textAnchor="middle" fill="#a5f3fc" fontSize="11">
              {latest.from} → {latest.to} · {latest.about.slice(0, 72)}
            </text>
          )}
        </svg>

        <aside className="border-t border-cyan-400/15 bg-[#07101c]/80 p-4 lg:border-l lg:border-t-0">
          <p className="text-[11px] font-semibold tracking-[0.22em] text-cyan-200">COLLECTIVE LOGIC</p>
          <ul className="mt-3 space-y-4">
            {logic.map((row) => (
              <LogicBlock key={row.id} row={row} />
            ))}
          </ul>
          <div className="mt-4 border-t border-white/10 pt-3">
            {who ? (
              <PersonCard
                name={who}
                known={known}
                total={desk.nodes.length}
                note={focus?.notes[0]?.text ?? crewOf(who)?.skill ?? null}
                older={(focus?.notes.length ? focus.notes.slice(1, 4).map((n) => n.text) : crewOf(who)?.flaws) ?? []}
                year={crewOf(who)}
              />
            ) : (
              <ShelfCard
                label={shelfMeta.label}
                owner={shelfMeta.owner}
                job={shelfMeta.job}
                tint={SHELF_TINT[shelf]}
                nodes={nodes.slice(0, 4).map((n) => ({ title: n.title, text: n.text, confidence: n.confidence, who: n.who }))}
              />
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ATLAS_SHELVES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setShelf(s.id);
                  setWho(null);
                }}
                className="rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider"
                style={{
                  borderColor: shelf === s.id ? SHELF_TINT[s.id] : "rgba(255,255,255,0.12)",
                  color: shelf === s.id ? SHELF_TINT[s.id] : "rgba(255,255,255,0.55)",
                  background: shelf === s.id ? "rgba(255,255,255,0.04)" : "transparent",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <Wire live={live} />
        </aside>
      </div>

      <div className="grid gap-2 border-t border-white/10 p-3 sm:grid-cols-5">
        {(book.ladder as { who: string; check: string; wins: number; n: number; wr: number | null }[])
          .filter((row) => row.who !== "All")
          .map((row) => {
            const c = CREW[row.who as BrainWho];
            const wr = row.wr == null ? "—" : `${Math.round(row.wr * 100)}%`;
            return (
              <button key={row.who} type="button" onClick={() => setWho(row.who as BrainWho)} className="rounded-md border border-white/10 px-2 py-2 text-left">
                <p className="text-[10px] uppercase tracking-wider" style={{ color: c.color }}>
                  {row.who} · 2022–26
                </p>
                <p className="mt-1 font-mono text-[13px] text-white">
                  {row.wins}/{row.n} · {wr}
                </p>
                <p className="mt-1 text-[10px] leading-snug text-white/45">{row.check}</p>
              </button>
            );
          })}
      </div>
      <p className="border-t border-white/10 px-4 py-2 text-[11px] leading-relaxed text-white/45">
        A path stays dim until something real moves on it. A seat writing the book lights the spoke into the hub. The book handing that line back lights it out. Speech on the floor lights the seat that said it to the seat that heard it. Power of 3, premium and discount, the draw, the break, the breaker, SMT, the kill zone, and the retest sit in the book beside the four schools.
      </p>
    </section>
  );
}

function Bundle({ a, b, live }: { a: NerveEnd; b: NerveEnd; live: Nerve | null }) {
  const A = a === "hub" ? HUB : SEAT_AT[a];
  const B = b === "hub" ? HUB : SEAT_AT[b];
  const color = live ? (live.from === "hub" ? "#c4b5fd" : live.to === "hub" ? "#67e8f9" : CREW[live.from as BrainWho]?.color ?? "#67e8f9") : "#67e8f9";
  const forward = live?.from === b;
  const bends = a === "hub" || b === "hub" ? [-0.05, 0.02, 0.08] : [-0.12, 0, 0.12];
  return (
    <g filter={live ? "url(#glow)" : undefined}>
      {bends.map((bend, i) => {
        const d = forward ? curve(B.x, B.y, A.x, A.y, -bend) : curve(A.x, A.y, B.x, B.y, bend);
        return (
          <path
            key={bend}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={live && i === 1 ? 1.7 : 0.7}
            strokeOpacity={live ? (i === 1 ? 0.95 : 0.35) : 0.16}
            className={live && i === 1 ? "nerve" : undefined}
          />
        );
      })}
      {live && (
        <circle r="3.2" fill="#f8fdff">
          <animateMotion dur="1.7s" repeatCount="indefinite" path={forward ? curve(B.x, B.y, A.x, A.y, 0) : curve(A.x, A.y, B.x, B.y, 0.02)} />
        </circle>
      )}
    </g>
  );
}

function Lobe({
  name,
  on,
  known,
  total,
  hot,
  onClick,
}: {
  name: BrainWho;
  on: boolean;
  known: number;
  total: number;
  hot: boolean;
  onClick: () => void;
}) {
  const c = CREW[name];
  const p = SEAT_AT[name];
  const frac = total ? known / total : 0;
  return (
    <g className="cursor-pointer" onClick={onClick}>
      <ellipse cx={p.x - 16} cy={p.y - 8} rx="62" ry="46" fill="#0b1224" stroke={c.color} strokeOpacity={on || hot ? 0.95 : 0.45} strokeWidth={on ? 2 : 1} />
      <ellipse cx={p.x + 22} cy={p.y - 6} rx="48" ry="40" fill="#0b1224" stroke={c.color} strokeOpacity={on || hot ? 0.8 : 0.35} />
      <path d={`M ${p.x - 46} ${p.y - 8} q 18 -22 40 -8 q 16 10 28 -6`} fill="none" stroke={c.color} strokeOpacity="0.45" />
      <path d={`M ${p.x - 40} ${p.y + 8} q 22 16 48 4`} fill="none" stroke={c.color} strokeOpacity="0.35" />
      <rect x={p.x - 18} y={p.y + 6} width="36" height="22" rx="3" fill="#061018" stroke={c.color} strokeOpacity="0.8" />
      <polyline points={`${p.x - 12},${p.y + 20} ${p.x - 4},${p.y + 12} ${p.x + 2},${p.y + 16} ${p.x + 12},${p.y + 10}`} fill="none" stroke={c.color} strokeWidth="1.3" />
      <circle cx={p.x - 28} cy={p.y + 10} r="7" fill={c.color} opacity="0.9" />
      <text x={p.x} y={p.y - 62} textAnchor="middle" fill="white" fillOpacity="0.55" fontSize="10" letterSpacing="1.2">
        {c.lobe.toUpperCase()}
      </text>
      <text x={p.x} y={p.y + 48} textAnchor="middle" fill={c.color} fontSize="13" fontWeight="700">
        {name} + {c.school}
      </text>
      <text x={p.x} y={p.y + 64} textAnchor="middle" fill="white" fillOpacity="0.55" fontSize="10">
        {total ? `${Math.round(frac * 100)}% of the book` : "—"}
      </text>
    </g>
  );
}

function Memory({
  nova,
  on,
  known,
  total,
  onClick,
}: {
  nova: { x: number; y: number };
  on: boolean;
  known: number;
  total: number;
  onClick: () => void;
}) {
  const c = CREW.Nova;
  return (
    <g className="cursor-pointer" onClick={onClick}>
      <circle cx={nova.x} cy={nova.y - 18} r="28" fill="#120c22" stroke={c.color} strokeOpacity={on ? 1 : 0.7} />
      <circle cx={nova.x - 8} cy={nova.y - 22} r="16" fill="none" stroke={c.color} strokeOpacity="0.55" />
      <circle cx={nova.x + 10} cy={nova.y - 20} r="14" fill="none" stroke="#67e8f9" strokeOpacity="0.45" />
      <circle cx={nova.x} cy={nova.y - 18} r="3" fill="#e9d5ff" />
      <text x={nova.x} y={nova.y + 22} textAnchor="middle" fill={c.color} fontSize="13" fontWeight="700">
        Nova
      </text>
      <text x={nova.x} y={nova.y + 36} textAnchor="middle" fill="white" fillOpacity="0.6" fontSize="10">
        Memory Architect · {total ? `${known}/${total}` : "—"}
      </text>
    </g>
  );
}

function LogicBlock({ row }: { row: LogicRow }) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium text-white">{row.title}</p>
        <p className="font-mono text-[12px] text-cyan-200">{row.confidence}</p>
      </div>
      <Bar pct={row.confidence} />
      <p className="mt-1 text-[11px] leading-snug text-white/55">{row.text}</p>
      <ul className="mt-1.5 space-y-1">
        {row.bars.map((b) => (
          <li key={b.id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] text-white/45">{b.label}</span>
              <span className="font-mono text-[10px] text-cyan-200/80">{b.confidence}</span>
            </div>
            <Bar pct={b.confidence} thin />
          </li>
        ))}
      </ul>
    </li>
  );
}

function Bar({ pct, thin }: { pct: number; thin?: boolean }) {
  return (
    <div className={`overflow-hidden rounded-full bg-white/10 ${thin ? "mt-0.5 h-[3px]" : "mt-1 h-1"}`}>
      <div className="h-full rounded-full bg-cyan-300" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

function Wire({ live }: { live: Nerve[] }) {
  const rows = [...live].reverse().slice(0, 5);
  return (
    <div className="mt-3 border-t border-white/10 pt-2">
      <p className="text-[9px] uppercase tracking-[0.16em] text-white/40">Live wires</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-[11px] leading-snug text-white/45">Quiet. Nothing has been written, handed back, or said in the last few seconds.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {rows.map((n, i) => (
            <li key={`${n.at}-${i}`} className="text-[11px] leading-snug text-cyan-100/80">
              <span className="text-white">{n.from}</span>
              <span className="text-white/40"> → </span>
              <span className="text-white">{n.to}</span>
              <span className="text-white/50"> · {n.about}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PersonCard({
  name,
  known,
  total,
  note,
  older,
  year,
}: {
  name: BrainWho;
  known: number;
  total: number;
  note: string | null;
  older: string[];
  year: ReturnType<typeof crewOf>;
}) {
  const c = CREW[name];
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: c.color }}>
        {c.school} · {c.seat}
      </p>
      <h4 className="mt-1 text-[18px] text-white">{name}</h4>
      <p className="mt-1 text-[12px] text-white/50">
        Knows {known} of {total} desk nodes.
        {year
          ? ` Cards at 0.85 and above, the book that holds a 0.90, Sep 2022–Sep 2026: ${year.full.wins}/${year.full.n} to the first target (${year.full.wr == null ? "—" : `${Math.round(year.full.wr * 100)}%`}), E[R] ${year.full.expR ?? "—"}. After 2024: E[R] ${year.h2.expR ?? "—"} on ${year.h2.n} fills.`
          : ""}
      </p>
      <p className="mt-3 border-l-2 pl-3 text-[13px] leading-relaxed text-white" style={{ borderColor: c.color }}>
        {note ?? "Nothing of their own yet. They already know the desk, so they are not introducing themselves."}
      </p>
      {older.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {older.map((t) => (
            <li key={t} className="text-[11px] leading-snug text-white/45">
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ShelfCard({
  label,
  owner,
  job,
  tint,
  nodes,
}: {
  label: string;
  owner: string;
  job: string;
  tint: string;
  nodes: { title: string; text: string; confidence: number; who: string }[];
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: tint }}>
        Desk shelf · kept by {owner}
      </p>
      <h4 className="mt-1 text-[18px] text-white">{label}</h4>
      <p className="mt-1 text-[12px] text-white/50">{job}</p>
      <ul className="mt-3 space-y-2">
        {nodes.map((n) => (
          <li key={n.title}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[12px] text-white">{n.title}</span>
              <span className="font-mono text-[10px] text-white/40">{n.confidence}</span>
            </div>
            <p className="text-[11px] leading-snug text-white/55">{n.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
