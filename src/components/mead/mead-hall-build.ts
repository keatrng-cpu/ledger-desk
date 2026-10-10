/**
 * The Mead Hall, built once for both homes: the Predict tab's own 3D view (mead-scene.ts) and the Floor (floor-mead.ts).
 *
 * A pine / iron / brass longship hall — the bar is a hull with dragon prows, a field runner leads to the jumbotron, booths carry
 * table screens, a Rune Board chalkboard, three over-bar TVs, a neon sign — plus the front lobby (the Long Table, the hearth, the
 * Skald's lectern, the Skald's Ledger; see mead-hall-extras.ts). Original Norse art only — no team or league marks.
 *
 * Everything is in the hall's own frame (x −9…9, z −7…11, 7 m high; src/lib/room/mead-hall-layout.ts). The caller places `root`:
 * the standalone tab leaves it at the origin, the Floor moves it into the wing east of the lounge. The hall brings its OWN lights
 * (hemisphere, a key light, lanterns, a mood light), all on the hall's three.js layer, so the Floor can draw the hall in a pass of
 * its own and the lounge's sun and clock never wash it out.
 *
 * Presentation only. PAPER ONLY: a tap on a screen reports a market and a side to the caller; nothing here can reach a broker.
 */

import * as THREE from "three";
import type { PredictionMarketFeedState } from "@/lib/predict/prediction-market-feed";
import type { CrowdRead } from "@/lib/predict/signal-engine";
import { HALL_DOOR, HALL_DOOR_H, HALL_NPCS, HALL_ROOM } from "@/lib/room/mead-hall-layout";
import { reactionForCrowd } from "./mead-signal-feed";
import { Person, type PersonLook, type Reaction } from "./mead-people";
import { Kit, bakeStatic, damp, keepLive, setLayer, woodCanvas } from "./mead-hall-kit";
import {
  MEAD,
  JUMBO_H,
  JUMBO_W,
  drawBooth,
  drawJumbotron,
  drawKnotPanel,
  drawNeon,
  drawRunner,
  drawRuneBoard,
  drawTapShield,
  drawTv,
  jumboHit,
  type HallExtras,
} from "./mead-screens";
import { buildHallExtras, type HallExtrasHandle } from "./mead-hall-extras";

export type { Reaction };
/** The desk's entry-state words, reused as the hall's mood (lighting only). */
export type MeadMood = "WAIT" | "STALKING" | "ARMED" | "ENTER";
export type TicketSide = "YES" | "NO";
type V2 = [number, number];

export interface HallOptions {
  /** standalone: open front, no doorway, shadows from its own key light. floor: a closed room with a doorway and a front wall. */
  home: "standalone" | "floor";
  mobile?: boolean;
  /** The three.js layer for every object and light of the hall (the Floor draws layer 1 in its own pass). */
  layer?: number;
  /** The crowd reacted (the tab flashes the edge the same colour). */
  onReaction?: (r: Reaction, line: string) => void;
  /** PM analyzer mode: the crowd reacts ONLY to `setCrowd` (real price velocity), never to a poll-to-poll diff. */
  crowdDriven?: boolean;
}

export interface HallScreen {
  /** The Floor plan's id where the plan names it (mead_jumbo …), else a local id. The mesh carries the same name. */
  id: string;
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  kind: "jumbo" | "board" | "tv" | "booth" | "tap" | "ledger" | "table" | "lectern";
  index: number;
  label: string;
}

/** Lighting per mood — the same palette the Floor uses for the entry state. */
const MOOD: Record<MeadMood, { glow: number; glowI: number }> = {
  WAIT: { glow: 0x6b7280, glowI: 3 },
  STALKING: { glow: 0xf59e0b, glowI: 6 },
  ARMED: { glow: 0x14b8a6, glowI: 7 },
  ENTER: { glow: 0x22c55e, glowI: 10 },
};

const LINES: Record<Reaction, string[]> = {
  cheer: ["LET'S GO!", "Price is moving!", "Value!", "Pour another!"],
  groan: ["Oof…", "Come on!", "Brutal.", "Not the line…"],
  hail: ["HAIL!", "HAIL!!", "TO VALHALLA!"],
};

/** The regulars' looks (the standalone crowd), keyed by HALL_NPCS id. */
const NPC_LOOK: Record<string, PersonLook> = {
  bartender: { shirt: "#3b2411", helmet: true, beard: "#c2772b", skin: "#e0a77f" },
  booth_a0: { shirt: MEAD.pine, helmet: true, beard: "#8b5a2b", mug: true },
  booth_a1: { shirt: MEAD.pine, hair: "#2b1a0b", skin: "#c68a5e", mug: true },
  booth_b0: { shirt: MEAD.white, hair: "#d4a017", mug: true },
  booth_b1: { shirt: MEAD.pine, hair: "#111", skin: "#8d5a3b", mug: true },
  stool_0: { shirt: MEAD.pine, hair: "#3b2411", mug: true },
  stool_1: { shirt: MEAD.brass, helmet: true, beard: "#5b3a1e", mug: true },
  stool_2: { shirt: MEAD.pine, hair: "#111", skin: "#a8714a", mug: true },
  fan_0: { shirt: MEAD.pine, hair: "#5b3a1e", mug: true },
  fan_1: { shirt: MEAD.white, helmet: true, beard: "#d4a017", mug: true },
  fan_2: { shirt: MEAD.brass, hair: "#111", skin: "#8d5a3b", mug: true },
  fan_3: { shirt: MEAD.pine, hair: "#c2772b", mug: true },
};

export class MeadHall {
  readonly root = new THREE.Group();
  readonly kit = new Kit();
  readonly screens: HallScreen[] = [];
  readonly people: Person[] = [];
  readonly bartender: Person;
  readonly opts: HallOptions;
  readonly layer: number;
  private readonly floorHome: boolean;
  private readonly key: THREE.DirectionalLight;
  private frameNo = 0;
  private readonly moodLight: THREE.PointLight;
  private readonly flashLight: THREE.PointLight;
  private readonly neon: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial };
  private readonly lanterns: THREE.PointLight[] = [];
  private readonly extras: HallExtrasHandle;
  private mood: MeadMood = "WAIT";
  private state: PredictionMarketFeedState | null = null;
  private extra: HallExtras = {};
  private prevYes = new Map<string, number>();
  private prevGo = new Set<string>();
  /** Board asOf of the last CrowdRead acted on (one reaction per real read). */
  private crowdKey: string | null = null;
  /** Rotates speech lines / talkers deterministically (no Math.random in reactions). */
  private reactSeq = 0;
  private flash: { color: number; until: number; kind: "up" | "down" | null } = { color: 0, until: 0, kind: null };
  private time = 0;
  private lastJumboDraw = 0;
  /** Build stats (merged meshes before / after): the Floor's budget check reads them. */
  readonly stats: { meshesBefore: number; meshesAfter: number };

  constructor(opts: HallOptions) {
    this.opts = opts;
    this.floorHome = opts.home === "floor";
    this.layer = opts.layer ?? 0;
    const mobile = opts.mobile ?? false;
    this.root.name = "mead_hall_root";

    // Light: warm lanterns in a pine room.
    this.root.add(new THREE.HemisphereLight(0xc8ddd4, 0x2a1a10, 0.55));
    const key = new THREE.DirectionalLight(0xffe6c0, 0.9);
    key.position.set(4, 12, 9);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    const reach = this.floorHome ? { left: -14, right: 14, top: 14, bottom: -14 } : { left: -12, right: 12, top: 10, bottom: -10 };
    Object.assign(key.shadow.camera, { ...reach, near: 1, far: 40 });
    key.shadow.bias = -0.0005;
    key.shadow.camera.updateProjectionMatrix();
    // In the Floor the hall is one part of a big scene: its shadows refresh every third frame (people still move, the room does not).
    if (this.floorHome) key.shadow.autoUpdate = false;
    this.key = key;
    this.root.add(key, key.target);
    this.moodLight = new THREE.PointLight(MOOD.WAIT.glow, MOOD.WAIT.glowI, 14, 1.4);
    this.moodLight.position.set(-1.8, 3.2, -5.2);
    this.root.add(this.moodLight);
    this.flashLight = new THREE.PointLight(0xc4a35a, 0, 22, 1.2);
    this.flashLight.position.set(0, 4.2, 0);
    this.root.add(this.flashLight);

    this.buildRoom();
    this.buildBar();
    this.buildBooths();
    this.buildPoolTable();
    this.buildScreens();
    this.neon = this.buildNeon();
    this.bartender = this.buildCrowd();
    this.extras = buildHallExtras({
      kit: this.kit,
      root: this.root,
      screens: this.screens,
      lights: this.lanterns,
      floorHome: this.floorHome,
      add: (o, shadow) => this.add(o, shadow),
      box: (w, h, d, m, x, y, z, ry) => this.box(w, h, d, m, x, y, z, ry),
    });

    // Merge everything that never moves, then put the whole hall on its layer.
    for (const p of this.people) keepLive(p.root);
    for (const s of this.screens) keepLive(s.mesh);
    const st = bakeStatic(this.root);
    this.stats = { meshesBefore: st.before, meshesAfter: st.after };
    setLayer(this.root, this.layer);
    this.redraw();
  }

  /* ── build ── */

  private add<T extends THREE.Object3D>(o: T, shadow = true): T {
    if (shadow)
      o.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
    this.root.add(o);
    return o;
  }

  private box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    return this.add(mesh);
  }

  private buildRoom() {
    const R = HALL_ROOM;
    const W = R.x1 - R.x0;
    const D = R.z1 - R.z0;
    const cz = (R.z0 + R.z1) / 2;
    const k = this.kit;
    // Floor: wood planks (plank scale kept as the 14 m hall had it).
    const floor = k.canvasTex(1024, 1024, (c) => woodCanvas(c, "#4a2e17", "#2b1a0b"));
    floor.tex.wrapS = floor.tex.wrapT = THREE.RepeatWrapping;
    floor.tex.repeat.set(4, (4 * D) / 14);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(W, D), k.own(new THREE.MeshStandardMaterial({ map: floor.tex, roughness: 0.85 })));
    fl.rotation.x = -Math.PI / 2;
    fl.position.z = cz;
    fl.receiveShadow = true;
    this.root.add(fl);
    // Walls: pine with brass trim, wainscot wood below.
    const pine = k.mat(MEAD.pine, 0.9);
    const brass = k.mat(MEAD.brass, 0.35, 0.6, 0x5a3b00, 0.25);
    const wood = k.mat("#3b2411", 0.8);
    const back = this.box(W, R.h, 0.2, pine, 0, R.h / 2, R.z0 - 0.1);
    back.castShadow = false;
    // Wainscot + trim lines on the back wall.
    this.box(W, 1.0, 0.06, wood, 0, 0.5, R.z0 + 0.03);
    this.box(W, 0.07, 0.1, brass, 0, 1.04, R.z0 + 0.05);
    this.box(W, 0.12, 0.1, brass, 0, R.h - 0.25, R.z0 + 0.05);
    // Side walls. In the Floor the west one carries the doorway to the lounge.
    for (const sx of [-1, 1]) {
      const gap = this.floorHome && sx < 0 ? ([HALL_DOOR.z0, HALL_DOOR.z1] as V2) : null;
      const spans: V2[] = gap ? [[R.z0, gap[0]], [gap[1], R.z1]] : [[R.z0, R.z1]];
      for (const [za, zb] of spans) {
        const len = zb - za;
        const mid = (za + zb) / 2;
        const side = this.box(0.2, R.h, len, pine, sx * (R.x1 + 0.1), R.h / 2, mid);
        side.castShadow = false;
        this.box(0.06, 1.0, len, wood, sx * (R.x1 - 0.03), 0.5, mid);
        this.box(0.1, 0.07, len, brass, sx * (R.x1 - 0.05), 1.04, mid);
        this.box(0.1, 0.12, len, brass, sx * (R.x1 - 0.05), R.h - 0.25, mid);
      }
      if (gap) {
        // Over the doorway: pine to the ceiling, the trim lines carried across, and a carved timber frame.
        const len = gap[1] - gap[0];
        const mid = (gap[0] + gap[1]) / 2;
        const above = R.h - HALL_DOOR_H;
        const lintel = this.box(0.2, above, len, pine, sx * (R.x1 + 0.1), HALL_DOOR_H + above / 2, mid);
        lintel.castShadow = false;
        this.box(0.1, 0.12, len, brass, sx * (R.x1 - 0.05), R.h - 0.25, mid);
        this.box(0.34, 0.3, len + 0.5, wood, sx * (R.x1 - 0.2), HALL_DOOR_H + 0.1, mid);
        for (const z of gap) this.box(0.34, HALL_DOOR_H + 0.25, 0.34, wood, sx * (R.x1 - 0.2), (HALL_DOOR_H + 0.25) / 2, z);
        this.box(0.08, 0.07, len + 0.3, brass, sx * (R.x1 - 0.06), HALL_DOOR_H - 0.04, mid);
      }
    }
    // The front: open toward the camera in the tab; in the Floor a low timber wall (the building's own front is low too).
    if (this.floorHome) {
      const zf = R.z1 + 0.1;
      this.box(W, 1.0, 0.2, wood, 0, 0.5, zf);
      this.box(W, 0.07, 0.3, brass, 0, 1.04, zf);
      for (let x = R.x0; x <= R.x1 + 0.01; x += W / 4) this.box(0.34, R.h, 0.34, wood, x, R.h / 2, zf - 0.1);
    }
    // In the Floor the hall is seen from outside too (from the lounge, from the overview): an outer skin of planks that carries
    // a little light of its own, so the tall walls read as a timber hall and not as black cliffs behind the building.
    if (this.floorHome) {
      const plank = k.canvasTex(512, 512, (c) => woodCanvas(c, "#3f5d4b", "#243b2e"));
      plank.tex.wrapS = plank.tex.wrapT = THREE.RepeatWrapping;
      const skinMat = k.own(
        new THREE.MeshStandardMaterial({ map: plank.tex, emissive: new THREE.Color(0xffffff), emissiveMap: plank.tex, emissiveIntensity: 0.95, roughness: 0.9 }),
      );
      /** A plank-covered plane `len` wide and `h` tall, its bottom edge at y0, facing yaw ry, centred on (cx, cz). */
      const skin = (cx: number, cz: number, len: number, h: number, y0: number, ry: number) => {
        const geo = new THREE.PlaneGeometry(len, h);
        const uv = geo.getAttribute("uv");
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len) / 3, (uv.getY(i) * h) / 3);
        const m = new THREE.Mesh(geo, skinMat);
        m.position.set(cx, y0 + h / 2, cz);
        m.rotation.y = ry;
        this.root.add(m);
      };
      const out = 0.215;
      skin(0, R.z0 - out, W + 0.5, R.h, 0, Math.PI);
      skin(R.x1 + out, cz, D + 0.5, R.h, 0, Math.PI / 2);
      skin(0, R.z1 + out, W + 0.5, 1.0, 0, 0);
      skin(R.x0 - out, (R.z0 - 0.2 + HALL_DOOR.z0) / 2, HALL_DOOR.z0 - R.z0 + 0.2, R.h, 0, -Math.PI / 2);
      skin(R.x0 - out, (HALL_DOOR.z1 + R.z1 + 0.2) / 2, R.z1 + 0.2 - HALL_DOOR.z1, R.h, 0, -Math.PI / 2);
      skin(R.x0 - out, (HALL_DOOR.z0 + HALL_DOOR.z1) / 2, HALL_DOOR.z1 - HALL_DOOR.z0, R.h - HALL_DOOR_H, HALL_DOOR_H, -Math.PI / 2);
    }
    // Knotwork frieze above the screens.
    const frieze = k.canvasTex(2048, 128, (c) => drawKnotPanel(c, MEAD.pineDeep));
    const fz = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.9), k.own(new THREE.MeshStandardMaterial({ map: frieze.tex, roughness: 0.8 })));
    fz.position.set(0, 5.35, R.z0 + 0.04);
    this.root.add(fz);
    this.box(W, 0.07, 0.1, brass, 0, 4.85, R.z0 + 0.05);
    this.box(W, 0.07, 0.1, brass, 0, 5.85, R.z0 + 0.05);
    // Ceiling beams (dark timber, brass knot caps) — no ceiling plane so the camera sees in.
    for (let z = -6; z <= 9; z += 3) this.box(W, 0.32, 0.3, wood, 0, R.h - 0.1, z);
    // Timber posts with brass knot panels on the side walls.
    for (const sx of [-1, 1]) {
      for (const z of [-6.6, -1.5, 3.6, 8.6]) this.box(0.34, R.h, 0.34, wood, sx * (R.x1 - 0.2), R.h / 2, z);
    }
    const panel = k.canvasTex(256, 512, (c) => drawKnotPanel(c, MEAD.pineDeep));
    const banner = k.own(new THREE.MeshStandardMaterial({ map: panel.tex, roughness: 0.8 }));
    for (const z of [-4.1, 1.0]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), banner);
      b.position.set(R.x0 + 0.06, 2.6, z);
      b.rotation.y = Math.PI / 2;
      this.root.add(b);
    }
    // Shields on the back wall between screens.
    const shieldTex = k.canvasTex(256, 256, (c) => {
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = MEAD.pine;
      ctx.beginPath();
      ctx.arc(128, 128, 124, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 14;
      ctx.strokeStyle = MEAD.brass;
      ctx.stroke();
      ctx.fillStyle = MEAD.brass;
      for (let i = 0; i < 8; i++) {
        ctx.save();
        ctx.translate(128, 128);
        ctx.rotate((i / 8) * Math.PI * 2);
        ctx.fillRect(-6, -118, 12, 118);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(128, 128, 30, 0, Math.PI * 2);
      ctx.fillStyle = "#c0c0c0";
      ctx.fill();
    });
    const shieldMat = k.own(new THREE.MeshStandardMaterial({ map: shieldTex.tex, roughness: 0.5, metalness: 0.3 }));
    for (const [x, y] of [
      [-8.2, 1.6],
      [-4.2, 1.6],
      [0.8, 1.6],
      [R.x1 - 0.35, 2.4],
    ] as V2[]) {
      const s = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), shieldMat);
      s.position.set(x, y, R.z0 + 0.08);
      if (x > 8) {
        s.position.set(R.x1 - 0.08, y, 3.2);
        s.rotation.y = -Math.PI / 2;
      }
      this.root.add(s);
    }
    // Football-field runner from the front to the jumbotron.
    const runner = k.canvasTex(512, 2048, drawRunner);
    const rn = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 12.6), k.own(new THREE.MeshStandardMaterial({ map: runner.tex, roughness: 0.95 })));
    rn.rotation.x = -Math.PI / 2;
    rn.position.set(-1.8, 0.012, 0.4);
    rn.receiveShadow = true;
    this.root.add(rn);
    // Hanging lanterns.
    const lantern = (x: number, y: number, z: number) => {
      const g = new THREE.Group();
      const frame = k.mat("#2b1a0b", 0.6, 0.4);
      const glass = k.mat("#ffcf7a", 0.3, 0, 0xffa53a, 2.2);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.34, 6), glass);
      g.add(body);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.16, 6), frame);
      cap.position.y = 0.25;
      g.add(cap);
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, R.h - y), frame);
      chain.position.y = (R.h - y) / 2 + 0.3;
      g.add(chain);
      g.position.set(x, y, z);
      this.root.add(g);
      const light = new THREE.PointLight(0xffb45a, 6, 9, 1.6);
      light.position.set(x, y - 0.1, z);
      this.root.add(light);
      this.lanterns.push(light);
    };
    lantern(-6.6, 3.4, -2.4);
    lantern(-6.6, 3.4, 1.0);
    lantern(-5.5, 3.6, 4.3);
    lantern(4.8, 3.9, -1.6);
    lantern(0.8, 3.9, 2.6);
  }

  /** The longship bar: plank hull, shields, brass knot band, dragon prows (no horns). */
  private buildBar() {
    const R = HALL_ROOM;
    const k = this.kit;
    const g = new THREE.Group();
    const hullTex = k.canvasTex(1024, 256, (c) => woodCanvas(c, "#6b4423", "#3a2210"));
    const hull = k.own(new THREE.MeshStandardMaterial({ map: hullTex.tex, roughness: 0.75 }));
    const dark = k.mat("#3a2210", 0.7);
    const brass = k.mat(MEAD.brass, 0.35, 0.6, 0x4a3000, 0.2);
    const x0 = 2.1;
    const x1 = 8.4;
    const L = x1 - x0;
    const cx = (x0 + x1) / 2;
    const z = -3.2;
    // Hull: a lathed half-boat — wider at the top like a ship's side.
    const shape = new THREE.Shape();
    shape.moveTo(-L / 2, 0);
    shape.lineTo(L / 2, 0);
    shape.quadraticCurveTo(L / 2 + 0.5, 0.6, L / 2 + 0.35, 1.12);
    shape.lineTo(-L / 2 - 0.35, 1.12);
    shape.quadraticCurveTo(-L / 2 - 0.5, 0.6, -L / 2, 0);
    const hg = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false });
    hg.translate(0, 0, -0.45);
    const hullMesh = new THREE.Mesh(hg, hull);
    hullMesh.position.set(cx, 0, z);
    g.add(hullMesh);
    // Bar top.
    const top = new THREE.Mesh(new THREE.BoxGeometry(L + 0.9, 0.08, 1.05), dark);
    top.position.set(cx, 1.16, z);
    g.add(top);
    // Brass knot band on the hull front.
    const band = k.canvasTex(1024, 96, (c) => drawKnotPanel(c, MEAD.pine));
    const bandMesh = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.4, 0.26), k.own(new THREE.MeshStandardMaterial({ map: band.tex, roughness: 0.6 })));
    bandMesh.position.set(cx, 0.82, z + 0.47);
    g.add(bandMesh);
    // Round shields along the hull.
    for (let i = 0; i < 6; i++) {
      const sx = x0 + 0.5 + (i * (L - 1)) / 5;
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 24), i % 2 ? k.mat(MEAD.pine, 0.6) : k.mat(MEAD.white, 0.6));
      sh.rotation.x = Math.PI / 2;
      sh.position.set(sx, 0.42, z + 0.48);
      g.add(sh);
      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), brass);
      boss.position.set(sx, 0.42, z + 0.52);
      g.add(boss);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.022, 6, 24), brass);
      rim.position.set(sx, 0.42, z + 0.51);
      g.add(rim);
    }
    // Dragon prows: a curling neck (tube) and a head at each end.
    for (const side of [-1, 1]) {
      const bx = side < 0 ? x0 - 0.35 : x1 + 0.35;
      const pts = [
        new THREE.Vector3(bx, 0.9, z),
        new THREE.Vector3(bx + side * 0.45, 1.6, z),
        new THREE.Vector3(bx + side * 0.55, 2.4, z),
        new THREE.Vector3(bx + side * 0.25, 2.9, z),
        new THREE.Vector3(bx - side * 0.15, 3.0, z),
      ];
      const curve = new THREE.CatmullRomCurve3(pts);
      const neck = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.13, 10, false), hull);
      g.add(neck);
      for (let i = 1; i < 8; i++) {
        const p = curve.getPoint(i / 8);
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), brass);
        fin.position.copy(p).add(new THREE.Vector3(side * 0.12, 0.05, 0));
        fin.rotation.z = -side * 0.8;
        g.add(fin);
      }
      const headG = new THREE.Group();
      const skull = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.26), hull);
      headG.add(skull);
      const snout = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 6), hull);
      snout.rotation.z = (Math.PI / 2) * side * -1;
      snout.position.x = -side * 0.34;
      headG.add(snout);
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.2), dark);
      jaw.position.set(-side * 0.12, -0.14, 0);
      jaw.rotation.z = side * 0.25;
      headG.add(jaw);
      for (const ez of [-0.13, 0.13]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), k.mat(MEAD.brass, 0.2, 0.2, 0xc4a35a, 2));
        eye.position.set(-side * 0.06, 0.06, ez);
        headG.add(eye);
      }
      headG.position.copy(pts[4]).add(new THREE.Vector3(-side * 0.15, 0, 0));
      g.add(headG);
    }
    // Back shelf with bottles + mugs.
    const shelfZ = R.z0 + 0.35;
    for (const y of [1.2, 1.75, 2.3]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.06, 0.45), dark);
      s.position.set(cx, y, shelfZ);
      g.add(s);
      for (let i = 0; i < 18; i++) {
        const bx = x0 + 0.1 + i * 0.36;
        const col = ["#14532d", "#7c2d12", "#a16207", "#1e3a8a", "#1a3c2e"][(i * 7 + Math.round(y * 10)) % 5];
        const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.32, 8), k.mat(col, 0.15, 0.1, new THREE.Color(col).getHex(), 0.25));
        bottle.position.set(bx, y + 0.19, shelfZ + ((i % 2) * 0.1 - 0.05));
        g.add(bottle);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.12, 6), bottle.material);
        neck.position.set(bx, y + 0.41, bottle.position.z);
        g.add(neck);
      }
    }
    // Back counter under the shelves.
    const counter = new THREE.Mesh(new THREE.BoxGeometry(6.6, 1.0, 0.7), hull);
    counter.position.set(cx, 0.5, R.z0 + 0.4);
    g.add(counter);
    // Mugs on the bar.
    for (const [mx, mz] of [
      [4.6, -3.0],
      [5.9, -2.95],
      [7.3, -3.05],
    ] as V2[]) {
      const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.17, 12), k.mat("#7c5a32", 0.6));
      mug.position.set(mx, 1.29, mz);
      g.add(mug);
      const foam = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.03, 12), k.mat(MEAD.white, 0.9));
      foam.position.set(mx, 1.39, mz);
      g.add(foam);
    }
    // Stools.
    for (let i = 0; i < 5; i++) {
      const sx = 3.0 + i * 1.2;
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.12, 18), k.mat(MEAD.pine, 0.6));
      seat.position.set(sx, 0.78, -2.2);
      g.add(seat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.025, 6, 20), brass);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(sx, 0.78, -2.2);
      g.add(ring);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.72, 10), dark);
      leg.position.set(sx, 0.36, -2.2);
      g.add(leg);
    }
    // YES / NO tap handles — clickable.
    for (const [i, label] of (["YES", "NO"] as const).entries()) {
      const tx = 2.55 + i * 0.6;
      const chrome = k.mat("#d1d5db", 0.2, 0.9);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.32, 10), chrome);
      base.position.set(tx, 1.36, z);
      g.add(base);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.42, 8), k.mat("#1f1305", 0.5));
      handle.position.set(tx, 1.72, z);
      g.add(handle);
      const shield = k.canvasTex(256, 300, (c) => drawTapShield(c, label));
      const sm = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.5),
        k.own(new THREE.MeshStandardMaterial({ map: shield.tex, transparent: true, roughness: 0.4, emissive: new THREE.Color(0xffffff), emissiveMap: shield.tex, emissiveIntensity: 0.35 })),
      );
      sm.position.set(tx, 2.05, z + 0.03);
      sm.name = `mead_tap_${label.toLowerCase()}`;
      g.add(sm);
      this.screens.push({ id: sm.name, mesh: sm, canvas: shield.canvas, tex: shield.tex, kind: "tap", index: i, label: `${label} tap — paper ticket on the featured market` });
    }
    this.add(g);
  }

  private buildBooths() {
    const k = this.kit;
    const wood = k.mat("#3b2411", 0.75);
    const uph = k.mat(MEAD.pine, 0.85);
    const brass = k.mat(MEAD.brass, 0.35, 0.6);
    const panel = k.canvasTex(256, 192, (c) => drawKnotPanel(c, MEAD.pine));
    const panelMat = k.own(new THREE.MeshStandardMaterial({ map: panel.tex, roughness: 0.8 }));
    const booth = (cz: number, index: number, slot: number) => {
      const g = new THREE.Group();
      // Table.
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.07, 1.0), wood);
      top.position.set(-7.4, 0.78, cz);
      g.add(top);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.2, 0.75, 10), wood);
      leg.position.set(-7.4, 0.38, cz);
      g.add(leg);
      // Benches either side (front/back along z).
      for (const s of [-1, 1]) {
        const bz = cz + s * 0.95;
        const seat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 0.55), uph);
        seat.position.set(-7.4, 0.23, bz);
        g.add(seat);
        const backrest = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.3, 0.16), uph);
        backrest.position.set(-7.4, 0.95, bz + s * 0.3);
        g.add(backrest);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.06, 0.2), brass);
        trim.position.set(-7.4, 1.62, bz + s * 0.3);
        g.add(trim);
        const p = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), panelMat);
        p.position.set(-7.4, 1.0, bz + s * 0.39);
        if (s < 0) p.rotation.y = Math.PI;
        g.add(p);
      }
      // Table screen: a small tilted monitor facing the room (+x).
      const screen = k.canvasTex(512, 384, (c) => drawBooth(c, this.emptyState(), index));
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), k.own(new THREE.MeshBasicMaterial({ map: screen.tex, toneMapped: false })));
      sm.position.set(-6.8, 1.15, cz);
      sm.rotation.y = Math.PI / 2 - 0.35;
      sm.rotation.x = -0.12;
      sm.name = `mead_booth_${slot}`;
      g.add(sm);
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.06), k.mat("#111827", 0.4, 0.5));
      stand.position.set(-6.86, 0.96, cz);
      g.add(stand);
      const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.66, 0.86), k.mat("#0b0f14", 0.4, 0.5));
      bezel.position.set(-6.82, 1.15, cz);
      bezel.rotation.copy(sm.rotation);
      bezel.rotation.y -= Math.PI / 2;
      g.add(bezel);
      this.screens.push({ id: sm.name, mesh: sm, canvas: screen.canvas, tex: screen.tex, kind: "booth", index, label: "Booth market watch — tap a row for a paper ticket" });
      this.add(g);
    };
    booth(-2.5, 0, 0);
    booth(0.9, 2, 1);
  }

  private buildPoolTable() {
    const k = this.kit;
    const g = new THREE.Group();
    const wood = k.mat("#4a2a12", 0.6);
    const felt = k.mat(MEAD.pine, 0.95);
    const cx = -5.5;
    const cz = 4.3;
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.4), felt);
    bed.position.set(cx, 0.86, cz);
    g.add(bed);
    for (const [w, d, x, z] of [
      [2.9, 0.15, 0, 0.77],
      [2.9, 0.15, 0, -0.77],
      [0.15, 1.7, 1.37, 0],
      [0.15, 1.7, -1.37, 0],
    ]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d), wood);
      rail.position.set(cx + x, 0.92, cz + z);
      g.add(rail);
    }
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.3, 1.5), wood);
    body.position.set(cx, 0.65, cz);
    g.add(body);
    for (const [x, z] of [
      [-1.2, -0.6],
      [1.2, -0.6],
      [-1.2, 0.6],
      [1.2, 0.6],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.18), wood);
      leg.position.set(cx + x, 0.27, cz + z);
      g.add(leg);
    }
    const ballCols = [MEAD.brass, "#dc2626", MEAD.white, "#1d4ed8", "#111111", "#16a34a", MEAD.brass, "#ea580c"];
    ballCols.forEach((c, i) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), k.mat(c, 0.2, 0.1));
      b.position.set(cx - 0.6 + (i % 4) * 0.35 + (i > 3 ? 0.2 : 0), 0.965, cz - 0.3 + Math.floor(i / 4) * 0.45);
      g.add(b);
    });
    const cue = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 1.4, 8), k.mat("#d6b88a", 0.5));
    cue.rotation.z = Math.PI / 2 - 0.15;
    cue.position.set(cx + 0.8, 1.05, cz + 0.2);
    g.add(cue);
    // A low lamp over the felt.
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.28, 16, 1, true), k.mat("#1f1305", 0.5, 0.3, 0x1a3c2e, 0.2));
    shade.position.set(cx, 2.6, cz);
    g.add(shade);
    const l = new THREE.PointLight(0xfff0c8, 5, 5, 1.6);
    l.position.set(cx, 2.4, cz);
    g.add(l);
    this.add(g);
  }

  private buildScreens() {
    const R = HALL_ROOM;
    const k = this.kit;
    // Jumbotron on the back wall, at the end of the runner.
    const jw = 5.8;
    const jh = (jw * JUMBO_H) / JUMBO_W;
    const j = k.canvasTex(JUMBO_W, JUMBO_H, (c) => drawJumbotron(c, this.emptyState()));
    const jm = new THREE.Mesh(new THREE.PlaneGeometry(jw, jh), k.own(new THREE.MeshBasicMaterial({ map: j.tex, toneMapped: false })));
    jm.position.set(-1.8, 3.05, R.z0 + 0.2);
    jm.name = "mead_jumbo";
    this.root.add(jm);
    this.box(jw + 0.3, jh + 0.3, 0.16, k.mat("#0a1610", 0.5, 0.4), -1.8, 3.05, R.z0 + 0.1);
    this.box(jw + 0.42, 0.08, 0.2, k.mat(MEAD.brass, 0.35, 0.6), -1.8, 3.05 + jh / 2 + 0.17, R.z0 + 0.12);
    this.box(jw + 0.42, 0.08, 0.2, k.mat(MEAD.brass, 0.35, 0.6), -1.8, 3.05 - jh / 2 - 0.17, R.z0 + 0.12);
    this.screens.push({ id: jm.name, mesh: jm, canvas: j.canvas, tex: j.tex, kind: "jumbo", index: 0, label: "Jumbotron — tap YES / NO for a paper ticket" });

    // Rune Board chalkboard on the back-left wall, angled toward the room.
    const s = k.canvasTex(768, 1024, (c) => drawRuneBoard(c, this.emptyState()));
    const sm = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 3.07),
      k.own(new THREE.MeshStandardMaterial({ map: s.tex, roughness: 0.9, emissive: new THREE.Color(0xffffff), emissiveMap: s.tex, emissiveIntensity: 0.32 })),
    );
    sm.position.set(-7.0, 2.65, R.z0 + 0.6);
    sm.rotation.y = 0.45;
    sm.name = "mead_board";
    this.root.add(sm);
    const frame = this.box(2.5, 3.27, 0.1, k.mat("#3b2411", 0.7), -7.0, 2.65, R.z0 + 0.55, 0.45);
    frame.position.x -= Math.sin(0.45) * 0.05;
    this.screens.push({ id: sm.name, mesh: sm, canvas: s.canvas, tex: s.tex, kind: "board", index: 0, label: "Rune Board — tap a setup for a paper ticket" });

    // Three over-bar TVs.
    for (let i = 0; i < 3; i++) {
      const tv = k.canvasTex(512, 400, (c) => drawTv(c, null, false));
      const x = 3.35 + i * 2.0;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 1.37), k.own(new THREE.MeshBasicMaterial({ map: tv.tex, toneMapped: false })));
      m.position.set(x, 3.6, R.z0 + 0.32);
      m.rotation.x = 0.1;
      m.name = `mead_tv_${i}`;
      this.root.add(m);
      const bez = this.box(1.85, 1.47, 0.08, k.mat("#0b0f14", 0.4, 0.5), x, 3.6, R.z0 + 0.27);
      bez.rotation.x = 0.1;
      this.screens.push({ id: m.name, mesh: m, canvas: tv.canvas, tex: tv.tex, kind: "tv", index: i, label: "Over-bar TV — tap for a paper ticket" });
    }
  }

  private buildNeon() {
    const R = HALL_ROOM;
    const n = this.kit.canvasTex(1024, 440, (c) => drawNeon(c, 1));
    const m = this.kit.own(new THREE.MeshBasicMaterial({ map: n.tex, transparent: true, toneMapped: false }));
    // Slightly smaller plane, pulled off the right wall toward the room so overview sees the full sign.
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.85, 1.22), m);
    mesh.position.set(R.x1 - 2.15, 3.45, -0.4);
    mesh.rotation.y = -Math.PI / 2 + 0.55;
    this.root.add(mesh);
    const glow = new THREE.PointLight(0xc4a35a, 5, 8, 1.6);
    glow.position.set(R.x1 - 2.6, 3.4, 0.2);
    this.root.add(glow);
    return { canvas: n.canvas, tex: n.tex, mat: m };
  }

  private buildCrowd(): Person {
    let bartender: Person | null = null;
    HALL_NPCS.forEach((n, i) => {
      const look = NPC_LOOK[n.id] ?? { shirt: MEAD.pine };
      const p = new Person(this.kit, look, [n.x, n.z], n.look, n.seated, i);
      if (n.baseY) p.baseY = n.baseY;
      this.people.push(p);
      this.add(p.root);
      if (n.role === "bartender") bartender = p;
    });
    return bartender ?? this.people[0]!;
  }

  /* ── data ── */

  private emptyState(): PredictionMarketFeedState {
    return this.state ?? { markets: [], topIds: [], featuredId: null, status: "loading", league: "nfl", fetchedAt: null, note: "Pouring the first round…" };
  }

  /** New feed state: redraw the screens; react to price moves. Presentation only. */
  setFeed(s: PredictionMarketFeedState) {
    const first = !this.state || this.state.markets.length === 0;
    this.state = s;
    this.redraw();
    // Mood from the scanner words (GO → ENTER, LIMIT → ARMED, a B setup → STALKING).
    const words = new Set(s.markets.map((m) => m.gates.word));
    this.mood = words.has("GO") ? "ENTER" : words.has("LIMIT") ? "ARMED" : s.markets.some((m) => m.setupGrade === "B") ? "STALKING" : "WAIT";
    // Price moves: the featured market counts double.
    let move = 0;
    for (const m of s.markets) {
      const prev = this.prevYes.get(m.id);
      if (prev != null && m.yesPrice != null) move += (m.yesPrice - prev) * (m.id === s.featuredId ? 2 : 1);
    }
    const go = new Set(s.markets.filter((m) => m.gates.word === "GO").map((m) => m.id));
    const newGo = [...go].some((id) => !this.prevGo.has(id));
    this.prevYes = new Map(s.markets.filter((m) => m.yesPrice != null).map((m) => [m.id, m.yesPrice as number]));
    this.prevGo = go;
    if (this.opts.crowdDriven) return;
    if (first && s.markets.length) this.react("hail");
    else if (newGo || move >= 0.04) this.react("hail");
    else if (move >= 0.006) this.react("cheer");
    else if (move <= -0.006) this.react("groan");
  }

  /** What the Ledger and the table screens add to the feed: the crowd read, the board's counts, the record. Strings and numbers the engine already made. */
  setExtras(x: HallExtras) {
    this.extra = x;
    this.redraw();
  }

  /**
   * Analyzer mode: react to the signal engine's CrowdRead for one board read (`key` = board asOf). Real velocity only — a
   * quiet/mixed read stays silent, and the same read never reacts twice.
   */
  setCrowd(crowd: CrowdRead, key: string) {
    if (key === this.crowdKey) return;
    this.crowdKey = key;
    const r = reactionForCrowd(crowd);
    if (r) this.react(r);
  }

  /** Make the crowd react (also used by the tab's preview buttons and by the Floor's talk). */
  react(kind: Reaction) {
    const t = this.time;
    const seq = this.reactSeq++;
    const lines = LINES[kind];
    const line = lines[seq % lines.length];
    const barLine = kind === "hail" ? "HAIL!" : kind === "cheer" ? "Next round's on the edge!" : "Easy — it's one price.";
    this.bartender.react(kind, t, barLine);
    const crowd = this.people.filter((p) => p !== this.bartender);
    const talker = crowd.length ? crowd[seq % crowd.length] : null;
    crowd.forEach((p, i) => p.react(kind, t, p === talker || (kind === "hail" && (i + seq) % 4 === 0) ? line : undefined, ((i * 7) % 5) * 0.07));
    this.flash = { color: kind === "groan" ? 0xef4444 : kind === "hail" ? 0xc4a35a : 0x22c55e, until: t + 1.6, kind: kind === "groan" ? "down" : "up" };
    this.opts.onReaction?.(kind, kind === "hail" ? "HAIL!" : line);
  }

  getMood(): MeadMood {
    return this.mood;
  }

  getState(): PredictionMarketFeedState {
    return this.emptyState();
  }

  private flashArg(): { kind: "up" | "down" | null; k: number } {
    const left = this.flash.until - this.time;
    return left > 0 ? { kind: this.flash.kind, k: Math.min(1, left / 1.2) } : { kind: null, k: 0 };
  }

  /** Redraw every screen from the current state. */
  redraw() {
    const s = this.emptyState();
    const mock = s.status === "mock";
    const byRank = s.markets.filter((m) => m.id !== s.featuredId);
    for (const sc of this.screens) {
      if (sc.kind === "jumbo") drawJumbotron(sc.canvas, s, this.flashArg());
      else if (sc.kind === "board") drawRuneBoard(sc.canvas, s);
      else if (sc.kind === "tv") drawTv(sc.canvas, byRank[sc.index] ?? s.markets[sc.index] ?? null, mock);
      else if (sc.kind === "booth") drawBooth(sc.canvas, s, s.markets.length ? sc.index % s.markets.length : 0);
      else continue;
      sc.tex.needsUpdate = true;
    }
    this.extras.redraw(s, this.extra);
  }

  /** Map a screen hit to a market + side, or null for a dead spot. */
  ticketFor(sc: HallScreen, uv: THREE.Vector2): { id: string; side: TicketSide } | null {
    const s = this.state;
    if (!s || !s.markets.length) return null;
    const px = uv.x * sc.canvas.width;
    const py = (1 - uv.y) * sc.canvas.height;
    if (sc.kind === "jumbo") return jumboHit(px, py, s);
    if (sc.kind === "tap") return s.featuredId ? { id: s.featuredId, side: sc.index === 0 ? "YES" : "NO" } : null;
    if (sc.kind === "tv") {
      const byRank = s.markets.filter((m) => m.id !== s.featuredId);
      const m = byRank[sc.index] ?? s.markets[sc.index];
      return m ? { id: m.id, side: "YES" } : null;
    }
    if (sc.kind === "board") {
      const i = Math.floor((py - 200) / 104);
      const id = s.topIds[i];
      return id && i >= 0 ? { id, side: "YES" } : null;
    }
    if (sc.kind === "booth") {
      const off = sc.index % s.markets.length;
      const list = [...s.markets.slice(off), ...s.markets.slice(0, off)].slice(0, 4);
      const i = Math.floor((py - 70) / 46);
      if (py > sc.canvas.height - 80) return s.featuredId ? { id: s.featuredId, side: "YES" } : null;
      const m = list[i];
      return m && i >= 0 ? { id: m.id, side: "YES" } : null;
    }
    return null;
  }

  /* ── loop ── */

  update(dt: number, _t?: number) {
    this.time += dt;
    if (this.floorHome && this.frameNo++ % 3 === 0) this.key.shadow.needsUpdate = true;
    const t = this.time;
    for (const p of this.people) p.update(dt, t);
    // Mood light breathes like the Floor's board light; a reaction flashes the room.
    const m = MOOD[this.mood];
    this.moodLight.color.lerp(new THREE.Color(m.glow), 1 - Math.exp(-2 * dt));
    const breathe = this.mood === "ENTER" ? 0.65 + 0.35 * Math.sin(t * 5) : this.mood === "ARMED" ? 0.8 + 0.2 * Math.sin(t * 2.4) : 1;
    this.moodLight.intensity = damp(this.moodLight.intensity, m.glowI * breathe, 3, dt);
    const fl = this.flash.until - t;
    this.flashLight.color.setHex(this.flash.color || 0xc4a35a);
    this.flashLight.intensity = damp(this.flashLight.intensity, fl > 0 ? 14 * (0.6 + 0.4 * Math.sin(t * 18)) : 0, 10, dt);
    for (const [i, l] of this.lanterns.entries()) l.intensity = 5.4 + 0.6 * Math.sin(t * 7 + i * 1.7) * Math.sin(t * 3.1 + i);
    // Jumbotron flash pulse + neon flicker.
    if (fl > -0.2 && t - this.lastJumboDraw > 0.08) {
      this.lastJumboDraw = t;
      const j = this.screens.find((s) => s.kind === "jumbo");
      if (j) {
        drawJumbotron(j.canvas, this.emptyState(), this.flashArg());
        j.tex.needsUpdate = true;
      }
    }
    const flick = Math.sin(t * 0.7) > 0.985 ? 0.35 : 1;
    if ((this.neon.mat.opacity < 1) !== (flick < 1)) {
      this.neon.mat.opacity = flick;
      drawNeon(this.neon.canvas, flick);
      this.neon.tex.needsUpdate = true;
    }
    this.extras.update(dt, t);
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const p of this.people) p.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
    this.kit.dispose();
  }
}
