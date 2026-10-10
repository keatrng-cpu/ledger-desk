/**
 * The Floor's Mead Hall reads the same prediction-market board the Predict tab does (Kalshi public, read-only: the signal engine's
 * ranked board, jumbotron = #1, Rune Board = the next five, the crowd from real price velocity), for as long as the Floor tab is
 * open and visible. About one pull every 60 s (the feed loop pauses with the page); a failed or empty poll keeps the last live
 * board and marks it stale. The pull is `loadHallBoard` (the PM analyzer's own path: the sports scanner's model inputs go into the
 * signal engine, so a board is graded where a model exists and an "edge" is never invented), and every board is also published to
 * the hall store, so the five's talk reads exactly what the screens draw. Presentation only: nothing here sizes, gates or sends anything.
 */

import { useEffect, type MutableRefObject } from "react";
import { setHall } from "@/lib/room/hall-store";
import { createSignalHallFeed } from "@/components/mead/mead-signal-feed";
import { loadHallBoard } from "./hall-read";
import type { FloorScene } from "./floor-scene";

export function useMeadFloorFeed(sceneRef: MutableRefObject<FloorScene | null>, env: "glb" | "fallback" | null): void {
  useEffect(() => {
    if (!env) return; // the scene is up once its environment answers
    const feed = createSignalHallFeed({ load: loadHallBoard, every: 60_000 });
    const off = feed.subscribe((s) => {
      sceneRef.current?.setHall(s);
      // a feed that has read nothing yet (board null) never clears the board the store holds; a failure is marked held, not wiped
      if (s.board) setHall({ board: s.board, status: s.status, held: s.held, error: s.error, at: Date.now() });
    });
    return () => {
      off();
      feed.dispose();
    };
  }, [env, sceneRef]);
}
