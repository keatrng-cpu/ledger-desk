import { useEffect, useMemo, useState } from "react";
import {
  ATLAS_EVENT,
  ATLAS_SHELVES,
  BRAIN_CREW,
  mergeAtlas,
  loadAtlas,
  peopleKnown,
  shelfOf,
  type AtlasShelf,
  type BrainWho,
  type PeopleBrains,
  PEOPLE_KEY,
} from "@/lib/room/desk-atlas";
import { CREW_STUDY, crewOf, learnCrewYears } from "@/lib/room/crew-years";
import book from "@/data/perfect-entry-book.json";

const CREW: Record<
  BrainWho,
  { school: string; color: string; ink: string; mark: string; seat: string }
> = {
  Gemma: { school: "ICT", color: "#7dd3fc", ink: "#082f49", mark: "G", seat: "The draw" },
  Jax: { school: "TJR", color: "#fb923c", ink: "#431407", mark: "J", seat: "The raid" },
  Nova: { school: "Blake", color: "#2dd4bf", ink: "#042f2e", mark: "N", seat: "The number" },
  Sterling: { school: "Patty", color: "#fca5a5", ink: "#450a0a", mark: "S", seat: "The size" },
  Vince: { school: "SMC", color: "#bef264", ink: "#1a2e05", mark: "V", seat: "The order" },
};

const SHELF_TINT: Record<AtlasShelf, string> = {
  now: "#2dd4bf",
  discretion: "#fca5a5",
  smc: "#7dd3fc",
  market: "#fb923c",
  backtest: "#bef264",
};

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

function polar(i: number, n: number, rx: number, ry: number) {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return { x: 500 + Math.cos(a) * rx, y: 268 + Math.sin(a) * ry };
}

/** The desk core and the five minds that read it. */
export function FloorBrains() {
  const [tick, setTick] = useState(0);
  const [who, setWho] = useState<BrainWho | null>(null);
  const [shelf, setShelf] = useState<AtlasShelf>("smc");
  useEffect(() => {
    const sync = () => setTick((n) => n + 1);
    window.addEventListener(ATLAS_EVENT, sync);
    window.addEventListener("focus", sync);
    learnCrewYears();
    return () => {
      window.removeEventListener(ATLAS_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, []);
  void tick;
  const desk = useMemo(() => mergeAtlas(loadAtlas(), null), [tick]);
  const people = readPeople();
  const nodes = shelfOf(desk, shelf);
  const shelfMeta = ATLAS_SHELVES.find((s) => s.id === shelf)!;
  const focus = who ? people?.people[who] : null;
  const known = who ? Object.keys(focus?.known ?? {}).length : peopleKnown(people);

  return (
    <section className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[#07080b]">
      <style>{`
        @keyframes nerve {
          to { stroke-dashoffset: -28; }
        }
        .nerve { stroke-dasharray: 4 8; animation: nerve 2.8s linear infinite; }
        @keyframes corepulse {
          50% { opacity: 0.55; }
        }
        .corepulse { animation: corepulse 3.6s ease-in-out infinite; }
      `}</style>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-white/45">One desk · five minds</p>
          <h3 className="mt-1 text-[18px] font-medium tracking-tight text-white">The floor brain</h3>
        </div>
        <div className="flex gap-2 text-[11px]">
          <Readout k="Known" v={String(peopleKnown(people))} />
          <Readout k="Best P(T1)" v={people?.best?.pT1 != null ? `${Math.round(people.best.pT1 * 100)}%` : "—"} />
          <Readout k="Best E[R]" v={people?.best?.expR != null ? people.best.expR.toFixed(2) : "—"} />
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <svg viewBox="0 0 1000 540" className="h-auto w-full" role="img" aria-label="Desk brain connected to five people">
          <defs>
            <radialGradient id="well" cx="50%" cy="46%" r="55%">
              <stop offset="0%" stopColor="#14181f" />
              <stop offset="70%" stopColor="#07080b" />
              <stop offset="100%" stopColor="#07080b" />
            </radialGradient>
            <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect width="1000" height="540" fill="url(#well)" />
          {Array.from({ length: 7 }, (_, i) => (
            <ellipse key={i} cx="500" cy="268" rx={70 + i * 38} ry={48 + i * 26} fill="none" stroke="white" strokeOpacity={0.04} />
          ))}

          {BRAIN_CREW.map((name, i) => {
            const p = polar(i, 5, 310, 188);
            const live = (people?.people[name]?.notes.length ?? 0) > 0;
            return (
              <line
                key={name}
                x1="500"
                y1="268"
                x2={p.x}
                y2={p.y}
                stroke={CREW[name].color}
                strokeOpacity={who === name || !who ? 0.85 : 0.25}
                strokeWidth={who === name ? 2.4 : 1.2}
                className={live ? "nerve" : undefined}
              />
            );
          })}

          {ATLAS_SHELVES.map((s, i) => {
            const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / 5 - 0.42;
            const a1 = a0 + 0.78;
            const r = 78;
            const large = 0;
            const x0 = 500 + Math.cos(a0) * r;
            const y0 = 268 + Math.sin(a0) * r;
            const x1 = 500 + Math.cos(a1) * r;
            const y1 = 268 + Math.sin(a1) * r;
            const on = shelf === s.id;
            return (
              <path
                key={s.id}
                d={`M 500 268 L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`}
                fill={SHELF_TINT[s.id]}
                fillOpacity={on ? 0.9 : 0.28}
                stroke="#07080b"
                strokeWidth="2"
                className="cursor-pointer"
                onClick={() => {
                  setShelf(s.id);
                  setWho(null);
                }}
              >
                <title>{s.label}</title>
              </path>
            );
          })}
          <circle cx="500" cy="268" r="46" fill="#0c0e13" stroke="white" strokeOpacity="0.2" />
          <circle cx="500" cy="268" r="34" fill="none" stroke="#2dd4bf" strokeOpacity="0.7" className="corepulse" />
          <text x="500" y="264" textAnchor="middle" fill="white" fontSize="11" letterSpacing="2">
            DESK
          </text>
          <text x="500" y="280" textAnchor="middle" fill="white" fillOpacity="0.55" fontSize="9">
            {shelfMeta.label.toUpperCase()}
          </text>

          {BRAIN_CREW.map((name, i) => {
            const p = polar(i, 5, 310, 188);
            const c = CREW[name];
            const brain = people?.people[name];
            const nKnown = Object.keys(brain?.known ?? {}).length;
            const frac = desk.nodes.length ? nKnown / desk.nodes.length : 0;
            const on = who === name;
            const circ = 2 * Math.PI * 34;
            return (
              <g key={name} className="cursor-pointer" onClick={() => setWho(on ? null : name)} filter={on ? "url(#soft)" : undefined}>
                <circle cx={p.x} cy={p.y} r="46" fill="#0c0e13" stroke={c.color} strokeOpacity={on ? 1 : 0.45} strokeWidth={on ? 2.5 : 1.2} />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="34"
                  fill="none"
                  stroke={c.color}
                  strokeWidth="3"
                  strokeDasharray={`${Math.max(6, frac * circ)} ${circ}`}
                  strokeLinecap="round"
                  transform={`rotate(-90 ${p.x} ${p.y})`}
                  opacity={0.9}
                />
                <circle cx={p.x} cy={p.y - 4} r="16" fill={c.color} />
                <text x={p.x} y={p.y} textAnchor="middle" fill={c.ink} fontSize="13" fontWeight="700">
                  {c.mark}
                </text>
                <text x={p.x} y={p.y + 28} textAnchor="middle" fill="white" fontSize="12">
                  {name}
                </text>
                <text x={p.x} y={p.y + 58} textAnchor="middle" fill={c.color} fontSize="10" letterSpacing="1.5">
                  {c.school.toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>

        <aside className="border-t border-white/10 p-4 lg:border-l lg:border-t-0">
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
              nodes={nodes.slice(0, 6).map((n) => ({ title: n.title, text: n.text, confidence: n.confidence, who: n.who }))}
            />
          )}
          <div className="mt-4 flex flex-wrap gap-1.5">
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
        </aside>
      </div>
      <div className="grid gap-2 border-t border-white/10 p-3 sm:grid-cols-5">
        {(book.ladder as { who: string; check: string; wins: number; n: number; wr: number | null }[])
          .filter((row) => row.who !== "All")
          .map((row) => {
            const c = CREW[row.who as BrainWho];
            const wr = row.wr == null ? "—" : `${Math.round(row.wr * 100)}%`;
            return (
              <button
                key={row.who}
                type="button"
                onClick={() => setWho(row.who as BrainWho)}
                className="rounded-md border px-2 py-2 text-left"
                style={{ borderColor: "rgba(255,255,255,0.1)" }}
              >
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
      <p className="border-t border-white/10 px-4 py-2 text-[11px] text-white/45">
        The brain holds ICT, TJR, Patty, Blake, and SMC, plus the measured book. On a card it says the setup, the entry, the target, and the watch. NQ and ES are read together on every rung. The 1m to 5m is only the entry. A higher-timeframe ladder against the trade is a note, not a stand-down.
      </p>
      <p className="px-4 pb-3 text-[11px] text-white/55">
        Month ticket on $2,000: 4 contracts at $150, debit $600. Stop $180. A double pays $600. No count stands a ticket down. $3,000 needs 66%. At the measured 40%, nine of these net about $1,200 if every stop fills. Size rises one contract after nine closes clear. A win does not raise it.
      </p>
    </section>
  );
}

function Readout({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
      <p className="text-[9px] uppercase tracking-wider text-white/40">{k}</p>
      <p className="font-mono text-[13px] text-white">{v}</p>
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
      <h4 className="mt-1 text-[22px] text-white">{name}</h4>
      <p className="mt-1 text-[12px] text-white/50">
        Knows {known} of {total} desk nodes.
        {year
          ? ` Cards at 0.85 and above, the book that holds a 0.90, Sep 2022–Sep 2026: ${year.full.wins}/${year.full.n} to the first target (${year.full.wr == null ? "—" : `${Math.round(year.full.wr * 100)}%`}), E[R] ${year.full.expR ?? "—"}. After 2024: E[R] ${year.h2.expR ?? "—"} on ${year.h2.n} fills. Not 65%. 2020 and 2021 are not on the tape.`
          : ""}
      </p>
      <p className="mt-4 border-l-2 pl-3 text-[13px] leading-relaxed text-white" style={{ borderColor: c.color }}>
        {note ?? "Nothing of their own yet. They already know the desk, so they are not introducing themselves."}
      </p>
      {older.length > 0 && (
        <ul className="mt-3 space-y-2">
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
      <h4 className="mt-1 text-[22px] text-white">{label}</h4>
      <p className="mt-1 text-[12px] text-white/50">{job}</p>
      <ul className="mt-4 space-y-3">
        {nodes.map((n) => (
          <li key={n.title}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[12px] text-white">{n.title}</span>
              <span className="font-mono text-[10px] text-white/40">{n.confidence}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full" style={{ width: `${n.confidence}%`, background: tint }} />
            </div>
            <p className="mt-1 text-[11px] leading-snug text-white/55">{n.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
