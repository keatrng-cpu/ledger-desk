/**
 * The Floor's Mead Hall: the Predict tab's hall (mead-hall-build.ts), built from the same code, standing in the wing east of the
 * lounge (src/lib/room/mead-hall-layout.ts says where).
 *
 * Lighting. The hall brings its own lights — a hemisphere, a key light, lanterns, a hearth — and the Floor's own sun, lamps and
 * clock-driven mood must not wash them out. So the hall and its lights sit on one three.js layer and are drawn in a pass of
 * their own, before the office: same camera, same depth buffer, so the lounge's wall still hides the hall and the hall still
 * hides what is behind it. A person standing inside the hall is moved onto the hall's layer, so they are lit by the hall's
 * lanterns and fire, not by the office's sun, and move back when they walk out.
 *
 * Data. The hall's screens show the prediction-market board the Predict tab shows (jumbotron = the engine's #1, Rune Board = the
 * next five, the Ledger = the crowd, the board's letters, the record); `setFeed` takes the same HallFeedState the PM analyzer
 * does. Paper only: a hall screen here is looked at, never an order — nothing in this file can reach a broker.
 *
 * Presentation only.
 */

import * as THREE from "three";
import { MeadHall, type HallScreen } from "@/components/mead/mead-hall-build";
import { setLayer } from "@/components/mead/mead-hall-kit";
import { readHallRecord } from "@/components/mead/mead-record";
import { hallExtrasFrom, type HallFeedState } from "@/components/mead/mead-signal-feed";
import { HALL_AT, HALL_ROOM, floorToHall } from "@/lib/room/mead-hall-layout";
import type { Reaction } from "@/components/mead/mead-people";

/** The three.js layer the hall and its lights live on. 0 is the office. */
export const HALL_LAYER = 1;

/** The shape FloorScene keeps for every screen it can draw on or pick. */
export interface MeadScreenRec {
  id: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  w: number;
  h: number;
}

export interface FloorMeadOptions {
  mobile: boolean;
  /** The hall's crowd reacted (cheer / groan / hail): the people in the hall react with it. */
  onReaction?: (r: Reaction, line: string) => void;
}

export class FloorMead {
  /** Put in the scene. Its child is the hall, already in the Floor's frame. */
  readonly root = new THREE.Group();
  readonly hall: MeadHall;
  private readonly bounds = new THREE.Box3();
  private readonly frustum = new THREE.Frustum();
  private readonly pv = new THREE.Matrix4();
  private readonly lit = new WeakMap<THREE.Object3D, boolean>();
  private lastState: HallFeedState | null = null;
  private recordAt = 0;

  constructor(opts: FloorMeadOptions) {
    this.hall = new MeadHall({ home: "floor", layer: HALL_LAYER, mobile: opts.mobile, crowdDriven: true, onReaction: opts.onReaction });
    this.root.name = "mead_wing";
    this.root.position.set(HALL_AT.x, 0, HALL_AT.z);
    this.root.add(this.hall.root);
    // The hall's regulars and their speech bubbles are scenery: a sight line or a click goes through them.
    for (const p of this.hall.people) p.root.traverse((o) => (o.raycast = () => undefined));
    const R = HALL_ROOM;
    this.bounds.set(
      new THREE.Vector3(R.x0 + HALL_AT.x - 0.4, -0.2, R.z0 + HALL_AT.z - 0.4),
      new THREE.Vector3(R.x1 + HALL_AT.x + 0.4, R.h + 3.4, R.z1 + HALL_AT.z + 0.4),
    );
  }

  /** Every screen the hall owns, in the form FloorScene keeps its own in (so hover, double-click and Go-to treat them alike). */
  screenRecs(): MeadScreenRec[] {
    return this.hall.screens.map((s: HallScreen) => ({
      id: s.id,
      canvas: s.canvas,
      ctx: s.canvas.getContext("2d")!,
      tex: s.tex,
      w: s.canvas.width,
      h: s.canvas.height,
    }));
  }

  /** Where each screen is in the Floor, for picking: the hall's meshes (named by screen id) are what a ray hits. */
  get meshRoot(): THREE.Object3D {
    return this.hall.root;
  }

  /** A new read of the prediction board (the Predict tab's own feed). The same read never redraws twice. */
  setFeed(state: HallFeedState) {
    if (this.lastState === state) return;
    this.lastState = state;
    this.hall.setFeed(state.hall);
    // The record is read from this device's storage; a few times a minute is plenty.
    const now = Date.now();
    const record = now - this.recordAt > 20_000 || !this.lastRecord ? readHallRecord() : this.lastRecord;
    if (record) {
      this.lastRecord = record;
      this.recordAt = now;
    }
    this.hall.setExtras(hallExtrasFrom(state, record));
    if (state.layout && state.board && !state.held) this.hall.setCrowd(state.layout.crowd, state.board.asOf);
  }
  private lastRecord: ReturnType<typeof readHallRecord> = null;

  /** Make the hall's crowd react (the Floor's talk calls this when the five react to a price). */
  react(kind: Reaction) {
    this.hall.react(kind);
  }

  update(dt: number, t: number) {
    this.hall.update(dt, t);
  }

  /**
   * Put each person who is inside the hall on the hall's layer (lit by the hall), and everyone else back on the office's.
   * `x`, `z` are Floor coordinates. A person is moved only when their side changes.
   */
  sync(things: { root: THREE.Object3D; x: number; z: number }[]) {
    for (const t of things) {
      const [hx, hz] = floorToHall(t.x, t.z);
      const was = this.lit.get(t.root) ?? false;
      // A little hysteresis at the doorway so someone standing on the threshold does not flicker between two lightings.
      const inside = was
        ? hx > HALL_ROOM.x0 - 0.35 && hx < HALL_ROOM.x1 && hz > HALL_ROOM.z0 && hz < HALL_ROOM.z1
        : hx > HALL_ROOM.x0 + 0.1 && hx < HALL_ROOM.x1 && hz > HALL_ROOM.z0 && hz < HALL_ROOM.z1;
      if (inside !== was) {
        this.lit.set(t.root, inside);
        setLayer(t.root, inside ? HALL_LAYER : 0);
      }
    }
  }

  /** Is anyone (by this test) in the hall? The Floor uses it to know whom to cheer with the crowd. */
  isInside(root: THREE.Object3D): boolean {
    return this.lit.get(root) ?? false;
  }

  /**
   * Draw the hall (its layer only), before the office is drawn on top. False when the hall is not in view — then nothing was drawn
   * and the office is drawn the ordinary way.
   */
  pass(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): boolean {
    camera.updateMatrixWorld();
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    if (!this.frustum.intersectsBox(this.bounds)) return false;
    const saved = camera.layers.mask;
    camera.layers.set(HALL_LAYER);
    renderer.render(scene, camera);
    camera.layers.mask = saved;
    return true;
  }

  dispose() {
    this.hall.dispose();
  }
}
