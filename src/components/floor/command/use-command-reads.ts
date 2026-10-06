/**
 * Live reads for Floor command cards — SAME sources each tab uses.
 * No invented numbers. Honest empty / offline / stale.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { getNewsFeed } from "@/lib/news/news-server";
import { dedupe, orderItems, tagItem, type Tagged } from "@/lib/news/feed";
import { fundProfile } from "@/lib/invest/exposure";
import { ALL_DOSSIERS } from "@/lib/invest/dossiers";
import { loadRhSleeve, rhRiskBudgetUsd, rhTicketCapUsd } from "@/lib/trading/options-sleeve";
import {
  DECIDE_END_MIN,
  DECIDE_START_MIN,
  gradeOvernight,
} from "@/lib/trading/overnight-swing";
import { etWallParts } from "@/lib/trading/sessions";
import { runVeteranBrain } from "@/lib/trading/veteran-brain";
import { getPaperAccount } from "@/lib/trading/paper-account";
import { emptyDeskMemory, loadDeskMemory } from "@/lib/trading/desk-memory";
import { getRiskState } from "@/lib/journal/server";
import type { RiskState } from "@/lib/journal/risk";
import { getPredictionMarketFeed } from "@/lib/predict/predict-server";
import type { PredictionMarket } from "@/lib/predict/prediction-market-feed";
import { MODULES } from "@/lib/learn/curriculum";
import { nextAiSyncCheckpoint, fmtAiSyncCountdown } from "@/lib/coach/ai-sync";
import { schoolRings } from "./school-rings";
import type { CardRead, CommandTabId } from "./types";
import { labGovernorFromState, labGovernorFromError } from "@/lib/ui/lab-governor-read";

const DONE_KEY = "ledger.learn.done";

function readLearnDone(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(DONE_KEY);
    if (!raw) return 0;
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

function pc(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}¢`;
}

function usd(n: number): string {
  return Number.isFinite(n) ? `$${Math.round(n).toLocaleString()}` : "—";
}

/** Top 3 headlines with impact chips — News tab's getNewsFeed + tagItem. */
function useNewsRead(): CardRead {
  const [read, setRead] = useState<CardRead>({ status: "loading", primary: "Loading headlines…" });
  useEffect(() => {
    let cancelled = false;
    void getNewsFeed()
      .then((data) => {
        if (cancelled) return;
        if (!data?.items?.length) {
          setRead({ status: "empty", primary: "No headlines in the feeds right now." });
          return;
        }
        const qqq = new Map(fundProfile("QQQ")?.holdings ?? []);
        const dossiers = new Set(ALL_DOSSIERS.filter((d) => d.kind === "company").map((d) => d.ticker));
        const w = (t: string) =>
          t === "GOOGL" ? (qqq.get("GOOGL") ?? 0) + (qqq.get("GOOG") ?? 0) : (qqq.get(t) ?? 0);
        const tagged: Tagged[] = orderItems(dedupe(data.items.map((i) => tagItem(i, w, dossiers))));
        const top = tagged.slice(0, 3);
        if (!top.length) {
          setRead({ status: "empty", primary: "No headlines match." });
          return;
        }
        const impactLabel = (t: Tagged) => (t.tier === 1 ? "High" : t.tier === 2 ? "Med" : "Low");
        const impactTone = (t: Tagged): "down" | "warn" | "muted" =>
          t.tier === 1 ? "down" : t.tier === 2 ? "warn" : "muted";
        setRead({
          status: "live",
          primary: top[0]!.title,
          lines: top.slice(1).map((t) => t.title),
          chips: top.map((t) => ({ label: impactLabel(t), tone: impactTone(t) })),
          title: `Top ${top.length} from the News feeds`,
        });
      })
      .catch(() => {
        if (!cancelled) setRead({ status: "offline", primary: "News feed offline." });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return read;
}

/** Options: decision/exit countdown + sleeve budget (options-swing / overnight / sleeve). */
function useOptionsRead(desk: DeskPayload | null): CardRead {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return useMemo(() => {
    void tick;
    if (!desk) return { status: "empty", primary: "Waiting for the desk…" };
    const sleeve = loadRhSleeve();
    const cap = rhTicketCapUsd(sleeve);
    const budget = rhRiskBudgetUsd(sleeve);
    const p = etWallParts(Date.now());
    const min = p.hour * 60 + p.minute;
    let countdown: string;
    if (p.weekday < 1 || p.weekday > 5) {
      countdown = "Weekend — manage only";
    } else if (min < DECIDE_START_MIN) {
      const left = DECIDE_START_MIN - min;
      countdown = `Decision window 15:00 ET · ${Math.floor(left / 60)}h${String(left % 60).padStart(2, "0")}m`;
    } else if (min <= DECIDE_END_MIN) {
      const left = DECIDE_END_MIN - min;
      countdown = `IN decision window · closes in ${left}m`;
    } else {
      try {
        const ov = gradeOvernight({ desk, now: Date.now(), sleeve });
        const m = ov.mechanics;
        countdown = `Next exit ${m.nextTradable} · blind ${m.unmanageableLabel}`;
      } catch {
        countdown = "Outside decision window";
      }
    }
    return {
      status: "live",
      primary: countdown,
      lines: [`Budget ${usd(budget)} loss · debit ceiling ${usd(cap)}`],
      title: "Options sleeve — display only",
    };
  }, [desk, tick]);
}

/** Charts: today's key levels + price vs nearest level. */
function useChartsRead(desk: DeskPayload | null): CardRead {
  return useMemo(() => {
    if (!desk) return { status: "empty", primary: "Waiting for the desk…" };
    const block = desk.levels[0];
    const items = block?.items?.slice(0, 5) ?? [];
    if (!items.length) {
      return { status: "empty", primary: "No key levels on the desk yet." };
    }
    const px = desk.quotes.left.price;
    let nearest = items[0]!;
    let best = Math.abs(px - nearest.price);
    for (const it of items) {
      const d = Math.abs(px - it.price);
      if (d < best) {
        best = d;
        nearest = it;
      }
    }
    const vs = px >= nearest.price ? "above" : "below";
    return {
      status: "live",
      primary: `${block!.symbol} ${px.toFixed(2)} · ${vs} ${nearest.name} ${nearest.price.toFixed(2)}`,
      lines: items.map((it) => `${it.name} ${it.price.toFixed(2)}`),
      title: "Desk key levels (same as Charts)",
    };
  }, [desk]);
}

/** Brain: school met/total rings from canon stack. */
function useBrainRead(desk: DeskPayload | null): CardRead {
  return useMemo(() => {
    if (!desk) return { status: "empty", primary: "Waiting for the desk…" };
    try {
      const brief = runVeteranBrain(desk);
      const stack = brief.canonStack;
      const rings = schoolRings(stack);
      if (!rings.total) {
        return {
          status: "empty",
          primary: stack ? `Canon ${stack.grade} · no live-checkable school steps` : "No canon stack yet.",
        };
      }
      return {
        status: "live",
        primary: `School ${rings.met}/${rings.total} rings · canon ${stack.grade}`,
        lines: rings.bySchool.slice(0, 4).map((s) => `${s.name} ${s.met}/${s.total}`),
        title: "Same school rings as the Brain playbook",
      };
    } catch {
      return { status: "offline", primary: "Brain read failed." };
    }
  }, [desk]);
}

/** Predict/Mead: top-ranked market + odds (grade when the feed has one). */
function usePredictRead(): CardRead {
  const [read, setRead] = useState<CardRead>({ status: "loading", primary: "Loading markets…" });
  useEffect(() => {
    let cancelled = false;
    void getPredictionMarketFeed({ data: {} })
      .then((res) => {
        if (cancelled) return;
        const markets = (res?.markets ?? []) as PredictionMarket[];
        if (!markets.length) {
          setRead({
            status: res?.reason ? "offline" : "empty",
            primary: res?.reason ?? "No open markets on the feed.",
          });
          return;
        }
        const top = markets[0]!;
        const odds = top.yesPrice != null ? pc(top.yesPrice) : top.winChance != null ? `${Math.round(top.winChance * 100)}%` : null;
        const stale = Boolean(res.stale || top.stale);
        setRead({
          status: stale ? "stale" : "live",
          primary: odds
            ? `${top.event} · ${top.outcome} · ${odds}`
            : `${top.event} · ${top.outcome}`,
          lines: top.setupGrade ? [`Setup ${top.setupGrade}${top.gates?.word ? ` · ${top.gates.word}` : ""}`] : undefined,
          chips: top.setupGrade ? [{ label: top.setupGrade, tone: top.setupGrade.startsWith("A") ? "up" : "muted" }] : undefined,
          title: "Top-ranked PredictionMarketFeed row (Mead/Predict)",
        });
      })
      .catch(() => {
        if (!cancelled) setRead({ status: "offline", primary: "Prediction feed offline." });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return read;
}

/** Book: backtest projection from paper account — labeled as such. */
function useBookRead(): CardRead {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return useMemo(() => {
    if (!ready) return { status: "loading", primary: "Loading book…" };
    const mem = typeof window !== "undefined" ? loadDeskMemory() : emptyDeskMemory();
    const paper = getPaperAccount(mem);
    if (!paper.pathTaken) {
      return { status: "empty", primary: "No backtest projection seeded yet." };
    }
    const wr = paper.winRate != null ? `${(paper.winRate * 100).toFixed(0)}%` : "—";
    return {
      status: "live",
      primary: `Backtest projection · ${paper.pathTaken} PATH · WR ${wr} · ΣR ${paper.sumR.toFixed(2)}`,
      lines: ["History, not this book — same seed the Book tab shows."],
      title: "Backtest memory (labeled projection)",
    };
  }, [ready]);
}

/** Lab: risk governor state. Null = signed out (sign in OK). Catch = unknown (never sign in). */
function useLabRead(): CardRead {
  const [read, setRead] = useState<CardRead>({ status: "loading", primary: "Loading governor…" });
  // Last successful non-null RiskState timestamp — used when a later read fails.
  const lastGoodAtMs = useRef<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getRiskState()
      .then((r: RiskState | null) => {
        if (cancelled) return;
        if (r) lastGoodAtMs.current = Date.now();
        setRead(labGovernorFromState(r));
      })
      .catch(() => {
        if (!cancelled) setRead(labGovernorFromError(lastGoodAtMs.current));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return read;
}

/** Discuss: next checkpoint countdown. */
function useDiscussRead(): CardRead {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return useMemo(() => {
    void tick;
    const next = nextAiSyncCheckpoint(Date.now());
    return {
      status: "live",
      primary: `Next checkpoint · ${next.slot} ET`,
      lines: [fmtAiSyncCountdown(next.secs)],
      title: "Discuss AI sync schedule",
    };
  }, [tick]);
}

/** Learn: progress n/18. */
function useLearnRead(): CardRead {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(readLearnDone());
    const on = () => setN(readLearnDone());
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  const total = MODULES.length;
  return {
    status: n > 0 ? "live" : "empty",
    primary: `Progress ${n}/${total}`,
    lines: n === 0 ? ["No modules marked complete in this browser."] : undefined,
    title: "Learn curriculum (this browser)",
  };
}

export function useCommandReads(desk: DeskPayload | null): Record<CommandTabId, CardRead> {
  const news = useNewsRead();
  const swing = useOptionsRead(desk);
  const tape = useChartsRead(desk);
  const brain = useBrainRead(desk);
  const predict = usePredictRead();
  const path = useBookRead();
  const lab = useLabRead();
  const discuss = useDiscussRead();
  const learn = useLearnRead();
  return { news, swing, tape, brain, predict, path, lab, discuss, learn };
}
