/**
 * The trading floor in 3D — five people in their own glass offices, a war
 * room with chart and news TVs and a whiteboard, and a lounge.
 *
 * Rendering only. Everything a character does is decided upstream: WHERE
 * (the contract's zone + the people layer's activity spot), WHAT (the
 * meeting line's animation while they speak, their activity otherwise) and
 * WHAT THE SCREENS SAY (floor-screens.ts). This file walks them there around
 * the furniture (A* on the floor plan in src/data/floor-layout.json), poses
 * them, and draws.
 *
 * The office itself is `public/floor/office.glb`, built headless in Blender
 * by scripts/blender/build_floor.py from the same floor plan; if the GLB is
 * missing or fails to load, the same plan is built from boxes so the room
 * still works. Screens are found by name in either case.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import layoutJson from "@/data/floor-layout.json";
import type { AgentAct } from "@/lib/room/agents";
import type { Animation, Character, DialogueLine } from "@/lib/room/orchestrator";
import { drawScreen, URGENCY_COLOR, type FloorFrame } from "./floor-screens";

/* ── The plan ───────────────────────────────────────────────────────────── */

type V2 = [number, number];
type V3 = [number, number, number];
interface Anchor {
  pos: V2;
  look: V2;
  pose: "sit" | "stand" | "couch";
  role?: string;
  act?: string;
}
interface Layout {
  bounds: { x: V2; z: V2 };
  ceiling: number;
  rooms: { id: string; label: string; x: V2; z: V2; floor: string }[];
  walls: { id: string; a: V2; b: V2; height: number; kind: string; doors: V2[] }[];
  furniture: { id: string; kind: string; pos: V2; rot: number; size: V3; obstacle: boolean; style?: string; onTop?: number }[];
  screens: { id: string; kind: string; center: V3; size: V2; facing: number; px: V2 }[];
  emissives: { id: string; kind: string; a: V3; b: V3; thickness: number }[];
  anchors: Record<string, Partial<Record<Character, Anchor>>>;
  spots: Record<string, Anchor>;
  nav: { cell: number; inflate: number };
  camera: Record<string, { pos: V3; target: V3 }>;
  crew: Record<
    Character,
    { school: string; role: string; height: number; build: number; hair: string; accessories: string[]; colors: Record<string, string> }
  >;
}
export const LAYOUT = layoutJson as unknown as Layout;
export const CREW_ORDER: Character[] = ["Gemma", "Jax", "Nova", "Sterling", "Vince"];
const SCHOOL_LABEL: Record<string, string> = { ict: "ICT", tjr: "TJR", blake: "Blake Mech", patty: "Patty/PB", smc: "SMC" };

const DEG = Math.PI / 180;
const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const yawTo = (from: V2, to: V2) => Math.atan2(to[0] - from[0], to[1] - from[1]);
function angleLerp(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/* ── Navigation: A* on the floor plan ───────────────────────────────────── */

class NavGrid {
  readonly x0: number;
  readonly z0: number;
  readonly cell: number;
  readonly nx: number;
  readonly nz: number;
  readonly blocked: Uint8Array;

  constructor(L: Layout) {
    this.cell = L.nav.cell;
    this.x0 = L.bounds.x[0];
    this.z0 = L.bounds.z[0];
    this.nx = Math.ceil((L.bounds.x[1] - L.bounds.x[0]) / this.cell);
    this.nz = Math.ceil((L.bounds.z[1] - L.bounds.z[0]) / this.cell);
    this.blocked = new Uint8Array(this.nx * this.nz);
    // The building's edge.
    for (let i = 0; i < this.nx; i++) for (const j of [0, this.nz - 1]) this.blocked[j * this.nx + i] = 1;
    for (let j = 0; j < this.nz; j++) for (const i of [0, this.nx - 1]) this.blocked[j * this.nx + i] = 1;
    const wallPad = 0.06 + 0.16;
    for (const w of L.walls) {
      const horizontal = w.a[1] === w.b[1];
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      for (let s = 0; s <= len; s += this.cell / 3) {
        const x = w.a[0] + ((w.b[0] - w.a[0]) * s) / len;
        const z = w.a[1] + ((w.b[1] - w.a[1]) * s) / len;
        const along = horizontal ? x : z;
        if (w.doors.some(([lo, hi]) => along > Math.min(lo, hi) && along < Math.max(lo, hi))) continue;
        this.markDisc(x, z, wallPad);
      }
    }
    for (const f of L.furniture) {
      if (!f.obstacle) continue;
      const hw = f.size[0] / 2 + L.nav.inflate;
      const hd = f.size[2] / 2 + L.nav.inflate;
      const c = Math.cos(f.rot * DEG);
      const s = Math.sin(f.rot * DEG);
      const r = Math.hypot(hw, hd);
      const [ci0, cj0] = this.cellOf(f.pos[0] - r, f.pos[1] - r);
      const [ci1, cj1] = this.cellOf(f.pos[0] + r, f.pos[1] + r);
      for (let j = cj0; j <= cj1; j++)
        for (let i = ci0; i <= ci1; i++) {
          const [x, z] = this.center(i, j);
          const dx = x - f.pos[0];
          const dz = z - f.pos[1];
          // Into the object's frame (yaw rotates +z toward +x).
          const lx = dx * c - dz * s;
          const lz = dx * s + dz * c;
          if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) this.set(i, j);
        }
    }
  }

  private set(i: number, j: number) {
    if (i >= 0 && j >= 0 && i < this.nx && j < this.nz) this.blocked[j * this.nx + i] = 1;
  }

  private markDisc(x: number, z: number, r: number) {
    const [i0, j0] = this.cellOf(x - r, z - r);
    const [i1, j1] = this.cellOf(x + r, z + r);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const [cx, cz] = this.center(i, j);
        if (Math.hypot(cx - x, cz - z) <= r + this.cell * 0.5) this.set(i, j);
      }
  }

  cellOf(x: number, z: number): [number, number] {
    return [Math.floor((x - this.x0) / this.cell), Math.floor((z - this.z0) / this.cell)];
  }

  center(i: number, j: number): V2 {
    return [this.x0 + (i + 0.5) * this.cell, this.z0 + (j + 0.5) * this.cell];
  }

  free(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.nx && j < this.nz && !this.blocked[j * this.nx + i];
  }

  nearestFree(i: number, j: number): [number, number] {
    if (this.free(i, j)) return [i, j];
    for (let r = 1; r < 14; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (this.free(i + di, j + dj)) return [i + di, j + dj];
        }
    return [i, j];
  }

  lineFree(a: V2, b: V2): boolean {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(d / (this.cell * 0.4));
    for (let k = 1; k < n; k++) {
      const [i, j] = this.cellOf(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n);
      if (!this.free(i, j)) return false;
    }
    return true;
  }

  /** A* from a to b; returns world waypoints ending exactly at b. */
  path(a: V2, b: V2): V2[] {
    const [si, sj] = this.nearestFree(...this.cellOf(a[0], a[1]));
    const [gi, gj] = this.nearestFree(...this.cellOf(b[0], b[1]));
    const N = this.nx * this.nz;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const start = sj * this.nx + si;
    const goal = gj * this.nx + gi;
    const h = (k: number) => {
      const i = k % this.nx;
      const j = (k / this.nx) | 0;
      const dx = Math.abs(i - gi);
      const dz = Math.abs(j - gj);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    const heap: [number, number][] = [[h(start), start]];
    g[start] = 0;
    const push = (f: number, k: number) => {
      heap.push([f, k]);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (heap[p]![0] <= heap[c]![0]) break;
        [heap[p], heap[c]] = [heap[c]!, heap[p]!];
        c = p;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = c * 2 + 1;
          const r = l + 1;
          let m = c;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c]!, heap[m]!];
          c = m;
        }
      }
      return top;
    };
    let found = false;
    let guard = 0;
    while (heap.length && guard++ < 40_000) {
      const [, k] = pop();
      if (closed[k]) continue;
      if (k === goal) {
        found = true;
        break;
      }
      closed[k] = 1;
      const i = k % this.nx;
      const j = (k / this.nx) | 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di;
          const nj = j + dj;
          if (!this.free(ni, nj)) continue;
          if (di && dj && (!this.free(i + di, j) || !this.free(i, j + dj))) continue;
          const nk = nj * this.nx + ni;
          const ng = g[k]! + (di && dj ? 1.414 : 1);
          if (ng < g[nk]!) {
            g[nk] = ng;
            came[nk] = k;
            push(ng + h(nk), nk);
          }
        }
    }
    if (!found) return [b];
    const cells: V2[] = [];
    for (let k = goal; k !== -1 && k !== start; k = came[k]!) cells.push(this.center(k % this.nx, (k / this.nx) | 0));
    cells.reverse();
    // String-pull: keep only the corners line of sight cannot skip.
    const pts: V2[] = [];
    let cur: V2 = a;
    let idx = 0;
    while (idx < cells.length) {
      let far = idx;
      for (let k = cells.length - 1; k > idx; k--)
        if (this.lineFree(cur, cells[k]!)) {
          far = k;
          break;
        }
      pts.push(cells[far]!);
      cur = cells[far]!;
      idx = far + 1;
    }
    pts.push(b);
    return pts;
  }
}

/* ── People ─────────────────────────────────────────────────────────────── */

type AnimKey =
  | Animation
  | "IDLE"
  | "WALK"
  | "DRINK"
  | "COUCH"
  | "WATCH"
  | "PHONE_CALL"
  | "TALK"
  | "STRETCH"
  | "LEAN_BACK";

interface Pose {
  spine: V3;
  head: V3;
  shL: V3;
  shR: V3;
  elL: number;
  elR: number;
  hipL: number;
  hipR: number;
  knL: number;
  knR: number;
  bodyY: number;
  mug: boolean;
  tablet: boolean;
  marker: boolean;
  phone: boolean;
  thumb: boolean;
}

function basePose(): Pose {
  return {
    spine: [0, 0, 0],
    head: [0, 0, 0],
    shL: [0, 0, 0.08],
    shR: [0, 0, -0.08],
    elL: -0.12,
    elR: -0.12,
    hipL: 0,
    hipR: 0,
    knL: 0,
    knR: 0,
    bodyY: 0,
    mug: false,
    tablet: false,
    marker: false,
    phone: false,
    thumb: false,
  };
}

const sip = (t: number) => Math.pow(Math.max(0, Math.sin(t * 0.9)), 6);

function poseFor(key: AnimKey, t: number, mode: "stand" | "sit" | "couch", hipH: number, walkPhase: number): Pose {
  const p = basePose();
  const seated = mode !== "stand";
  if (seated) {
    const seat = mode === "couch" ? 0.42 : 0.47;
    p.bodyY = seat - hipH;
    p.hipL = p.hipR = -1.5;
    p.knL = p.knR = 1.5;
    if (mode === "couch") p.spine[0] = -0.28;
  }
  // Breathing everywhere.
  p.spine[0] += 0.02 * Math.sin(t * 1.3);
  const walk = (stride: number) => {
    const s = Math.sin(walkPhase);
    p.hipL = 0.55 * s * stride;
    p.hipR = -0.55 * s * stride;
    p.knL = (0.15 + 0.75 * Math.max(0, Math.cos(walkPhase))) * stride;
    p.knR = (0.15 + 0.75 * Math.max(0, -Math.cos(walkPhase))) * stride;
    p.shL = [-0.4 * s * stride, 0, 0.08];
    p.shR = [0.4 * s * stride, 0, -0.08];
    p.elL = p.elR = -0.3;
    p.spine[0] = 0.05;
    p.bodyY = 0.03 * Math.abs(Math.cos(walkPhase));
  };
  switch (key) {
    case "WALK":
      walk(1);
      break;
    case "PACING":
      walk(0.7);
      p.shR = [-0.5, 0.3, -0.1];
      p.elR = -2.1;
      p.head[0] = 0.12;
      break;
    case "SHOUTING": {
      const shake = 0.15 * Math.sin(t * 14);
      p.shL = [-2.6 + shake, 0, 0.5];
      p.shR = [-2.6 - shake, 0, -0.5];
      p.elL = p.elR = -0.4;
      p.head[0] = -0.3;
      if (!seated) p.bodyY += 0.04 * Math.abs(Math.sin(t * 9));
      break;
    }
    case "POINTING":
      p.shR = [-1.55 + 0.06 * Math.sin(t * 6), 0, -0.05];
      p.elR = -0.05;
      p.spine[0] += 0.08;
      break;
    case "FURIOUS_TYPING":
      if (seated) {
        p.shL = [-0.55 + 0.05 * Math.sin(t * 26), -0.15, 0.1];
        p.shR = [-0.55 + 0.05 * Math.sin(t * 29 + 1), 0.15, -0.1];
        p.elL = p.elR = -1.05;
        p.spine[0] += 0.18;
        p.head[0] = 0.12;
      } else {
        p.shL = [-0.45, -0.35, 0.15];
        p.shR = [-0.45 + 0.04 * Math.sin(t * 22), 0.35, -0.15];
        p.elL = p.elR = -1.6;
        p.head[0] = 0.45;
        p.phone = true;
      }
      break;
    case "GESTICURING_AT_WALL":
      p.shR = [-2.1 + 0.25 * Math.sin(t * 2.2), 0, -0.25];
      p.elR = -0.3;
      p.shL = [-0.6, 0, 0.3 + 0.15 * Math.sin(t * 2)];
      p.elL = -0.9;
      p.head[0] = -0.1;
      break;
    case "EXPLAINING":
    case "TALK": {
      const a = key === "TALK" ? 0.6 : 1;
      p.shL = [-0.55 * a, 0, 0.25 + 0.2 * a * Math.sin(t * 2.5)];
      p.shR = [-0.55 * a, 0, -0.25 - 0.2 * a * Math.sin(t * 2.5 + 1.2)];
      p.elL = -1.0 + 0.15 * Math.sin(t * 3);
      p.elR = -1.0 + 0.15 * Math.sin(t * 3 + 1.5);
      p.spine[1] = 0.15 * a * Math.sin(t * 1.1);
      p.head[0] = 0.05 * Math.sin(t * 2);
      break;
    }
    case "WRITING_ON_WHITEBOARD":
      p.shR = [-1.95 + 0.12 * Math.sin(t * 7), 0, -0.18 + 0.12 * Math.cos(t * 5)];
      p.elR = -0.35;
      p.head[0] = -0.12;
      p.marker = true;
      break;
    case "NODDING":
      p.head[0] = 0.08 + 0.22 * Math.max(0, Math.sin(t * 5));
      break;
    case "ANALYZING":
      p.shR = [-0.45, 0.2, -0.1];
      p.elR = -2.15;
      p.shL = [-0.35, -0.8, 0.1];
      p.elL = -1.5;
      p.head[2] = 0.12;
      p.spine[0] += seated ? 0.15 : 0.05;
      break;
    case "CROSSING_ARMS":
    case "WATCH":
      p.shL = [-0.35, -1.0, 0.12];
      p.shR = [-0.35, 1.0, -0.12];
      p.elL = p.elR = -1.75;
      if (key === "WATCH") p.head[0] = -0.15;
      else p.head[1] = 0.18 * Math.sin(t * 2.2) * Math.max(0, Math.sin(t * 0.5));
      break;
    case "CHECKING_TABLET":
      p.shL = [-0.5, -0.3, 0.1];
      p.elL = -1.3;
      p.shR = [-0.45, 0.5, -0.1];
      p.elR = -1.4 + 0.08 * Math.sin(t * 9);
      p.head[0] = 0.42;
      p.tablet = true;
      break;
    case "APPROVING":
      p.shR = [-1.25 + 0.05 * Math.sin(t * 3), 0, -0.15];
      p.elR = -0.9;
      p.head[0] = 0.15 * Math.max(0, Math.sin(t * 4));
      break;
    case "SMASHING_ENTER_KEY": {
      const ph = (t * 0.9) % 1;
      p.spine[0] += 0.35;
      p.shR = [ph < 0.7 ? -0.6 - 1.8 * (ph / 0.7) : -2.4 + 1.8 * ((ph - 0.7) / 0.3), 0, -0.1];
      p.elR = -0.25;
      p.shL = [-0.7, 0, 0.1];
      p.elL = -0.6;
      break;
    }
    case "THUMBS_UP":
      p.shR = [-1.2, 0, -0.1];
      p.elR = -1.25 + 0.06 * Math.sin(t * 4);
      p.thumb = true;
      break;
    case "STEADY_MONITORING":
      if (seated) {
        p.shL = [-0.6, -0.1, 0.1];
        p.shR = [-0.6, 0.1, -0.1];
        p.elL = p.elR = -0.85;
        p.spine[0] += 0.08;
      } else {
        p.shL = [0.1, 1.2, 0.45];
        p.shR = [0.1, -1.2, -0.45];
        p.elL = p.elR = -1.5;
      }
      p.head[1] = 0.35 * Math.sin(t * 0.6);
      break;
    case "DRINK":
      p.shR = [-0.5 - 0.9 * sip(t), 0.2, -0.1];
      p.elR = -1.4 - 0.7 * sip(t);
      p.head[0] = -0.15 * sip(t);
      p.mug = true;
      break;
    case "COUCH":
      p.shL = [0, 0, 0.9];
      p.elL = -0.3;
      p.shR = [-0.4, 0, -0.1];
      p.elR = -0.6;
      break;
    case "PHONE_CALL":
      p.shR = [-0.35, 0.3, -0.35];
      p.elR = -2.3;
      p.shL = [-0.5, 0, 0.25 + 0.15 * Math.sin(t * 2)];
      p.elL = -0.9;
      p.phone = true;
      break;
    case "STRETCH": {
      const up = (t % 7) / 7 < 0.4;
      p.shL = up ? [-2.9, 0, 0.2] : [0, 0, 0.08];
      p.shR = up ? [-2.9, 0, -0.2] : [0, 0, -0.08];
      p.elL = p.elR = up ? -0.1 : -0.12;
      break;
    }
    case "LEAN_BACK":
      p.spine[0] = -0.22;
      p.shL = [-2.6, 0, 0.6];
      p.shR = [-2.6, 0, -0.6];
      p.elL = p.elR = -2.4;
      break;
    default:
      p.shL = [0, 0, 0.08 + 0.02 * Math.sin(t * 1.3)];
      p.shR = [0, 0, -0.08 - 0.02 * Math.sin(t * 1.3)];
  }
  return p;
}

interface Target {
  pos: V2;
  yaw: number;
  pose: "stand" | "sit" | "couch";
  key: string;
}

class Avatar {
  readonly who: Character;
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly spine = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly shL = new THREE.Group();
  private readonly shR = new THREE.Group();
  private readonly elL = new THREE.Group();
  private readonly elR = new THREE.Group();
  private readonly hipL = new THREE.Group();
  private readonly hipR = new THREE.Group();
  private readonly knL = new THREE.Group();
  private readonly knR = new THREE.Group();
  private readonly props: Record<"mug" | "tablet" | "marker" | "phone" | "thumb", THREE.Object3D>;
  private readonly mouth: THREE.Mesh;
  readonly hipH: number;
  readonly height: number;
  readonly tag: THREE.Sprite;
  readonly bubble: THREE.Sprite;
  private readonly bubbleCanvas: HTMLCanvasElement;
  private readonly bubbleTex: THREE.CanvasTexture;
  private bubbleText = "";
  pos: V2;
  yaw = 0;
  private path: V2[] = [];
  private target: Target | null = null;
  private mode: "stand" | "sit" | "couch" = "stand";
  private walkPhase = 0;
  moving = false;
  anim: AnimKey = "IDLE";
  speaking = false;
  /** Pacing back and forth around the target while not walking anywhere else. */
  pace = false;
  private paceToB = true;
  private bodyY = 0;
  private slamCooldown = 0;
  onSlam: (() => void) | null = null;

  constructor(who: Character, nav: NavGrid) {
    this.who = who;
    const spec = LAYOUT.crew[who];
    this.height = spec.height;
    const s = spec.height / 1.75;
    const b = spec.build;
    this.hipH = 0.92 * s;
    const mat = (hex: string, rough = 0.7) => new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: rough, metalness: 0.02 });
    const skin = mat(spec.colors.skin ?? "#e0ac69", 0.55);
    const top = mat(spec.colors.top ?? "#475569");
    const bottom = mat(spec.colors.bottom ?? "#1f2937");
    const shoes = mat(spec.colors.shoes ?? "#111827", 0.5);
    const hair = mat(spec.colors.hair ?? "#111827", 0.85);
    const accent = mat(spec.colors.accent ?? "#f59e0b", 0.4);
    const dark = mat("#0b0f19", 0.4);
    const shadowed = (m: THREE.Mesh) => {
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    const capsule = (r: number, len: number, m: THREE.Material) => shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), m));

    this.root.add(this.body);
    // Pelvis.
    const hips = new THREE.Group();
    hips.position.y = this.hipH;
    this.body.add(hips);
    const pelvis = capsule(0.13 * b, 0.1 * b, bottom);
    pelvis.rotation.z = Math.PI / 2;
    pelvis.scale.set(1, 1, 0.85);
    hips.add(pelvis);
    // Spine → chest → head.
    hips.add(this.spine);
    const torso = capsule(0.165 * b, 0.26 * s, top);
    torso.position.y = 0.27 * s;
    torso.scale.set(1, 1, 0.72);
    this.spine.add(torso);
    const neck = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.1, 10), skin));
    neck.position.y = 0.5 * s;
    this.spine.add(neck);
    this.head.position.y = 0.56 * s;
    this.spine.add(this.head);
    const skull = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 18), skin));
    skull.position.y = 0.12;
    skull.scale.set(0.95, 1.05, 1);
    this.head.add(skull);
    for (const x of [-0.045, 0.045]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), dark);
      eye.position.set(x, 0.14, 0.118);
      this.head.add(eye);
    }
    this.mouth = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.035, 4, 8), dark);
    this.mouth.rotation.z = Math.PI / 2;
    this.mouth.position.set(0, 0.075, 0.122);
    this.head.add(this.mouth);
    this.head.add(this.hairMesh(spec.hair, hair));
    for (const acc of spec.accessories) {
      const a = this.accessory(acc, accent, dark);
      if (a) (acc === "acc_tie" ? this.spine : this.head).add(a);
    }
    // Arms.
    const armSide = (sh: THREE.Group, el: THREE.Group, side: 1 | -1) => {
      sh.position.set(0.215 * b * side, 0.43 * s, 0);
      this.spine.add(sh);
      const upper = capsule(0.052 * b, 0.21 * s, top);
      upper.position.y = -0.145 * s;
      sh.add(upper);
      el.position.y = -0.29 * s;
      sh.add(el);
      const fore = capsule(0.045 * b, 0.19 * s, top);
      fore.position.y = -0.13 * s;
      el.add(fore);
      const hand = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), skin));
      hand.position.y = -0.27 * s;
      hand.name = side === 1 ? "handL" : "handR";
      el.add(hand);
      return hand;
    };
    const handL = armSide(this.shL, this.elL, 1);
    const handR = armSide(this.shR, this.elR, -1);
    // Legs.
    const legSide = (hp: THREE.Group, kn: THREE.Group, side: 1 | -1) => {
      hp.position.set(0.09 * b * side, 0, 0);
      hips.add(hp);
      const thigh = capsule(0.07 * b, 0.3 * s, bottom);
      thigh.position.y = -0.22 * s;
      hp.add(thigh);
      kn.position.y = -0.44 * s;
      hp.add(kn);
      const shin = capsule(0.06 * b, 0.3 * s, bottom);
      shin.position.y = -0.21 * s;
      kn.add(shin);
      const shoe = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.11 * b, 0.07, 0.25), shoes));
      shoe.position.set(0, -0.44 * s + 0.0, 0.05);
      kn.add(shoe);
    };
    legSide(this.hipL, this.knL, 1);
    legSide(this.hipR, this.knR, -1);
    // Props, hidden until a pose needs them.
    const mug = new THREE.Group();
    const cup = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 14), mat("#f8fafc", 0.3)));
    mug.add(cup);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.008, 6, 12), mat("#f8fafc", 0.3));
    handle.position.x = 0.045;
    mug.add(handle);
    mug.position.set(0, -0.06, 0.05);
    handR.add(mug);
    const tablet = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.015, 0.17), mat("#111827", 0.3)));
    tablet.position.set(-0.05, -0.02, 0.08);
    handL.add(tablet);
    const marker = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 8), accent));
    marker.rotation.x = Math.PI / 2;
    marker.position.set(0, -0.02, 0.07);
    handR.add(marker);
    const phone = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.012, 0.15), mat("#0f172a", 0.25)));
    phone.position.set(0, -0.02, 0.06);
    handR.add(phone);
    const thumb = shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.04, 4, 8), skin));
    thumb.position.set(0, 0.05, 0.01);
    handR.add(thumb);
    this.props = { mug, tablet, marker, phone, thumb };
    for (const k of Object.keys(this.props) as (keyof typeof this.props)[]) this.props[k].visible = false;

    // Name tag and speech bubble.
    this.tag = this.makeTag(who, spec.school, spec.role, spec.colors.top ?? "#475569");
    this.root.add(this.tag);
    this.bubbleCanvas = document.createElement("canvas");
    this.bubbleCanvas.width = 640;
    this.bubbleCanvas.height = 240;
    this.bubbleTex = new THREE.CanvasTexture(this.bubbleCanvas);
    this.bubbleTex.colorSpace = THREE.SRGBColorSpace;
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.bubbleTex, transparent: true, depthTest: false, opacity: 0 }));
    this.bubble.scale.set(2.7, 1.01, 1);
    this.bubble.renderOrder = 20;
    this.root.add(this.bubble);
    this.root.traverse((o) => (o.userData.character = who));

    const desk = Object.entries(LAYOUT.anchors).find(([, v]) => v[who]?.pose === "sit")?.[1][who];
    this.pos = desk ? [...desk.pos] : [0, 0];
    if (desk) {
      this.yaw = yawTo(desk.pos, desk.look);
      this.mode = "sit";
    }
    this.root.position.set(this.pos[0], 0, this.pos[1]);
    this.root.rotation.y = this.yaw;
    void nav;
  }

  private hairMesh(kind: string, m: THREE.Material): THREE.Object3D {
    const g = new THREE.Group();
    const cap = (scaleY = 1, back = 0) => {
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.138, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), m);
      c.position.set(0, 0.125, -0.01 - back);
      c.scale.set(1, scaleY, 1.02);
      c.castShadow = true;
      return c;
    };
    if (kind === "hair_buzz") g.add(cap(0.9));
    else if (kind === "hair_short") {
      g.add(cap(1));
      const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.06), m);
      fringe.position.set(0, 0.23, 0.09);
      fringe.rotation.x = 0.4;
      g.add(fringe);
    } else if (kind === "hair_bun") {
      g.add(cap(1));
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.065, 14, 10), m);
      bun.position.set(0, 0.27, -0.09);
      g.add(bun);
    } else if (kind === "hair_long") {
      g.add(cap(1.02));
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.34, 0.07), m);
      back.position.set(0, 0.02, -0.1);
      back.castShadow = true;
      g.add(back);
      for (const x of [-0.125, 0.125]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.14), m);
        side.position.set(x, 0.06, -0.01);
        g.add(side);
      }
    } else g.add(cap(1.15, 0.02));
    return g;
  }

  private accessory(kind: string, accent: THREE.Material, dark: THREE.Material): THREE.Object3D | null {
    const g = new THREE.Group();
    if (kind === "acc_cap") {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.142, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), accent);
      crown.position.y = 0.14;
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.11), accent);
      brim.position.set(0, 0.15, -0.17);
      g.add(crown, brim);
    } else if (kind === "acc_glasses") {
      for (const x of [-0.048, 0.048]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 16), accent);
        ring.position.set(x, 0.14, 0.128);
        g.add(ring);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.006, 0.006), accent);
      bridge.position.set(0, 0.145, 0.13);
      g.add(bridge);
    } else if (kind === "acc_tie") {
      const tie = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.015), accent);
      tie.position.set(0, 0.33, 0.125);
      g.add(tie);
    } else if (kind === "acc_headset") {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 20, Math.PI), accent);
      band.position.y = 0.13;
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), dark);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(-0.14, 0.12, 0);
      const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), accent);
      mic.rotation.x = Math.PI / 2.4;
      mic.position.set(-0.12, 0.08, 0.07);
      g.add(band, cup, mic);
    } else if (kind === "acc_earrings") {
      for (const x of [-0.125, 0.125]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), accent);
        e.position.set(x, 0.07, 0.01);
        g.add(e);
      }
    } else return null;
    return g;
  }

  private makeTag(who: string, school: string, role: string, color: string): THREE.Sprite {
    const c = document.createElement("canvas");
    c.width = 384;
    c.height = 84;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgba(9,13,24,0.86)";
    ctx.beginPath();
    ctx.roundRect(4, 4, 376, 76, 18);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(4, 4, 12, 76);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "800 32px Inter, system-ui, sans-serif";
    ctx.fillText(who.toUpperCase(), 30, 40);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 22px Inter, system-ui, sans-serif";
    ctx.fillText(`${SCHOOL_LABEL[school] ?? school} · ${role}`, 30, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(1.05, 0.23, 1);
    sp.renderOrder = 10;
    return sp;
  }

  say(text: string | null) {
    if (text === this.bubbleText) return;
    this.bubbleText = text ?? "";
    const ctx = this.bubbleCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, 640, 240);
    if (!text) {
      this.bubbleTex.needsUpdate = true;
      return;
    }
    ctx.fillStyle = "rgba(255,255,255,0.97)";
    ctx.beginPath();
    ctx.roundRect(6, 6, 628, 196, 26);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(300, 200);
    ctx.lineTo(340, 200);
    ctx.lineTo(318, 234);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 27px Inter, system-ui, sans-serif";
    const words = text.split(/\s+/);
    let line = "";
    let y = 46;
    let lines = 0;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > 590 && line) {
        lines++;
        if (lines >= 5) {
          ctx.fillText(`${line}…`, 24, y);
          line = "";
          break;
        }
        ctx.fillText(line, 24, y);
        y += 34;
        line = w;
      } else line = test;
    }
    if (line) ctx.fillText(line, 24, y);
    this.bubbleTex.needsUpdate = true;
  }

  /** Walk to (or stay at) a target; paths are only recomputed when the target moves. */
  goTo(t: Target, nav: NavGrid) {
    if (this.target && this.target.key === t.key) {
      this.target = t;
      return;
    }
    this.target = t;
    const far = Math.hypot(t.pos[0] - this.pos[0], t.pos[1] - this.pos[1]) > 0.08;
    if (far) {
      this.path = nav.path(this.pos, t.pos);
      this.moving = true;
      this.mode = "stand";
    }
  }

  update(dt: number, t: number) {
    const target = this.target;
    // Locomotion.
    if (this.moving && this.path.length) {
      const next = this.path[0]!;
      const dx = next[0] - this.pos[0];
      const dz = next[1] - this.pos[1];
      const d = Math.hypot(dx, dz);
      const speed = this.anim === "PACING" ? 0.8 : 1.35;
      const step = speed * dt;
      if (d <= step) {
        this.pos = [next[0], next[1]];
        this.path.shift();
      } else {
        this.pos = [this.pos[0] + (dx / d) * step, this.pos[1] + (dz / d) * step];
      }
      this.yaw = angleLerp(this.yaw, Math.atan2(dx, dz), 1 - Math.exp(-10 * dt));
      this.walkPhase += dt * speed * 4.4;
      if (!this.path.length) {
        this.moving = false;
        if (target) this.mode = target.pose;
      }
    } else if (target) {
      if (this.pace && target.pose === "stand") {
        // Pace a short line across the anchor, facing the way she walks.
        const off = this.paceToB ? 0.9 : -0.9;
        const ax: V2 = [target.pos[0] + Math.cos(target.yaw) * off, target.pos[1] - Math.sin(target.yaw) * off];
        const dx = ax[0] - this.pos[0];
        const dz = ax[1] - this.pos[1];
        const d = Math.hypot(dx, dz);
        if (d < 0.05) this.paceToB = !this.paceToB;
        else {
          const step = Math.min(d, 0.75 * dt);
          this.pos = [this.pos[0] + (dx / d) * step, this.pos[1] + (dz / d) * step];
          this.yaw = angleLerp(this.yaw, Math.atan2(dx, dz), 1 - Math.exp(-8 * dt));
          this.walkPhase += dt * 3.3;
        }
      } else {
        this.yaw = angleLerp(this.yaw, target.yaw, 1 - Math.exp(-6 * dt));
        this.mode = target.pose;
      }
    }
    this.root.position.set(this.pos[0], 0, this.pos[1]);
    this.root.rotation.y = this.yaw;

    // Pose.
    const key: AnimKey = this.moving ? "WALK" : this.pace && this.mode === "stand" ? "PACING" : this.anim;
    const pose = poseFor(key, t, this.moving ? "stand" : this.mode, this.hipH, this.walkPhase);
    const k = 1 - Math.exp(-12 * dt);
    const setR = (g: THREE.Object3D, r: V3) => {
      g.rotation.x += (r[0] - g.rotation.x) * k;
      g.rotation.y += (r[1] - g.rotation.y) * k;
      g.rotation.z += (r[2] - g.rotation.z) * k;
    };
    setR(this.spine, pose.spine);
    setR(this.head, pose.head);
    setR(this.shL, pose.shL);
    setR(this.shR, pose.shR);
    this.elL.rotation.x += (pose.elL - this.elL.rotation.x) * k;
    this.elR.rotation.x += (pose.elR - this.elR.rotation.x) * k;
    this.hipL.rotation.x += (pose.hipL - this.hipL.rotation.x) * k;
    this.hipR.rotation.x += (pose.hipR - this.hipR.rotation.x) * k;
    this.knL.rotation.x += (pose.knL - this.knL.rotation.x) * k;
    this.knR.rotation.x += (pose.knR - this.knR.rotation.x) * k;
    this.bodyY = damp(this.bodyY, pose.bodyY, 10, dt);
    this.body.position.y = this.bodyY;
    this.props.mug.visible = pose.mug;
    this.props.tablet.visible = pose.tablet;
    this.props.marker.visible = pose.marker;
    this.props.phone.visible = pose.phone;
    this.props.thumb.visible = pose.thumb;
    // Talking mouth.
    this.mouth.scale.y = this.speaking ? 1 + 2.2 * Math.abs(Math.sin(t * 13)) : 1;
    // Enter-key slam event.
    if (key === "SMASHING_ENTER_KEY") {
      const ph = (t * 0.9) % 1;
      this.slamCooldown -= dt;
      if (ph > 0.96 && this.slamCooldown <= 0) {
        this.slamCooldown = 0.5;
        this.onSlam?.();
      }
    }
    const headY = this.bodyY + this.height + 0.05;
    this.tag.position.y = headY + 0.18;
    this.bubble.position.y = headY + 0.85;
    const bm = this.bubble.material as THREE.SpriteMaterial;
    bm.opacity = damp(bm.opacity, this.speaking && this.bubbleText ? 1 : 0, 8, dt);
  }
}

/* ── The scene ──────────────────────────────────────────────────────────── */

interface ScreenRec {
  id: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  w: number;
  h: number;
}

export type CameraPreset = "overview" | "board" | "offices" | "front" | "lounge" | "follow";

export interface FloorSceneOptions {
  onSpeaker?: (index: number, line: DialogueLine | null) => void;
  onMeetingDone?: () => void;
  onSelect?: (who: Character) => void;
  onEnvironment?: (source: "glb" | "fallback") => void;
}

const FLOOR_COLORS: Record<string, string> = {
  carpet_red: "#3b2224",
  carpet_violet: "#2c2540",
  carpet_green: "#1f3328",
  carpet_navy: "#1c2638",
  carpet_slate: "#272c35",
  wood: "#6b4f37",
  tile: "#9ba1a9",
};

const FURNITURE_COLORS: Record<string, string> = {
  desk: "#8b6a4a",
  office_chair: "#1f2937",
  keyboard: "#111827",
  meeting_table: "#5b4636",
  meeting_chair: "#334155",
  counter: "#e5e7eb",
  fridge: "#d1d5db",
  watercooler: "#93c5fd",
  couch: "#475569",
  coffee_table: "#78350f",
  rug: "#334155",
  bar_table: "#1f2937",
  bar_stool: "#9ca3af",
  plant: "#15803d",
  bookshelf: "#5b4636",
  filing_cabinet: "#6b7280",
  safe: "#374151",
  server_rack: "#0f172a",
  punching_bag: "#7f1d1d",
  printer: "#e5e7eb",
  bench: "#475569",
  globe: "#1d4ed8",
  armchair: "#7c2d12",
};

/**
 * One piece of furniture from the plan, built from boxes. Anything a person
 * sits IN (chairs, the couch, the armchair) is a seat and a back, not a solid
 * block — a solid block the size of a chair swallows whoever sits in it — and
 * desks and tables leave room for knees. Local +z is the piece's front.
 */
function fallbackPiece(f: Layout["furniture"][number], mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const [w, h, d] = f.size;
  const box = (bw: number, bh: number, bd: number, x: number, y: number, z: number, m: THREE.Material = mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  switch (f.kind) {
    case "office_chair":
    case "meeting_chair": {
      const seatY = 0.45;
      box(w * 0.92, 0.08, d * 0.9, 0, seatY, 0.02);
      box(w * 0.92, h - seatY - 0.08, 0.07, 0, (h + seatY + 0.08) / 2, -d / 2 + 0.05);
      box(0.06, seatY - 0.06, 0.06, 0, (seatY - 0.06) / 2 + 0.02, 0);
      box(w * 0.8, 0.04, d * 0.8, 0, 0.02, 0);
      break;
    }
    case "couch":
    case "armchair": {
      const seatY = f.kind === "couch" ? 0.42 : 0.44;
      const arm = Math.min(0.18, w * 0.15);
      box(w, seatY, d, 0, seatY / 2, 0);
      box(w, h - seatY, d * 0.24, 0, seatY + (h - seatY) / 2, -d / 2 + d * 0.12);
      for (const side of [-1, 1]) box(arm, 0.2, d, side * (w / 2 - arm / 2), seatY + 0.1, 0);
      break;
    }
    case "desk":
    case "meeting_table": {
      const top = 0.05;
      box(w, top, d, 0, h - top / 2, 0);
      for (const side of [-1, 1]) box(0.05, h - top, d * 0.94, side * (w / 2 - 0.06), (h - top) / 2, 0);
      break;
    }
    default:
      box(w, h, d, 0, h / 2, 0);
  }
  return g;
}

export class FloorScene {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly nav = new NavGrid(LAYOUT);
  private readonly avatars = new Map<Character, Avatar>();
  private readonly screens = new Map<string, ScreenRec>();
  private readonly emissive = new Map<string, THREE.MeshStandardMaterial>();
  private readonly keyMats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly clock = new THREE.Clock();
  private readonly hemi: THREE.HemisphereLight;
  private readonly alarm: THREE.PointLight;
  private frame: FloorFrame | null = null;
  private appliedAt = 0;
  private lines: DialogueLine[] = [];
  private lineIdx = -1;
  private lineEndsAt = 0;
  private speed = 1;
  private raf = 0;
  private visible = true;
  private disposed = false;
  private resizeObs: ResizeObserver | null = null;
  private interObs: IntersectionObserver | null = null;
  private camGoal: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private preset: CameraPreset = "overview";
  private lastClockDraw = 0;
  private wbReveal = 1;
  private wbFull: HTMLCanvasElement | null = null;
  private time = 0;
  private readonly opts: FloorSceneOptions;
  private downAt: { x: number; y: number } | null = null;

  constructor(container: HTMLElement, opts: FloorSceneOptions = {}) {
    this.container = container;
    this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    const mobile = window.matchMedia?.("(max-width: 640px)").matches ?? false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";

    this.scene.background = new THREE.Color("#0b1220");
    const cam = LAYOUT.camera.overview!;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.position.set(...cam.pos);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...cam.target);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = 1.42;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 48;
    this.controls.addEventListener("start", () => {
      this.camGoal = null;
      if (this.preset === "follow") this.preset = "overview";
    });

    this.hemi = new THREE.HemisphereLight(0xe0ecff, 0x2a2a33, 0.95);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(10, 22, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 16, bottom: -16, near: 1, far: 70 });
    sun.shadow.bias = -0.0004;
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.set(-2, 0, -1);
    this.scene.add(sun, sun.target);
    for (const [x, z] of [
      [-7, -1],
      [8, -4],
      [-6.5, -7.5],
      [-8.5, 5.5],
    ] as V2[]) {
      const lamp = new THREE.PointLight(0xffe2b8, 9, 11, 1.6);
      lamp.position.set(x, 3.2, z);
      this.scene.add(lamp);
    }
    this.alarm = new THREE.PointLight(0xff2222, 0, 16, 1.4);
    this.alarm.position.set(-7, 3.3, -1);
    this.scene.add(this.alarm);

    this.buildScreens();
    for (const who of CREW_ORDER) {
      const a = new Avatar(who, this.nav);
      if (who === "Vince") a.onSlam = () => this.flashKey("key_Vince");
      this.avatars.set(who, a);
      this.scene.add(a.root);
    }
    void this.loadEnvironment();

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.interObs = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
    });
    this.interObs.observe(container);
    this.renderer.domElement.addEventListener("pointerdown", this.onDown);
    this.renderer.domElement.addEventListener("pointerup", this.onUp);
    this.resize();
    this.loop();
    // Dev-only handle for poking the scene from a browser console or a headless check.
    if (import.meta.env.DEV) (window as unknown as { __floor?: FloorScene }).__floor = this;
  }

  /* environment */

  private async loadEnvironment() {
    try {
      const gltf = await new GLTFLoader().loadAsync("/floor/office.glb");
      if (this.disposed) return;
      const root = gltf.scene;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const std = mat as THREE.MeshStandardMaterial;
          if (/glass|lens/i.test(std.name)) {
            std.transparent = true;
            std.depthWrite = false;
            m.castShadow = false;
          }
        }
      });
      this.scene.add(root);
      this.attachScreens(root, true);
      this.attachEmissives(root);
      this.opts.onEnvironment?.("glb");
    } catch {
      if (this.disposed) return;
      const root = this.buildFallback();
      this.scene.add(root);
      this.attachScreens(root, false);
      this.attachEmissives(root);
      this.opts.onEnvironment?.("fallback");
    }
    if (this.frame) this.drawAll(this.frame);
  }

  /** The same floor plan from boxes, when the Blender GLB is not there. */
  private buildFallback(): THREE.Group {
    const g = new THREE.Group();
    const std = (hex: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.75, ...extra });
    for (const r of LAYOUT.rooms) {
      const w = r.x[1] - r.x[0];
      const d = r.z[1] - r.z[0];
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std(FLOOR_COLORS[r.floor] ?? "#334155"));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set((r.x[0] + r.x[1]) / 2, 0, (r.z[0] + r.z[1]) / 2);
      floor.receiveShadow = true;
      g.add(floor);
    }
    const wallMat = std("#d6d3cd");
    const glassMat = std("#9cc3ff", { transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false });
    glassMat.name = "glass";
    for (const w of LAYOUT.walls) {
      const horizontal = w.a[1] === w.b[1];
      const [lo, hi] = horizontal ? [Math.min(w.a[0], w.b[0]), Math.max(w.a[0], w.b[0])] : [Math.min(w.a[1], w.b[1]), Math.max(w.a[1], w.b[1])];
      const gaps = [...w.doors].sort((p, q) => p[0] - q[0]);
      const segs: V2[] = [];
      let cur = lo;
      for (const [a, b] of gaps) {
        if (a > cur) segs.push([cur, a]);
        cur = Math.max(cur, b);
      }
      if (cur < hi) segs.push([cur, hi]);
      for (const [a, b] of segs) {
        const len = b - a;
        const geo = new THREE.BoxGeometry(horizontal ? len : 0.12, w.height, horizontal ? 0.12 : len);
        const mesh = new THREE.Mesh(geo, w.kind === "glass" ? glassMat : wallMat);
        const mid = (a + b) / 2;
        mesh.position.set(horizontal ? mid : w.a[0], w.height / 2, horizontal ? w.a[1] : mid);
        mesh.castShadow = w.kind !== "glass";
        mesh.receiveShadow = true;
        g.add(mesh);
      }
    }
    for (const f of LAYOUT.furniture) {
      const m = fallbackPiece(f, std(FURNITURE_COLORS[f.kind] ?? "#64748b"));
      m.position.set(f.pos[0], f.onTop ?? 0, f.pos[1]);
      m.rotation.y = f.rot * DEG;
      m.name = f.id;
      if (f.kind === "keyboard") {
        const km = std("#111827");
        km.name = `mat_${f.id}`;
        m.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = km;
        });
      }
      g.add(m);
    }
    for (const s of LAYOUT.screens) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(s.size[0], s.size[1]), new THREE.MeshBasicMaterial({ color: 0x05070c }));
      plane.position.set(...s.center);
      plane.rotation.y = s.facing * DEG;
      plane.name = s.id;
      g.add(plane);
    }
    for (const e of LAYOUT.emissives) {
      const len = Math.max(Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1], e.b[2] - e.a[2]), e.thickness);
      const mat = std("#ffffff", { emissive: new THREE.Color("#ffffff"), emissiveIntensity: 1 });
      mat.name = `mat_${e.id}`;
      const geo = e.kind === "beacon" ? new THREE.SphereGeometry(e.thickness, 16, 10) : new THREE.BoxGeometry(e.thickness, e.thickness, len);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2);
      if (e.kind !== "beacon") mesh.lookAt(e.b[0], e.b[1], e.b[2]);
      mesh.name = e.id;
      g.add(mesh);
    }
    return g;
  }

  private buildScreens() {
    for (const s of LAYOUT.screens) {
      const canvas = document.createElement("canvas");
      canvas.width = s.px[0];
      canvas.height = s.px[1];
      const ctx = canvas.getContext("2d")!;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      if (s.id === "marquee") tex.wrapS = THREE.RepeatWrapping;
      this.screens.set(s.id, { id: s.id, canvas, ctx, tex, w: s.px[0], h: s.px[1] });
    }
  }

  private attachScreens(root: THREE.Object3D, fromGltf: boolean) {
    for (const rec of this.screens.values()) {
      const obj = root.getObjectByName(rec.id);
      if (!obj) continue;
      // glTF UVs put v=0 at the top of the image; a plane built here does not.
      rec.tex.flipY = !fromGltf;
      rec.tex.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({ map: rec.tex, toneMapped: false });
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = mat;
          m.castShadow = false;
        }
      });
    }
  }

  private attachEmissives(root: THREE.Object3D) {
    // Exact names: "led_urgency" is a prefix of "led_urgency_front".
    const named = (o: THREE.Object3D, id: string) => {
      for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.name === id) return true;
      return false;
    };
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      const name = `${m.name} ${mat?.name ?? ""}`;
      for (const e of LAYOUT.emissives) {
        if (named(m, e.id) || mat?.name === `mat_${e.id}`) {
          const own = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color("#38bdf8"), emissiveIntensity: 2 });
          m.material = own;
          this.emissive.set(e.id, own);
        }
      }
      const key = /key_(Jax|Nova|Gemma|Sterling|Vince)/.exec(name);
      if (key) {
        const own = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.4, emissive: new THREE.Color("#22d3ee"), emissiveIntensity: 0 });
        m.material = own;
        this.keyMats.set(`key_${key[1]}`, own);
      }
    });
  }

  private flashKey(id: string) {
    const m = this.keyMats.get(id);
    if (m) m.emissiveIntensity = 4;
  }

  /* frames */

  /**
   * A new cycle: move people, redraw the screens and — unless `talk` is
   * false — start its meeting from the first line. `talk: false` is a quiet
   * refresh of the same story: people and screens follow the cycle, nobody
   * repeats themselves.
   */
  apply(frame: FloorFrame, speed = 1, talk = true) {
    this.frame = frame;
    this.speed = speed;
    this.appliedAt = this.time;
    const out = frame.output;
    const used = new Map<string, number>();
    for (const who of CREW_ORDER) {
      const a = this.avatars.get(who)!;
      const zone = out.room_state.character_locations[who];
      const act = frame.acts?.[who] ?? null;
      const t = this.targetFor(who, zone, act, used);
      a.goTo(t, this.nav);
    }
    this.drawAll(frame);
    if (talk) {
      this.lines = out.floor_dialogue_and_meetings;
      this.lineIdx = -1;
      this.lineEndsAt = this.time;
      this.wbReveal = 0;
    } else this.revealWhiteboard(1);
  }

  setSpeed(speed: number) {
    this.speed = speed;
  }

  private targetFor(who: Character, zone: string, act: AgentAct | null, used: Map<string, number>): Target {
    const spotId = zone === "WATERCOOLER" && act?.spot ? act.spot : null;
    let anchor: Anchor | undefined = spotId ? LAYOUT.spots[spotId] : LAYOUT.anchors[zone]?.[who];
    let key = spotId ? `spot:${spotId}` : `${zone}`;
    if (!anchor) {
      anchor = LAYOUT.anchors[zone]?.[who] ?? Object.values(LAYOUT.anchors).find((z) => z[who]?.pose === "sit")?.[who];
      key = zone;
    }
    const a = anchor!;
    // Two people at one spot stand side by side, not inside each other.
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    const yaw = yawTo(a.pos, a.look);
    const side = n === 0 ? 0 : (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 0.75;
    const pos: V2 = [a.pos[0] + Math.cos(yaw) * side, a.pos[1] - Math.sin(yaw) * side];
    const pose = n > 0 && a.pose === "couch" ? "stand" : a.pose;
    return { pos, yaw, pose, key: `${key}:${n}` };
  }

  setCamera(p: CameraPreset) {
    this.preset = p;
    if (p === "follow") return;
    const c = LAYOUT.camera[p] ?? LAYOUT.camera.overview!;
    this.camGoal = { pos: new THREE.Vector3(...c.pos), target: new THREE.Vector3(...c.target) };
  }

  /** Jump to a line of the meeting (the transcript's click). */
  focusLine(i: number) {
    const k = Math.floor(i);
    if (k < 0 || k >= this.lines.length) return;
    this.lineIdx = k - 1;
    this.lineEndsAt = this.time;
  }

  private drawAll(f: FloorFrame) {
    const clockMs = this.clockMs();
    for (const rec of this.screens.values()) {
      if (rec.id === "whiteboard") {
        this.wbFull ??= document.createElement("canvas");
        this.wbFull.width = rec.w;
        this.wbFull.height = rec.h;
        drawScreen(rec.id, this.wbFull.getContext("2d")!, rec.w, rec.h, f, clockMs);
        continue;
      }
      if (drawScreen(rec.id, rec.ctx, rec.w, rec.h, f, clockMs)) rec.tex.needsUpdate = true;
    }
    // LEDs follow the room's urgency.
    const col = new THREE.Color(URGENCY_COLOR[f.output.room_state.market_urgency] ?? "#38bdf8");
    for (const [id, m] of this.emissive) if (id !== "rack_leds") m.emissive.copy(col);
  }

  /** The whiteboard is written left to right as a meeting starts. */
  private revealWhiteboard(frac: number) {
    this.wbReveal = frac;
    const wb = this.screens.get("whiteboard");
    if (!wb || !this.wbFull) return;
    wb.ctx.fillStyle = "#f8fafc";
    wb.ctx.fillRect(0, 0, wb.w, wb.h);
    const w = Math.max(1, Math.floor(wb.w * frac));
    wb.ctx.drawImage(this.wbFull, 0, 0, w, wb.h, 0, 0, w, wb.h);
    wb.tex.needsUpdate = true;
  }

  private clockMs(): number {
    if (!this.frame) return Date.now();
    return this.frame.screens.synthetic ? this.frame.nowMs + (this.time - this.appliedAt) * 1000 : Date.now();
  }

  /* loop */

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible || document.hidden) {
      this.clock.getDelta();
      return;
    }
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    this.tick(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private tick(dt: number) {
    const t = this.time;
    // The meeting, one line at a time.
    if (this.lines.length && t >= this.lineEndsAt && this.lineIdx < this.lines.length) {
      this.lineIdx++;
      const line = this.lines[this.lineIdx] ?? null;
      for (const a of this.avatars.values()) {
        a.speaking = Boolean(line && a.who === line.character);
        a.say(a.speaking && line ? line.text : null);
      }
      if (line) {
        const words = line.text.split(/\s+/).length;
        this.lineEndsAt = t + Math.min(8, Math.max(2.8, 1.6 + words * 0.3)) / this.speed;
        this.opts.onSpeaker?.(this.lineIdx, line);
      } else {
        this.opts.onSpeaker?.(-1, null);
        this.opts.onMeetingDone?.();
      }
    }
    const f = this.frame;
    // Each person's motion: their line's animation while speaking, their activity otherwise.
    for (const a of this.avatars.values()) {
      const current = this.lines[this.lineIdx];
      const mine = current && current.character === a.who ? current : null;
      const last = [...this.lines.slice(0, Math.max(0, this.lineIdx + 1))].reverse().find((l) => l.character === a.who);
      const act = f?.acts?.[a.who]?.act ?? "desk";
      a.pace = (mine?.animation ?? last?.animation) === "PACING";
      a.anim = mine ? mine.animation : ambientFor(a.who, act, last?.animation ?? null);
      a.update(dt, t);
    }
    // Screens that move on their own.
    const marquee = this.screens.get("marquee");
    if (marquee) marquee.tex.offset.x = (marquee.tex.offset.x + dt * 0.035) % 1;
    if (f && t - this.lastClockDraw > 1) {
      this.lastClockDraw = t;
      const clocks = this.screens.get("clocks_Gemma");
      if (clocks && drawScreen("clocks_Gemma", clocks.ctx, clocks.w, clocks.h, f, this.clockMs())) clocks.tex.needsUpdate = true;
    }
    if (this.wbReveal < 1) this.revealWhiteboard(Math.min(1, this.wbReveal + dt / 1.6));
    // Urgency lighting.
    const urg = f?.output.room_state.market_urgency ?? "LOW";
    const pulse = urg === "HIGH_ALERT" ? 0.5 + 0.5 * Math.sin(t * 6) : urg === "MEDIUM" ? 0.75 : 0.55;
    for (const [id, m] of this.emissive) {
      if (id === "rack_leds") {
        m.emissive.setHSL(((t * 0.15) % 1) * 0.3 + 0.35, 1, 0.5);
        m.emissiveIntensity = 1 + Math.abs(Math.sin(t * 9));
      } else m.emissiveIntensity = 0.6 + 2.4 * pulse;
    }
    this.alarm.intensity = urg === "HIGH_ALERT" ? 6 + 6 * Math.sin(t * 6) : 0;
    for (const m of this.keyMats.values()) m.emissiveIntensity = damp(m.emissiveIntensity, 0, 6, dt);
    // Camera.
    if (this.preset === "follow") {
      const line = this.lines[this.lineIdx];
      const who = line ? this.avatars.get(line.character) : null;
      if (who) {
        const p = new THREE.Vector3(who.pos[0], 1.3, who.pos[1]);
        this.controls.target.lerp(p, 1 - Math.exp(-2.5 * dt));
        const want = p.clone().add(new THREE.Vector3(Math.sin(who.yaw) * 4.2 + 1.2, 2.6, Math.cos(who.yaw) * 4.2 + 1.2));
        this.camera.position.lerp(want, 1 - Math.exp(-1.6 * dt));
      }
    } else if (this.camGoal) {
      const k = 1 - Math.exp(-2.6 * dt);
      this.camera.position.lerp(this.camGoal.pos, k);
      this.controls.target.lerp(this.camGoal.target, k);
      if (this.camera.position.distanceTo(this.camGoal.pos) < 0.05) this.camGoal = null;
    }
  }

  private resize() {
    const w = this.container.clientWidth || 640;
    const h = this.container.clientHeight || 400;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private onDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY };
  };

  private onUp = (e: PointerEvent) => {
    if (!this.downAt || Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 6) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects([...this.avatars.values()].map((a) => a.root), true);
    const who = hits.find((h) => h.object.userData.character)?.object.userData.character as Character | undefined;
    if (who) this.opts.onSelect?.(who);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.interObs?.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.onDown);
    this.renderer.domElement.removeEventListener("pointerup", this.onUp);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const mat of mats) {
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      }
    });
    for (const r of this.screens.values()) r.tex.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** What a person does with their hands when they are not the one talking. */
function ambientFor(who: Character, act: string, lastAnim: Animation | null): AnimKey {
  switch (act) {
    case "coffee":
    case "cooler":
    case "desk_drink":
      return "DRINK";
    case "couch":
      return "COUCH";
    case "tv":
    case "window":
      return "WATCH";
    case "chat":
      return "TALK";
    case "phone":
    case "desk_phone":
      return "PHONE_CALL";
    case "desk_lean":
      return "LEAN_BACK";
    case "desk_stretch":
      return "STRETCH";
    case "meeting":
      // At the board they keep their last gesture going, quieter.
      if (lastAnim === "CROSSING_ARMS" || lastAnim === "WRITING_ON_WHITEBOARD" || lastAnim === "CHECKING_TABLET") return lastAnim;
      return who === "Sterling" ? "CROSSING_ARMS" : "NODDING";
    default:
      return who === "Jax" ? "FURIOUS_TYPING" : who === "Vince" || who === "Sterling" ? "STEADY_MONITORING" : who === "Nova" ? "ANALYZING" : "FURIOUS_TYPING";
  }
}
