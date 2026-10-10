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
import { HALL_AT, HALL_DOOR, HALL_DOOR_H, HALL_ROOM, floorToHall } from "@/lib/room/mead-hall-layout";
import { MEAD, helmet, knotBorder } from "@/components/mead/mead-screens";
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
  private readonly center = new THREE.Vector3(HALL_AT.x, 2, HALL_AT.z + 4);
  private readonly frustum = new THREE.Frustum();
  private readonly pv = new THREE.Matrix4();
  private readonly lit = new WeakMap<THREE.Object3D, boolean>();
  private readonly atBar = new WeakMap<THREE.Object3D, boolean>();
  private lastState: HallFeedState | null = null;
  private recordAt = 0;

  constructor(opts: FloorMeadOptions) {
    this.hall = new MeadHall({ home: "floor", layer: HALL_LAYER, mobile: opts.mobile, crowdDriven: true, onReaction: opts.onReaction });
    this.root.name = "mead_wing";
    this.root.position.set(HALL_AT.x, 0, HALL_AT.z);
    this.root.add(this.hall.root);
    // The hall's regulars and their speech bubbles are scenery: a sight line or a click goes through them.
    for (const p of this.hall.people) p.root.traverse((o) => (o.raycast = () => undefined));
    this.buildDoorSign();
    const R = HALL_ROOM;
    this.bounds.set(
      new THREE.Vector3(R.x0 + HALL_AT.x - 0.4, -0.2, R.z0 + HALL_AT.z - 0.4),
      new THREE.Vector3(R.x1 + HALL_AT.x + 0.4, R.h + 3.4, R.z1 + HALL_AT.z + 0.4),
    );
  }

  /**
   * On the lounge's side of the doorway: a carved timber head beam, a sign, and a lantern either side — so anyone in the lounge
   * knows what the great doorway leads to. Lit by the office's lights like everything else in the lounge (layer 0).
   */
  private buildDoorSign() {
    const cv = document.createElement("canvas");
    cv.width = 1024;
    cv.height = 224;
    const c = cv.getContext("2d")!;
    c.fillStyle = MEAD.pineDeep;
    c.fillRect(0, 0, 1024, 224);
    knotBorder(c, 6, 6, 1012, 212, MEAD.brass, 18);
    helmet(c, 104, 112, 120);
    c.fillStyle = "#e0c888";
    c.font = "900 84px 'Rockwell', 'Roboto Slab', Georgia, serif";
    c.fillText("THE MEAD HALL", 190, 118);
    c.fillStyle = "#a7c4b5";
    c.font = "800 30px Inter, system-ui, sans-serif";
    c.fillText("PREDICTION MARKETS · PAPER ONLY", 192, 172);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const x = HALL_ROOM.x0 - HALL_ROOM.wallT - 0.2; // on the lounge's face of its east wall
    const z = (HALL_DOOR.z0 + HALL_DOOR.z1) / 2;
    const g = new THREE.Group();
    g.name = "mead_door_sign";
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.634), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    sign.rotation.y = -Math.PI / 2;
    sign.position.set(x - 0.09, HALL_DOOR_H + 0.62, z);
    g.add(sign);
    const wood = new THREE.MeshStandardMaterial({ color: "#3b2411", roughness: 0.8 });
    const brass = new THREE.MeshStandardMaterial({ color: MEAD.brass, roughness: 0.35, metalness: 0.6 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, HALL_DOOR.z1 - HALL_DOOR.z0 + 0.5), wood);
    beam.position.set(x - 0.02, HALL_DOOR_H + 0.13, z);
    g.add(beam);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 3.06), wood);
    frame.position.set(x - 0.01, HALL_DOOR_H + 0.62, z);
    g.add(frame);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 3.14), brass);
    trim.position.set(x - 0.04, HALL_DOOR_H + 0.99, z);
    g.add(trim);
    for (const dz of [-1.75, 1.75]) {
      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.3, 6), new THREE.MeshStandardMaterial({ color: "#ffcf7a", roughness: 0.3, emissive: new THREE.Color(0xffa53a), emissiveIntensity: 2.2 }));
      lantern.position.set(x - 0.14, HALL_DOOR_H - 0.5, z + dz);
      g.add(lantern);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.12, 6), wood);
      cap.position.set(x - 0.14, HALL_DOOR_H - 0.29, z + dz);
      g.add(cap);
    }
    // Sightlines and clicks go through the sign: it is a decoration, not a wall.
    g.traverse((o) => (o.raycast = () => undefined));
    this.root.add(g);
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

  /**
   * A click on one of the hall's screens (found by name by the Floor's own sight-line pick): which market and which side the spot
   * under the pointer stands for — the jumbotron's YES / NO boxes, a bar tap, a TV, a Rune Board row, a booth row. Null on a dead spot.
   */
  tapFor(screenId: string, ray: THREE.Raycaster): { id: string; side: "YES" | "NO" } | null {
    const sc = this.hall.screens.find((s) => s.id === screenId);
    if (!sc) return null;
    const hit = ray.intersectObject(sc.mesh, false)[0];
    return hit?.uv ? this.hall.ticketFor(sc, hit.uv) : null;
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
      // Whoever walks up to the bar gets a word from the bartender.
      const near = inside && Math.hypot(hx - 5.2, hz + 4.25) < 3.6;
      if (near && !this.atBar.get(t.root)) this.hall.greet();
      this.atBar.set(t.root, near);
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
    // Level of detail: from across the site (the Floor's overview) the hall's regulars are drawn no more. A margin so the camera
    // hovering at the line does not make them flicker.
    const d = camera.position.distanceTo(this.center);
    if (d > 33) this.hall.setFar(true);
    else if (d < 29) this.hall.setFar(false);
    const saved = camera.layers.mask;
    camera.layers.set(HALL_LAYER);
    try {
      renderer.render(scene, camera);
    } finally {
      camera.layers.mask = saved;
    }
    return true;
  }

  dispose() {
    this.hall.dispose();
  }
}
