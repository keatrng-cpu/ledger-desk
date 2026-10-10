/**
 * The Floor's Mead Hall reads the same prediction-market board the Predict tab does (Kalshi public, read-only: the signal engine's
 * ranked board, jumbotron = #1, Rune Board = the next five, the crowd from real price velocity), for as long as the Floor tab is
 * open and visible. About one call every 45 s (the feed loop pauses with the page); a failed or empty poll keeps the last live
 * board and marks it stale. Presentation only: nothing here sizes, gates or sends anything.
 */

import { useEffect, type MutableRefObject } from "react";
import { getPredictionSignals } from "@/lib/predict/predict-server";
import type { SignalBoard } from "@/lib/predict/signal-engine";
import { createSignalHallFeed } from "@/components/mead/mead-signal-feed";
import type { FloorScene } from "./floor-scene";

export function useMeadFloorFeed(sceneRef: MutableRefObject<FloorScene | null>, env: "glb" | "fallback" | null): void {
  useEffect(() => {
    if (!env) return; // the scene is up once its environment answers
    const feed = createSignalHallFeed({ load: () => getPredictionSignals({ data: {} }) as Promise<SignalBoard>, every: 45_000 });
    const off = feed.subscribe((s) => sceneRef.current?.setHall(s));
    return () => {
      off();
      feed.dispose();
    };
  }, [env, sceneRef]);
}
