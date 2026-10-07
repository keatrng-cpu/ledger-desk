/**
 * The Mead Hall — a pine/iron/brass sports bar for prediction markets.
 *
 * Procedural three.js (no GLB): longship-carved bar with dragon prows, a
 * field runner to the jumbotron, booths with table screens, a pool
 * table, a Rune Board chalkboard, over-bar TVs and a neon sign. Original
 * Norse art only — no team or league marks.
 *
 * Interaction follows the Floor (floor-scene.ts): the canvas takes the wheel
 * and WASD only after a click into it; Esc or a click outside lets go, so the
 * page never has its scroll hijacked. Owner (Keaton) is the Floor's own
 * OwnerAvatar, walked with WASD while focused.
 *
 * PAPER ONLY. A tap on YES / NO (jumbotron boxes, bar tap handles, a TV, a
 * booth screen, a Rune Board row) calls `onTicket` — the tab opens a paper
 * ticket that writes the predict journal. Nothing here can reach a broker.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PredictionMarket, PredictionMarketFeedState } from "@/lib/predict/prediction-market-feed";
import type { CrowdRead } from "@/lib/predict/signal-engine";
import { reactionForCrowd } from "./mead-signal-feed";
import { OwnerAvatar } from "@/components/room/floor-proto-avatars";
import {
  MEAD,
  JUMBO_H,
  JUMBO_W,
  drawBooth,
  drawBubble,
  drawJumbotron,
  drawKnotPanel,
  drawNeon,
  drawRunner,
  drawRuneBoard,
  drawTapShield,
  drawTv,
  jumboHit,
} from "./mead-screens";

export type Reaction = "cheer" | "groan" | "hail";
/** The desk's entry-state words, reused as the hall's mood (lighting only). */
export type MeadMood = "WAIT" | "STALKING" | "ARMED" | "ENTER";
export type TicketSide = "YES" | "NO";

export interface MeadSceneOptions {
  onFocusChange?: (focused: boolean) => void;
  onScrollHint?: () => void;
  onHover?: (label: string | null) => void;
  /** A YES/NO tap — open a PAPER ticket for this market. */
  onTicket?: (marketId: string, side: TicketSide) => void;
  /** The crowd reacted (the tab flashes the edge the same colour). */
  onReaction?: (r: Reaction, line: string) => void;
  /**
   * PM analyzer mode: the crowd reacts ONLY to the signal engine's CrowdRead
   * (real price velocity from Kalshi trades) via `setCrowd` — setFeed never
   * triggers a reaction (no first-load hail, no poll-to-poll diff).
   */
  crowdDriven?: boolean;
}

type V2 = [number, number];
type Box = [number, number, number, number]; // x0, z0, x1, z1

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

const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

function mat(hex: string | number, rough = 0.7, metal = 0.05, emissive?: number, ei = 0) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: rough, metalness: metal });
  if (emissive != null) {
    m.emissive = new THREE.Color(emissive);
    m.emissiveIntensity = ei;
  }
  return m;
}

function canvasTex(w: number, h: number, draw: (c: HTMLCanvasElement) => void): { tex: THREE.CanvasTexture; canvas: HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, canvas };
}

function woodCanvas(c: HTMLCanvasElement, base = "#5a3a1e", dark = "#3e2612") {
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, c.width, c.height);
  const plank = c.height / 8;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.03)";
    ctx.fillRect(0, i * plank, c.width, plank);
    ctx.fillStyle = dark;
    ctx.fillRect(0, i * plank, c.width, 2);
    const off = ((i * 137) % c.width) | 0;
    ctx.fillRect(off, i * plank, 2, plank);
    ctx.globalAlpha = 0.12;
    for (let k = 0; k < 12; k++) {
      ctx.fillRect(0, i * plank + ((k * 7) % plank), c.width, 1);
    }
    ctx.globalAlpha = 1;
  }
}

/* ── People ─────────────────────────────────────────────────────────────── */

interface PersonLook {
  shirt: string;
  skin?: string;
  pants?: string;
  helmet?: boolean;
  beard?: string;
  hair?: string;
}

class Person {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly bubble: { sprite: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture };
  private reaction: { kind: Reaction; t0: number; dur: number } | null = null;
  private bubbleUntil = 0;
  private readonly phase = Math.random() * 10;
  readonly seated: boolean;
  readonly height: number;
  /** Raised off the floor (a bar stool). */
  baseY = 0;

  constructor(look: PersonLook, pos: V2, faceTo: V2, seated: boolean) {
    this.seated = seated;
    const skin = mat(look.skin ?? "#e2b48c", 0.6);
    const shirt = mat(look.shirt, 0.75);
    const pants = mat(look.pants ?? "#1a3329", 0.8);
    const capsule = (r: number, l: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 10), m);
      mesh.castShadow = true;
      return mesh;
    };
    const hipY = seated ? 0.5 : 0.92;
    this.height = seated ? 1.3 : 1.75;
    this.root.add(this.body);
    this.body.position.y = hipY;
    // legs
    for (const side of [-1, 1]) {
      if (seated) {
        const thigh = capsule(0.075, 0.32, pants);
        thigh.rotation.x = Math.PI / 2;
        thigh.position.set(side * 0.1, 0, 0.2);
        this.body.add(thigh);
        const shin = capsule(0.065, 0.32, pants);
        shin.position.set(side * 0.1, -0.25, 0.4);
        this.body.add(shin);
      } else {
        const leg = capsule(0.075, 0.7, pants);
        leg.position.set(side * 0.1, -0.45, 0);
        this.body.add(leg);
      }
    }
    const torso = capsule(0.19, 0.36, shirt);
    torso.position.y = 0.32;
    torso.scale.set(1, 1, 0.75);
    this.body.add(torso);
    // brass collar trim
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 16), mat(MEAD.brass, 0.4, 0.4));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.62;
    this.body.add(collar);
    this.head.position.y = 0.78;
    this.body.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 18, 14), skin);
    skull.castShadow = true;
    this.head.add(skull);
    for (const x of [-0.05, 0.05]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), mat("#111"));
      eye.position.set(x, 0.02, 0.13);
      this.head.add(eye);
    }
    if (look.hair) {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.148, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(look.hair, 0.9));
      hair.position.y = 0.01;
      this.head.add(hair);
    }
    if (look.beard) {
      const beard = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.28, 10), mat(look.beard, 0.9));
      beard.rotation.x = Math.PI;
      beard.position.set(0, -0.14, 0.06);
      this.head.add(beard);
    }
    if (look.helmet) {
      // Nasal/spectacle iron helm — no cartoon white/gold curved horns.
      const steel = mat("#8a9099", 0.35, 0.75);
      const iron = mat(MEAD.iron, 0.4, 0.7);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel);
      dome.position.y = 0.02;
      this.head.add(dome);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.018, 6, 20), iron);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.03;
      this.head.add(band);
      // Spectacle brow (two eye rings joined)
      for (const side of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 16), iron);
        ring.position.set(side * 0.055, 0.0, 0.12);
        this.head.add(ring);
      }
      // Nasal guard
      const nasal = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.025), steel);
      nasal.position.set(0, -0.04, 0.14);
      this.head.add(nasal);
    }
    const arm = (g: THREE.Group, side: number) => {
      g.position.set(side * 0.25, 0.56, 0);
      this.body.add(g);
      const upper = capsule(0.055, 0.28, shirt);
      upper.position.y = -0.2;
      g.add(upper);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skin);
      hand.position.y = -0.44;
      g.add(hand);
    };
    arm(this.armL, 1);
    arm(this.armR, -1);
    const bt = canvasTex(512, 200, () => undefined);
    const sm = new THREE.SpriteMaterial({ map: bt.tex, transparent: true, depthTest: false, opacity: 0 });
    this.bubble = { ...bt, sprite: new THREE.Sprite(sm) };
    this.bubble.sprite.scale.set(1.4, 0.55, 1);
    this.bubble.sprite.position.y = this.height + 0.55;
    this.bubble.sprite.renderOrder = 20;
    this.root.add(this.bubble.sprite);
    this.root.position.set(pos[0], 0, pos[1]);
    this.root.rotation.y = Math.atan2(faceTo[0] - pos[0], faceTo[1] - pos[1]);
    this.root.traverse((o) => (o.userData.person = true));
  }

  react(kind: Reaction, t: number, line?: string, stagger = 0) {
    this.reaction = { kind, t0: t + stagger, dur: kind === "hail" ? 3.2 : 2.4 };
    if (line) this.say(line, kind === "hail" ? "hail" : kind === "cheer" ? "up" : "down", t, 3);
  }

  say(text: string, tone: "up" | "down" | "hail" | "idle", t: number, sec: number) {
    drawBubble(this.bubble.canvas, text, tone);
    this.bubble.tex.needsUpdate = true;
    this.bubbleUntil = t + sec;
  }

  update(dt: number, t: number) {
    const r = this.reaction;
    let armL = 0.12;
    let armR = -0.12;
    let armX = 0;
    let lift = 0;
    let nod = 0.04 * Math.sin(t * 1.2 + this.phase);
    if (r && t >= r.t0) {
      const u = (t - r.t0) / r.dur;
      if (u > 1) this.reaction = null;
      else if (r.kind === "cheer") {
        armL = 2.7;
        armR = -2.7;
        lift = this.seated ? 0.05 * Math.abs(Math.sin(t * 9)) : 0.14 * Math.abs(Math.sin(t * 8));
        nod = -0.15;
      } else if (r.kind === "groan") {
        armL = 2.3;
        armR = -2.3;
        armX = -0.9;
        nod = 0.45;
      } else {
        const beat = Math.sin((t - r.t0) * 5.2);
        armL = 2.9 - 0.25 * beat;
        armR = -2.9 + 0.25 * beat;
        lift = this.seated ? 0.04 * Math.max(0, beat) : 0.1 * Math.max(0, beat);
        nod = -0.2;
      }
    }
    this.armL.rotation.z = damp(this.armL.rotation.z, armL, 10, dt);
    this.armR.rotation.z = damp(this.armR.rotation.z, armR, 10, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, armX, 10, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, armX, 10, dt);
    this.head.rotation.x = damp(this.head.rotation.x, nod, 8, dt);
    this.root.position.y = damp(this.root.position.y, this.baseY + lift, 14, dt);
    const m = this.bubble.sprite.material as THREE.SpriteMaterial;
    m.opacity = damp(m.opacity, t < this.bubbleUntil ? 1 : 0, 8, dt);
  }

  dispose() {
    this.bubble.tex.dispose();
  }
}

/* ── The scene ──────────────────────────────────────────────────────────── */

interface Screen {
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  kind: "jumbo" | "board" | "tv" | "booth" | "tap";
  index: number;
  label: string;
}

/** Room bounds: x −9…9, z −7…7 (open toward the camera). */
const ROOM = { x0: -9, x1: 9, z0: -7, z1: 7, h: 7 } as const;
/** Things the Owner cannot walk through. */
const BLOCKS: Box[] = [
  [1.6, -7, 9, -2.55], // bar + behind the bar
  [2.5, -2.55, 8.3, -1.9], // stools
  [-9, -3.7, -5.6, -1.3], // booth A
  [-9, -0.3, -5.6, 2.1], // booth B
  [-7.2, 3.3, -3.8, 5.3], // pool table
  [-9, -7, -5.2, -5.6], // rune-board corner
];

export class MeadScene {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly opts: MeadSceneOptions;
  private readonly screens: Screen[] = [];
  private readonly people: Person[] = [];
  private readonly bartender: Person;
  private readonly owner: OwnerAvatar;
  private readonly moodLight: THREE.PointLight;
  private readonly flashLight: THREE.PointLight;
  private readonly neon: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial };
  private readonly lanterns: THREE.PointLight[] = [];
  private mood: MeadMood = "WAIT";
  private state: PredictionMarketFeedState | null = null;
  private prevYes = new Map<string, number>();
  private prevGo = new Set<string>();
  /** Board asOf of the last CrowdRead acted on (one reaction per real read). */
  private crowdKey: string | null = null;
  /** Rotates speech lines / talkers deterministically (no Math.random in reactions). */
  private reactSeq = 0;
  private flash: { color: number; until: number; kind: "up" | "down" | null } = { color: 0, until: 0, kind: null };
  private focused = false;
  private readonly keys = { w: false, a: false, s: false, d: false };
  private ownerChaseHead: THREE.Vector3 | null = null;
  private downAt: { x: number; y: number } | null = null;
  private hoverAt = 0;
  private hoverLabel: string | null = null;
  private raf = 0;
  private visible = true;
  private disposed = false;
  private resizeObs: ResizeObserver | null = null;
  private interObs: IntersectionObserver | null = null;
  private time = 0;
  private lastJumboDraw = 0;
  private camGoal: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(container: HTMLElement, opts: MeadSceneOptions = {}) {
    this.container = container;
    this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    const mobile = window.matchMedia?.("(max-width: 640px)").matches ?? false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "pan-y";

    this.scene.background = new THREE.Color(MEAD.pineInk);
    this.scene.fog = new THREE.Fog(MEAD.pineInk, 22, 40);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);
    this.camera.position.set(0.6, 5.4, 12.6);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0.2, 2.1, -3);
    this.controls.enableDamping = true;
    // No scroll hijack: zoom only while focused (click) or with Ctrl/⌘ — Floor's rule.
    this.controls.enableZoom = false;
    this.controls.maxPolarAngle = 1.45;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 26;
    this.controls.addEventListener("start", () => (this.camGoal = null));

    // Light: warm lanterns in a pine room.
    this.scene.add(new THREE.HemisphereLight(0xc8ddd4, 0x2a1a10, 0.55));
    const key = new THREE.DirectionalLight(0xffe6c0, 0.9);
    key.position.set(4, 12, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    Object.assign(key.shadow.camera, { left: -12, right: 12, top: 10, bottom: -10, near: 1, far: 40 });
    key.shadow.bias = -0.0005;
    key.shadow.camera.updateProjectionMatrix();
    this.scene.add(key);
    this.moodLight = new THREE.PointLight(MOOD.WAIT.glow, MOOD.WAIT.glowI, 14, 1.4);
    this.moodLight.position.set(-1.8, 3.2, -5.2);
    this.scene.add(this.moodLight);
    this.flashLight = new THREE.PointLight(0xc4a35a, 0, 22, 1.2);
    this.flashLight.position.set(0, 4.2, 0);
    this.scene.add(this.flashLight);

    this.buildRoom();
    this.buildBar();
    this.buildBooths();
    this.buildPoolTable();
    this.buildScreens();
    this.neon = this.buildNeon();
    this.bartender = this.buildCrowd();

    this.owner = new OwnerAvatar([-1.8, 5.2], [-1.8, -4]);
    this.retag(this.owner.tag, "Keaton", "Owner · Mead Hall");
    this.scene.add(this.owner.root);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.interObs = new IntersectionObserver((e) => (this.visible = e.some((x) => x.isIntersecting)));
    this.interObs.observe(container);
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerleave", this.onLeave);
    el.addEventListener("wheel", this.onWheelCapture, { capture: true, passive: true });
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("pointerdown", this.onDocDown, true);
    this.resize();
    this.loop();
    if (import.meta.env.DEV) (window as unknown as { __mead?: MeadScene }).__mead = this;
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
    this.scene.add(o);
    return o;
  }

  private box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    return this.add(mesh);
  }

  private buildRoom() {
    const W = ROOM.x1 - ROOM.x0;
    const D = ROOM.z1 - ROOM.z0;
    // Floor: wood planks.
    const floor = canvasTex(1024, 1024, (c) => woodCanvas(c, "#4a2e17", "#2b1a0b"));
    floor.tex.wrapS = floor.tex.wrapT = THREE.RepeatWrapping;
    floor.tex.repeat.set(4, 4);
    this.disposables.push(floor.tex);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floor.tex, roughness: 0.85 }));
    fl.rotation.x = -Math.PI / 2;
    fl.receiveShadow = true;
    this.scene.add(fl);
    // Walls: pine with brass trim, wainscot wood below.
    const pine = mat(MEAD.pine, 0.9);
    const brass = mat(MEAD.brass, 0.35, 0.6, 0x5a3b00, 0.25);
    const wood = mat("#3b2411", 0.8);
    const back = this.box(W, ROOM.h, 0.2, pine, 0, ROOM.h / 2, ROOM.z0 - 0.1);
    back.castShadow = false;
    for (const sx of [-1, 1]) {
      const side = this.box(0.2, ROOM.h, D, pine, sx * (ROOM.x1 + 0.1), ROOM.h / 2, 0);
      side.castShadow = false;
    }
    // Wainscot + trim lines.
    this.box(W, 1.0, 0.06, wood, 0, 0.5, ROOM.z0 + 0.03);
    this.box(W, 0.07, 0.1, brass, 0, 1.04, ROOM.z0 + 0.05);
    this.box(W, 0.12, 0.1, brass, 0, ROOM.h - 0.25, ROOM.z0 + 0.05);
    for (const sx of [-1, 1]) {
      this.box(0.06, 1.0, D, wood, sx * (ROOM.x1 - 0.03), 0.5, 0);
      this.box(0.1, 0.07, D, brass, sx * (ROOM.x1 - 0.05), 1.04, 0);
      this.box(0.1, 0.12, D, brass, sx * (ROOM.x1 - 0.05), ROOM.h - 0.25, 0);
    }
    // Knotwork frieze above the screens.
    const frieze = canvasTex(2048, 128, (c) => drawKnotPanel(c, MEAD.pineDeep));
    this.disposables.push(frieze.tex);
    const fz = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.9), new THREE.MeshStandardMaterial({ map: frieze.tex, roughness: 0.8 }));
    fz.position.set(0, 5.35, ROOM.z0 + 0.04);
    this.scene.add(fz);
    this.box(W, 0.07, 0.1, brass, 0, 4.85, ROOM.z0 + 0.05);
    this.box(W, 0.07, 0.1, brass, 0, 5.85, ROOM.z0 + 0.05);
    // Ceiling beams (dark timber, brass knot caps) — no ceiling plane so the camera sees in.
    for (let z = -6; z <= 6; z += 3) {
      this.box(W, 0.32, 0.3, wood, 0, ROOM.h - 0.1, z);
    }
    // Timber posts with brass knot panels on the side walls.
    for (const sx of [-1, 1]) {
      for (const z of [-6.6, -1.5, 3.6]) this.box(0.34, ROOM.h, 0.34, wood, sx * (ROOM.x1 - 0.2), ROOM.h / 2, z);
    }
    const panel = canvasTex(256, 512, (c) => drawKnotPanel(c, MEAD.pineDeep));
    this.disposables.push(panel.tex);
    const banner = new THREE.MeshStandardMaterial({ map: panel.tex, roughness: 0.8 });
    for (const z of [-4.1, 1.0]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), banner);
      b.position.set(ROOM.x0 + 0.06, 2.6, z);
      b.rotation.y = Math.PI / 2;
      this.scene.add(b);
    }
    // Shields on the back wall between screens.
    const shieldTex = canvasTex(256, 256, (c) => {
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = MEAD.pine;
      ctx.beginPath();
      ctx.arc(128, 128, 124, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 14;
      ctx.strokeStyle = MEAD.brass;
      ctx.stroke();
      ctx.fillStyle = MEAD.brass;
      for (let k = 0; k < 8; k++) {
        ctx.save();
        ctx.translate(128, 128);
        ctx.rotate((k / 8) * Math.PI * 2);
        ctx.fillRect(-6, -118, 12, 118);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(128, 128, 30, 0, Math.PI * 2);
      ctx.fillStyle = "#c0c0c0";
      ctx.fill();
    });
    this.disposables.push(shieldTex.tex);
    const shieldMat = new THREE.MeshStandardMaterial({ map: shieldTex.tex, roughness: 0.5, metalness: 0.3 });
    for (const [x, y] of [
      [-8.2, 1.6],
      [-4.2, 1.6],
      [0.8, 1.6],
      [ROOM.x1 - 0.35, 2.4],
    ] as V2[]) {
      const s = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), shieldMat);
      s.position.set(x, y, ROOM.z0 + 0.08);
      if (x > 8) {
        s.position.set(ROOM.x1 - 0.08, y, 3.2);
        s.rotation.y = -Math.PI / 2;
      }
      this.scene.add(s);
    }
    // Football-field runner from the front to the jumbotron.
    const runner = canvasTex(512, 2048, drawRunner);
    this.disposables.push(runner.tex);
    const rn = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 12.6), new THREE.MeshStandardMaterial({ map: runner.tex, roughness: 0.95 }));
    rn.rotation.x = -Math.PI / 2;
    rn.position.set(-1.8, 0.012, 0.4);
    rn.receiveShadow = true;
    this.scene.add(rn);
    // Hanging lanterns.
    const lantern = (x: number, y: number, z: number) => {
      const g = new THREE.Group();
      const frame = mat("#2b1a0b", 0.6, 0.4);
      const glass = mat("#ffcf7a", 0.3, 0, 0xffa53a, 2.2);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.34, 6), glass);
      g.add(body);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.16, 6), frame);
      cap.position.y = 0.25;
      g.add(cap);
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, ROOM.h - y), frame);
      chain.position.y = (ROOM.h - y) / 2 + 0.3;
      g.add(chain);
      g.position.set(x, y, z);
      this.scene.add(g);
      const light = new THREE.PointLight(0xffb45a, 6, 9, 1.6);
      light.position.set(x, y - 0.1, z);
      this.scene.add(light);
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
    const g = new THREE.Group();
    const hullTex = canvasTex(1024, 256, (c) => woodCanvas(c, "#6b4423", "#3a2210"));
    this.disposables.push(hullTex.tex);
    const hull = new THREE.MeshStandardMaterial({ map: hullTex.tex, roughness: 0.75 });
    const dark = mat("#3a2210", 0.7);
    const brass = mat(MEAD.brass, 0.35, 0.6, 0x4a3000, 0.2);
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
    const band = canvasTex(1024, 96, (c) => drawKnotPanel(c, MEAD.pine));
    this.disposables.push(band.tex);
    const bandMesh = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.4, 0.26), new THREE.MeshStandardMaterial({ map: band.tex, roughness: 0.6 }));
    bandMesh.position.set(cx, 0.82, z + 0.47);
    g.add(bandMesh);
    // Round shields along the hull.
    for (let i = 0; i < 6; i++) {
      const sx = x0 + 0.5 + (i * (L - 1)) / 5;
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 24), i % 2 ? mat(MEAD.pine, 0.6) : mat(MEAD.white, 0.6));
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
      // Brass spine fins.
      for (let k = 1; k < 8; k++) {
        const p = curve.getPoint(k / 8);
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), brass);
        fin.position.copy(p).add(new THREE.Vector3(side * 0.12, 0.05, 0));
        fin.rotation.z = -side * 0.8;
        g.add(fin);
      }
      const headG = new THREE.Group();
      const skull = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.26), hull);
      headG.add(skull);
      const snout = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 6), hull);
      snout.rotation.z = Math.PI / 2 * side * -1;
      snout.position.x = -side * 0.34;
      headG.add(snout);
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.2), dark);
      jaw.position.set(-side * 0.12, -0.14, 0);
      jaw.rotation.z = side * 0.25;
      headG.add(jaw);
      for (const ez of [-0.13, 0.13]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mat(MEAD.brass, 0.2, 0.2, 0xc4a35a, 2));
        eye.position.set(-side * 0.06, 0.06, ez);
        headG.add(eye);
      }
      headG.position.copy(pts[4]).add(new THREE.Vector3(-side * 0.15, 0, 0));
      g.add(headG);
    }
    // Back shelf with bottles + mugs.
    const shelfZ = ROOM.z0 + 0.35;
    for (const y of [1.2, 1.75, 2.3]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.06, 0.45), dark);
      s.position.set(cx, y, shelfZ);
      g.add(s);
      for (let i = 0; i < 18; i++) {
        const bx = x0 + 0.1 + i * 0.36;
        const col = ["#14532d", "#7c2d12", "#a16207", "#1e3a8a", "#1a3c2e"][(i * 7 + Math.round(y * 10)) % 5];
        const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.32, 8), mat(col, 0.15, 0.1, new THREE.Color(col).getHex(), 0.25));
        bottle.position.set(bx, y + 0.19, shelfZ + ((i % 2) * 0.1 - 0.05));
        g.add(bottle);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.12, 6), bottle.material);
        neck.position.set(bx, y + 0.41, bottle.position.z);
        g.add(neck);
      }
    }
    // Back counter under the shelves.
    const counter = new THREE.Mesh(new THREE.BoxGeometry(6.6, 1.0, 0.7), hull);
    counter.position.set(cx, 0.5, ROOM.z0 + 0.4);
    g.add(counter);
    // Mugs on the bar.
    for (const [mx, mz] of [
      [4.6, -3.0],
      [5.9, -2.95],
      [7.3, -3.05],
    ] as V2[]) {
      const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.17, 12), mat("#7c5a32", 0.6));
      mug.position.set(mx, 1.29, mz);
      g.add(mug);
      const foam = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.03, 12), mat(MEAD.white, 0.9));
      foam.position.set(mx, 1.39, mz);
      g.add(foam);
    }
    // Stools.
    for (let i = 0; i < 5; i++) {
      const sx = 3.0 + i * 1.2;
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.12, 18), mat(MEAD.pine, 0.6));
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
      const chrome = mat("#d1d5db", 0.2, 0.9);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.32, 10), chrome);
      base.position.set(tx, 1.36, z);
      g.add(base);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.42, 8), mat("#1f1305", 0.5));
      handle.position.set(tx, 1.72, z);
      g.add(handle);
      const shield = canvasTex(256, 300, (c) => drawTapShield(c, label));
      this.disposables.push(shield.tex);
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.5), new THREE.MeshStandardMaterial({ map: shield.tex, transparent: true, roughness: 0.4, emissive: new THREE.Color(0xffffff), emissiveMap: shield.tex, emissiveIntensity: 0.35 }));
      sm.position.set(tx, 2.05, z + 0.03);
      g.add(sm);
      this.screens.push({ mesh: sm, canvas: shield.canvas, tex: shield.tex, kind: "tap", index: i, label: `${label} tap — paper ticket on the featured market` });
    }
    this.add(g);
  }

  private buildBooths() {
    const wood = mat("#3b2411", 0.75);
    const uph = mat(MEAD.pine, 0.85);
    const brass = mat(MEAD.brass, 0.35, 0.6);
    const panel = canvasTex(256, 192, (c) => drawKnotPanel(c, MEAD.pine));
    this.disposables.push(panel.tex);
    const panelMat = new THREE.MeshStandardMaterial({ map: panel.tex, roughness: 0.8 });
    const booth = (cz: number, index: number) => {
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
      const screen = canvasTex(512, 384, (c) => drawBooth(c, this.emptyState(), index));
      this.disposables.push(screen.tex);
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), new THREE.MeshBasicMaterial({ map: screen.tex, toneMapped: false }));
      sm.position.set(-6.8, 1.15, cz);
      sm.rotation.y = Math.PI / 2 - 0.35;
      sm.rotation.x = -0.12;
      g.add(sm);
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.06), mat("#111827", 0.4, 0.5));
      stand.position.set(-6.86, 0.96, cz);
      g.add(stand);
      const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.66, 0.86), mat("#0b0f14", 0.4, 0.5));
      bezel.position.set(-6.82, 1.15, cz);
      bezel.rotation.copy(sm.rotation);
      bezel.rotation.y -= Math.PI / 2;
      g.add(bezel);
      this.screens.push({ mesh: sm, canvas: screen.canvas, tex: screen.tex, kind: "booth", index, label: "Booth market watch — tap a row for a paper ticket" });
      this.add(g);
    };
    booth(-2.5, 0);
    booth(0.9, 2);
  }

  private buildPoolTable() {
    const g = new THREE.Group();
    const wood = mat("#4a2a12", 0.6);
    const felt = mat(MEAD.pine, 0.95);
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
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), mat(c, 0.2, 0.1));
      b.position.set(cx - 0.6 + (i % 4) * 0.35 + (i > 3 ? 0.2 : 0), 0.965, cz - 0.3 + Math.floor(i / 4) * 0.45);
      g.add(b);
    });
    const cue = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 1.4, 8), mat("#d6b88a", 0.5));
    cue.rotation.z = Math.PI / 2 - 0.15;
    cue.position.set(cx + 0.8, 1.05, cz + 0.2);
    g.add(cue);
    // A low lamp over the felt.
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.28, 16, 1, true), mat("#1f1305", 0.5, 0.3, 0x1a3c2e, 0.2));
    shade.position.set(cx, 2.6, cz);
    g.add(shade);
    const l = new THREE.PointLight(0xfff0c8, 5, 5, 1.6);
    l.position.set(cx, 2.4, cz);
    g.add(l);
    this.add(g);
  }

  private buildScreens() {
    // Jumbotron on the back wall, at the end of the runner.
    const jw = 5.8;
    const jh = (jw * JUMBO_H) / JUMBO_W;
    const j = canvasTex(JUMBO_W, JUMBO_H, (c) => drawJumbotron(c, this.emptyState()));
    this.disposables.push(j.tex);
    const jm = new THREE.Mesh(new THREE.PlaneGeometry(jw, jh), new THREE.MeshBasicMaterial({ map: j.tex, toneMapped: false }));
    jm.position.set(-1.8, 3.05, ROOM.z0 + 0.2);
    this.scene.add(jm);
    this.box(jw + 0.3, jh + 0.3, 0.16, mat("#0a1610", 0.5, 0.4), -1.8, 3.05, ROOM.z0 + 0.1);
    this.box(jw + 0.42, 0.08, 0.2, mat(MEAD.brass, 0.35, 0.6), -1.8, 3.05 + jh / 2 + 0.17, ROOM.z0 + 0.12);
    this.box(jw + 0.42, 0.08, 0.2, mat(MEAD.brass, 0.35, 0.6), -1.8, 3.05 - jh / 2 - 0.17, ROOM.z0 + 0.12);
    this.screens.push({ mesh: jm, canvas: j.canvas, tex: j.tex, kind: "jumbo", index: 0, label: "Jumbotron — tap YES / NO for a paper ticket" });

    // Rune Board chalkboard on the back-left wall, angled toward the room.
    const s = canvasTex(768, 1024, (c) => drawRuneBoard(c, this.emptyState()));
    this.disposables.push(s.tex);
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 3.07), new THREE.MeshStandardMaterial({ map: s.tex, roughness: 0.9, emissive: new THREE.Color(0xffffff), emissiveMap: s.tex, emissiveIntensity: 0.32 }));
    sm.position.set(-7.0, 2.65, ROOM.z0 + 0.6);
    sm.rotation.y = 0.45;
    this.scene.add(sm);
    const frame = this.box(2.5, 3.27, 0.1, mat("#3b2411", 0.7), -7.0, 2.65, ROOM.z0 + 0.55, 0.45);
    frame.position.x -= Math.sin(0.45) * 0.05;
    this.screens.push({ mesh: sm, canvas: s.canvas, tex: s.tex, kind: "board", index: 0, label: "Rune Board — tap a setup for a paper ticket" });

    // Three over-bar TVs.
    for (let i = 0; i < 3; i++) {
      const tv = canvasTex(512, 400, (c) => drawTv(c, null, false));
      this.disposables.push(tv.tex);
      const x = 3.35 + i * 2.0;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 1.37), new THREE.MeshBasicMaterial({ map: tv.tex, toneMapped: false }));
      m.position.set(x, 3.6, ROOM.z0 + 0.32);
      m.rotation.x = 0.1;
      this.scene.add(m);
      const bez = this.box(1.85, 1.47, 0.08, mat("#0b0f14", 0.4, 0.5), x, 3.6, ROOM.z0 + 0.27);
      bez.rotation.x = 0.1;
      this.screens.push({ mesh: m, canvas: tv.canvas, tex: tv.tex, kind: "tv", index: i, label: "Over-bar TV — tap for a paper ticket" });
    }
  }

  private buildNeon() {
    const n = canvasTex(1024, 440, (c) => drawNeon(c, 1));
    this.disposables.push(n.tex);
    const m = new THREE.MeshBasicMaterial({ map: n.tex, transparent: true, toneMapped: false });
    // Slightly smaller plane, pulled off the right wall toward the room so overview sees the full sign.
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.85, 1.22), m);
    mesh.position.set(ROOM.x1 - 2.15, 3.45, -0.4);
    mesh.rotation.y = -Math.PI / 2 + 0.55;
    this.scene.add(mesh);
    const glow = new THREE.PointLight(0xc4a35a, 5, 8, 1.6);
    glow.position.set(ROOM.x1 - 2.6, 3.4, 0.2);
    this.scene.add(glow);
    return { canvas: n.canvas, tex: n.tex, mat: m };
  }

  private buildCrowd(): Person {
    const add = (p: Person) => {
      this.people.push(p);
      this.add(p.root);
      return p;
    };
    // Bartender: nasal iron helm, behind the bar.
    const bartender = add(new Person({ shirt: "#3b2411", helmet: true, beard: "#c2772b", skin: "#e0a77f" }, [5.2, -4.25], [5.2, 0], false));
    // Booth A + B.
    add(new Person({ shirt: MEAD.pine, helmet: true, beard: "#8b5a2b" }, [-7.4, -3.4], [-7.4, -2.5], true));
    add(new Person({ shirt: MEAD.pine, hair: "#2b1a0b", skin: "#c68a5e" }, [-7.4, -1.6], [-7.4, -2.5], true));
    add(new Person({ shirt: MEAD.white, hair: "#d4a017" }, [-7.4, 0.0], [-7.4, 0.9], true));
    add(new Person({ shirt: MEAD.pine, hair: "#111" , skin: "#8d5a3b" }, [-7.4, 1.8], [-7.4, 0.9], true));
    // Bar stools (facing the bar).
    for (const [x, look] of [
      [3.0, { shirt: MEAD.pine, hair: "#3b2411" }],
      [5.4, { shirt: MEAD.brass, helmet: true, beard: "#5b3a1e" }],
      [7.8, { shirt: MEAD.pine, hair: "#111", skin: "#a8714a" }],
    ] as [number, PersonLook][]) {
      const p = add(new Person(look, [x, -2.05], [x, -4], true));
      p.baseY = 0.32;
    }
    // Standing fans on the runner + at the pool table.
    add(new Person({ shirt: MEAD.pine, hair: "#5b3a1e" }, [-0.4, 2.2], [-1.8, -6], false));
    add(new Person({ shirt: MEAD.white, helmet: true, beard: "#d4a017" }, [-3.2, 1.4], [-1.8, -6], false));
    add(new Person({ shirt: MEAD.brass, hair: "#111", skin: "#8d5a3b" }, [-3.9, 4.4], [-5.5, 4.3], false));
    add(new Person({ shirt: MEAD.pine, hair: "#c2772b" }, [1.4, 0.4], [-1.8, -6], false));
    return bartender;
  }

  private retag(tag: THREE.Sprite, title: string, sub: string) {
    const t = canvasTex(384, 84, (c) => {
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "rgba(10,22,16,0.9)";
      ctx.beginPath();
      ctx.roundRect(4, 4, 376, 76, 18);
      ctx.fill();
      ctx.fillStyle = MEAD.brass;
      ctx.fillRect(4, 4, 12, 76);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "800 32px Inter, system-ui, sans-serif";
      ctx.fillText(title.toUpperCase(), 30, 40);
      ctx.fillStyle = "#a7c4b5";
      ctx.font = "600 22px Inter, system-ui, sans-serif";
      ctx.fillText(sub, 30, 68);
    });
    this.disposables.push(t.tex);
    const m = tag.material as THREE.SpriteMaterial;
    m.map?.dispose();
    m.map = t.tex;
    m.needsUpdate = true;
  }

  private emptyState(): PredictionMarketFeedState {
    return this.state ?? { markets: [], topIds: [], featuredId: null, status: "loading", league: "nfl", fetchedAt: null, note: "Pouring the first round…" };
  }

  /* ── data ── */

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

  private redraw() {
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
  }

  private flashArg(): { kind: "up" | "down" | null; k: number } {
    const left = this.flash.until - this.time;
    return left > 0 ? { kind: this.flash.kind, k: Math.min(1, left / 1.2) } : { kind: null, k: 0 };
  }

  /**
   * Analyzer mode: react to the signal engine's CrowdRead for one board read
   * (`key` = board asOf). Real velocity only — a quiet/mixed read stays silent,
   * and the same read never reacts twice.
   */
  setCrowd(crowd: CrowdRead, key: string) {
    if (key === this.crowdKey) return;
    this.crowdKey = key;
    const r = reactionForCrowd(crowd);
    if (r) this.react(r);
  }

  /** Make the crowd react (also used by the tab's preview buttons). */
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

  /* ── interaction ── */

  private rayAt(e: { clientX: number; clientY: number }): THREE.Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray;
  }

  private screenHit(e: { clientX: number; clientY: number }): { sc: Screen; uv: THREE.Vector2 } | null {
    const hits = this.rayAt(e).intersectObjects(this.screens.map((s) => s.mesh), false);
    const h = hits[0];
    if (!h || !h.uv) return null;
    const sc = this.screens.find((s) => s.mesh === h.object);
    return sc ? { sc, uv: h.uv } : null;
  }

  /** Map a screen hit to a market + side, or null for a dead spot. */
  private ticketFor(sc: Screen, uv: THREE.Vector2): { id: string; side: TicketSide } | null {
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

  private onDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY };
  };

  private onUp = (e: PointerEvent) => {
    if (!this.downAt || Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 6) return;
    const hit = this.screenHit(e);
    if (!hit) return;
    const t = this.ticketFor(hit.sc, hit.uv);
    if (t) this.opts.onTicket?.(t.id, t.side);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    const now = performance.now();
    if (now - this.hoverAt < 100) return;
    this.hoverAt = now;
    const hit = this.screenHit(e);
    const t = hit ? this.ticketFor(hit.sc, hit.uv) : null;
    let label: string | null = null;
    if (hit && t) {
      const m = this.state?.markets.find((x) => x.id === t.id);
      label = `${t.side} · ${m ? `${m.outcome}` : t.id} — click for a PAPER ticket`;
    } else if (hit) label = hit.sc.label;
    this.setHover(label, !!t);
  };

  private onLeave = () => this.setHover(null, false);

  private setHover(label: string | null, clickable: boolean) {
    this.renderer.domElement.style.cursor = clickable ? "pointer" : "";
    if (label === this.hoverLabel) return;
    this.hoverLabel = label;
    this.opts.onHover?.(label);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (this.focused) this.setFocused(false);
      this.clearKeys();
      return;
    }
    if (!this.focused) return;
    // Never steal keys from a form field (the paper ticket).
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k === "w" || k === "a" || k === "s" || k === "d") {
      this.keys[k] = true;
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === "w" || k === "a" || k === "s" || k === "d") this.keys[k] = false;
  };

  private clearKeys() {
    this.keys.w = this.keys.a = this.keys.s = this.keys.d = false;
    this.owner.moving = false;
  }

  private onWheelCapture = (e: WheelEvent) => {
    const zoom = this.focused || e.ctrlKey || e.metaKey;
    this.controls.enableZoom = zoom;
    if (!zoom) this.opts.onScrollHint?.();
  };

  private onDocDown = (e: PointerEvent) => {
    const inside = e.target instanceof Node && this.renderer.domElement.contains(e.target);
    if (inside !== this.focused) this.setFocused(inside);
  };

  private setFocused(on: boolean) {
    this.focused = on;
    this.controls.enableZoom = on;
    this.renderer.domElement.style.touchAction = on ? "none" : "pan-y";
    if (!on) {
      this.clearKeys();
      this.ownerChaseHead = null;
    } else {
      this.ownerChaseHead = null;
      // Glide in behind the Owner, Floor-style.
      const o = this.owner;
      const behind = o.yaw + Math.PI;
      this.camGoal = {
        pos: new THREE.Vector3(o.pos[0] + Math.sin(behind) * 3.4, 2.6, o.pos[1] + Math.cos(behind) * 3.4),
        target: new THREE.Vector3(o.pos[0], 1.4, o.pos[1]),
      };
    }
    this.opts.onFocusChange?.(on);
  }

  releaseFocus() {
    if (this.focused) this.setFocused(false);
  }

  /** Camera presets for the tab's buttons. */
  look(where: "overview" | "jumbotron" | "board" | "bar") {
    const goals: Record<typeof where, [THREE.Vector3, THREE.Vector3]> = {
      overview: [new THREE.Vector3(0.6, 5.4, 12.6), new THREE.Vector3(0.2, 2.1, -3)],
      jumbotron: [new THREE.Vector3(-1.8, 3.0, 0.2), new THREE.Vector3(-1.8, 3.0, -7)],
      board: [new THREE.Vector3(-4.6, 2.7, -1.6), new THREE.Vector3(-7.0, 2.6, -6.4)],
      bar: [new THREE.Vector3(5.2, 2.6, 2.4), new THREE.Vector3(5.2, 2.4, -5)],
    };
    const [pos, target] = goals[where];
    this.camGoal = { pos, target };
  }

  private walkable = (x: number, z: number) => {
    const r = 0.25;
    if (x < ROOM.x0 + 0.4 || x > ROOM.x1 - 0.4 || z < ROOM.z0 + 0.4 || z > ROOM.z1 - 0.3) return false;
    return !BLOCKS.some(([x0, z0, x1, z1]) => x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r);
  };

  /* ── loop ── */

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    if (!this.visible) return;
    this.time += dt;
    const t = this.time;
    // WASD — only while focused (never hijacks the page).
    if (this.focused) {
      const f = new THREE.Vector3();
      this.camera.getWorldDirection(f);
      f.y = 0;
      if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
      else f.normalize();
      const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
      let mx = 0;
      let mz = 0;
      const fw = (this.keys.w ? 1 : 0) - (this.keys.s ? 1 : 0);
      const st = (this.keys.d ? 1 : 0) - (this.keys.a ? 1 : 0);
      mx += f.x * fw + right.x * st;
      mz += f.z * fw + right.z * st;
      const len = Math.hypot(mx, mz);
      if (len > 1e-6) this.owner.tryMove((mx / len) * 2.6 * dt, (mz / len) * 2.6 * dt, this.walkable);
      else this.owner.moving = false;
      // Ride with the Owner.
      const head = new THREE.Vector3(this.owner.pos[0], 1.4, this.owner.pos[1]);
      if (this.ownerChaseHead) {
        const d = head.clone().sub(this.ownerChaseHead);
        this.camera.position.add(d);
        this.controls.target.add(d);
        if (this.camGoal) {
          this.camGoal.pos.add(d);
          this.camGoal.target.add(d);
        }
      }
      this.ownerChaseHead = head;
    }
    this.owner.update(dt, t);
    for (const p of this.people) p.update(dt, t);
    if (this.camGoal) {
      const k = 1 - Math.exp(-3.2 * dt);
      this.camera.position.lerp(this.camGoal.pos, k);
      this.controls.target.lerp(this.camGoal.target, k);
      if (this.camera.position.distanceTo(this.camGoal.pos) < 0.03) this.camGoal = null;
    }
    this.controls.update();
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
    this.renderer.render(this.scene, this.camera);
  };

  /** Dev/headless: PNG of the current frame. */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.interObs?.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerleave", this.onLeave);
    el.removeEventListener("wheel", this.onWheelCapture, { capture: true });
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("pointerdown", this.onDocDown, true);
    this.controls.dispose();
    for (const p of this.people) p.dispose();
    for (const d of this.disposables) d.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const mm of ms) mm.dispose();
      }
    });
    this.renderer.dispose();
    el.remove();
    if (import.meta.env.DEV) delete (window as unknown as { __mead?: MeadScene }).__mead;
  }
}

/** Market lookup helper for the tab. */
export function marketById(s: PredictionMarketFeedState | null, id: string): PredictionMarket | null {
  return s?.markets.find((m) => m.id === id) ?? null;
}
