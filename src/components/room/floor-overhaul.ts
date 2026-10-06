/**
 * Floor 3D overhaul — Chunk A (7–15) + Chunk B school SMC (16–24) + Chunk C war-room/Owner (25–29). Set pieces at runtime:
 *
 *   7  the centre pit around the war table: a dark sunken floor with tiered rings, its rim a 24-hour session dial
 *   8  the Manager's glass corner office (walls, desk, monitors come from floor-layout.json `procedural` entries;
 *      this file draws its three monitors + phone/lever) and the Owner's balcony (deck + stairs; Owner walk/sit in the scene)
 *   9  session time-of-day on the pit rim + the hanging killzone clock (both faces)
 *   10 VIX weather inside the war room: a cloud deck, rain and lightning — only from a real VIX; none without one
 *   11 liquidity lanes on the floor east of the pit: PDH / PDL / BSL / SSL (+ the draw) per book, and the price puck
 *   12 the ticker wall over the south offices
 *   14 stat props: six banners hung round the pit
 *   15 the trophy shelf (cups on ledges) and the wall of scars, two faces of one partition in the lounge
 *   16–17 school disciples (ICT/TJR/Blake/Patty/SMC) — distinct desk plates, not celebrity looks
 *   18 school desk signature lines from live card/book only (or labelled empty / awaiting model)
 *   19 floating must-checklist from CONFLUENCE_STACK + live gate fields
 *   20 Manager-chaired debate board (Manager feed / steer; presentation)
 *   21 08:30 ET briefing beat (session/time aware)
 *   22 hit-rate ranks from lab track only — never invented
 *   23 body language prefs from minds needs + entry mood (consumed by floor-scene)
 *   24 evolving relationship arcs between desks (minds.rel)
 *   27 Manager war room: 3rd monitor + red phone (layout + draws here)
 *   28 discretion whiteboard in Manager glass office
 *   29 read-only arm lever behind glass (display of ArmSnap only)
 *
 * (13, the sound bed, lives in floor-sound.ts. 25–26 sit/stand + E 1:1 live in floor-scene / OwnerAvatar.)
 * Presentation only: every value comes from `FloorProps`
 * (src/lib/room/floor-props.ts) or the Manager feed's state; this file computes nothing the room did not.
 */

import * as THREE from "three";
import type { DiscretionRule, ManagerRoomState, ManagerSteer } from "@/lib/room/manager-feed";
import { armLeverDisplay } from "@/lib/room/arm-lever";
import { drawDiscretionBoard, drawManagerArms } from "./floor-overhaul-war";
import type { Underlier } from "@/lib/room/option-math";
import { SESSION_COLOR, sessionDial, sessionSegments, type FloorProps, type LiquidityTrack, type Plaque, type Tile, type Tone } from "@/lib/room/floor-props";
import { readRhAccount } from "@/lib/ui/rh-account";
import {
  drawBriefing,
  drawChecklist,
  drawDebateBoard,
  drawHitRanks,
  drawSchoolDeskPlate,
  drawSchoolsBoard,
  relToneColor,
} from "./floor-overhaul-school";
import type { Character } from "@/lib/room/orchestrator";
import type { BodyLang } from "@/lib/room/school-contract";

export interface OverhaulScreen {
  ctx: CanvasRenderingContext2D;
  tex: THREE.Texture;
  w: number;
  h: number;
}

type Ctx = CanvasRenderingContext2D;
const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const TONE: Record<Tone, string> = { up: "#22c55e", down: "#ef4444", flat: "#e2e8f0", warn: "#f59e0b", muted: "#64748b" };

/** Where things stand on the plan (metres; x east, z south). */
export const PIT = { x: -8, z: -1, rx: 3.5, rz: 2.75 } as const;
const RUNWAY: Record<Underlier, { x: number }> = { QQQ: { x: -3.15 }, SPY: { x: -1.5 } };
const RUNWAY_Z = { north: -4.85, south: -0.45 } as const;
const RUNWAY_W = 1.3;
const CEIL = 3.6;

function canvasTex(w: number, h: number): { canvas: HTMLCanvasElement; ctx: Ctx; tex: THREE.CanvasTexture } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas, ctx, tex };
}

function fit(ctx: Ctx, text: string, maxW: number): string {
  let s = text;
  while (s.length > 2 && ctx.measureText(s).width > maxW) s = `${s.slice(0, -2)}…`;
  return s;
}

function wrap(ctx: Ctx, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxW) line = next;
    else {
      if (line) out.push(line);
      line = w;
      if (out.length === maxLines) break;
    }
  }
  if (line && out.length < maxLines) out.push(line);
  if (out.length === maxLines && words.join(" ") !== out.join(" ")) out[maxLines - 1] = fit(ctx, `${out[maxLines - 1]}…`, maxW);
  return out;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** A two-faced hanging sign (front and back are separate planes, so neither face reads mirrored). */
interface Sign {
  root: THREE.Group;
  ctx: Ctx;
  tex: THREE.CanvasTexture;
  w: number;
  h: number;
}

function makeSign(wm: number, hm: number, px: [number, number]): Sign {
  const { ctx, tex } = canvasTex(px[0], px[1]);
  const root = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const geo = new THREE.PlaneGeometry(wm, hm);
  const front = new THREE.Mesh(geo, mat);
  front.position.z = 0.012;
  const back = new THREE.Mesh(geo, mat);
  back.rotation.y = Math.PI;
  back.position.z = -0.012;
  const core = new THREE.Mesh(new THREE.BoxGeometry(wm + 0.04, hm + 0.04, 0.02), new THREE.MeshStandardMaterial({ color: 0x0b0f17, roughness: 0.5 }));
  root.add(front, back, core);
  return { root, ctx, tex, w: px[0], h: px[1] };
}

function rod(from: THREE.Vector3, to: THREE.Vector3, mat: THREE.Material): THREE.Mesh {
  const len = from.distanceTo(to);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 6), mat);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.lookAt(to);
  m.rotateX(Math.PI / 2);
  return m;
}

interface TrackRig {
  ctx: Ctx;
  tex: THREE.CanvasTexture;
  puck: THREE.Mesh;
  puckMat: THREE.MeshBasicMaterial;
  beam: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  want: number;
  cur: number;
  live: boolean;
}

export class FloorOverhaul {
  readonly root = new THREE.Group();
  /** Lightning struck (the sound bed rolls thunder a moment later). */
  onThunder: (() => void) | null = null;

  private props: FloorProps | null = null;
  private managerState: ManagerRoomState | null = null;
  private lastSteer: ManagerSteer | null = null;
  private discretionRules: DiscretionRule[] = [];
  /** Chunk C item 29 — lever handle mesh; rotation.z mirrors ArmSnap (display only). */
  private armLeverHandle: THREE.Object3D | null = null;
  private dirty = true;
  private lastSecond = -1;
  private lastPitMin = -1;

  // 7 + 9: the pit and its session rim
  private readonly pit = canvasTex(1024, 820);
  private readonly rimMat: THREE.MeshBasicMaterial;
  private readonly innerRimMat: THREE.MeshBasicMaterial;
  private readonly todMarker: THREE.Mesh;
  private readonly todMat: THREE.MeshBasicMaterial;

  // 11
  private readonly tracks = new Map<Underlier, TrackRig>();

  // 14
  private readonly banners: Sign[] = [];

  // 10
  private readonly cloud = canvasTex(512, 256);
  private readonly cloudMat: THREE.MeshBasicMaterial;
  private readonly rain: THREE.LineSegments;
  private readonly rainPos: Float32Array;
  private readonly bolt: THREE.PointLight;
  private nextBoltAt = 8;
  private boltUntil = 0;
  private thunderAt = 0;

  // 15
  private readonly cups = new THREE.Group();
  private cupKey = "";

  // 16–18 school desk plates (hanging signs above each school desk)
  private readonly schoolPlates: { who: Character; sign: Sign }[] = [];
  // 24 relationship arcs (line segments between desk centres)
  private readonly relLines: THREE.LineSegments;
  private readonly relPos: Float32Array;

  constructor() {
    this.root.name = "floor_overhaul";
    const steel = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.6, roughness: 0.35 });

    /* 7: the pit — a sunken look painted on an ellipse (tiers, shadow, dark floor); 9: its rim is the session dial. */
    this.drawPitBase();
    const pitMat = new THREE.MeshBasicMaterial({ map: this.pit.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const pit = new THREE.Mesh(new THREE.CircleGeometry(1, 96), pitMat);
    pit.rotation.x = -Math.PI / 2;
    pit.scale.set(PIT.rx, PIT.rz, 1);
    pit.position.set(PIT.x, 0.006, PIT.z);
    pit.renderOrder = 1;
    this.root.add(pit);
    this.rimMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, toneMapped: false, transparent: true, opacity: 0.95 });
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.985, 1.0, 128), this.rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.scale.set(PIT.rx, PIT.rz, 1);
    rim.position.set(PIT.x, 0.012, PIT.z);
    rim.renderOrder = 2;
    this.innerRimMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, toneMapped: false, transparent: true, opacity: 0.45 });
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.69, 0.7, 128), this.innerRimMat);
    inner.rotation.x = -Math.PI / 2;
    inner.scale.set(PIT.rx, PIT.rz, 1);
    inner.position.set(PIT.x, 0.012, PIT.z);
    inner.renderOrder = 2;
    this.todMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.todMarker = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), this.todMat);
    this.root.add(rim, inner, this.todMarker);

    /* 11: two liquidity runways (NQ, ES) on the floor east of the pit, a glowing puck at the price. */
    for (const u of ["QQQ", "SPY"] as Underlier[]) {
      const { ctx, tex } = canvasTex(320, 1080);
      const len = RUNWAY_Z.south - RUNWAY_Z.north;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(RUNWAY_W, len),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(RUNWAY[u].x, 0.008, (RUNWAY_Z.north + RUNWAY_Z.south) / 2);
      plane.renderOrder = 1;
      const puckMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, toneMapped: false });
      const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 28), puckMat);
      puck.position.set(RUNWAY[u].x, 0.04, RUNWAY_Z.south);
      const beamMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 1.4, 16, 1, true), beamMat);
      beam.position.set(RUNWAY[u].x, 0.74, RUNWAY_Z.south);
      this.root.add(plane, puck, beam);
      this.tracks.set(u, { ctx, tex, puck, puckMat, beam, beamMat, want: 0.5, cur: 0.5, live: false });
    }

    /* 14: six stat banners hung round the pit's east half and its north/south (the west face is the board's view). */
    for (const deg of [-25, 25, -65, 65, -115, 115]) {
      const a = (deg * Math.PI) / 180;
      const x = PIT.x + (PIT.rx + 0.25) * Math.cos(a);
      const z = PIT.z + (PIT.rz + 0.25) * Math.sin(a);
      // Small and high (bottom ≈ 2.86 m) so they read as rafter banners and stay out of the Director's sightlines.
      const s = makeSign(0.56, 0.72, [328, 424]);
      s.root.position.set(x, 3.22, z);
      s.root.rotation.y = Math.atan2(x - PIT.x, z - PIT.z); // front faces out of the pit
      for (const dx of [-0.23, 0.23]) {
        const top = new THREE.Vector3(dx, 0.36, 0).applyEuler(s.root.rotation).add(s.root.position);
        this.root.add(rod(top, new THREE.Vector3(top.x, CEIL, top.z), steel));
      }
      this.root.add(s.root);
      this.banners.push(s);
    }

    /* 9: the killzone clock's housing and rods (its two faces are layout screens ovh_kz_E / ovh_kz_W). */
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.26, 1.26), new THREE.MeshStandardMaterial({ color: 0x0b0f17, roughness: 0.4 }));
    housing.position.set(-4.4, 2.45, -1.0);
    this.root.add(housing);
    for (const dz of [-0.5, 0.5]) this.root.add(rod(new THREE.Vector3(-4.4, 3.08, -1 + dz), new THREE.Vector3(-4.4, CEIL, -1 + dz), steel));

    /* 12: the ticker wall's brackets (the wall itself is the layout screen ovh_tickerwall). */
    for (const x of [-13.4, -9.0, -4.6]) this.root.add(rod(new THREE.Vector3(x, 3.25, 3.3), new THREE.Vector3(x, CEIL, 3.3), steel));

    /* 10: the weather — a cloud deck under the war-room ceiling, rain, and a lightning light. */
    this.cloudMat = new THREE.MeshBasicMaterial({ map: this.cloud.tex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    this.drawCloud();
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(13.6, 8.4), this.cloudMat);
    deck.rotation.x = Math.PI / 2;
    deck.position.set(-7.2, 3.42, -1.0);
    this.cloud.tex.wrapS = THREE.RepeatWrapping;
    this.cloud.tex.wrapT = THREE.RepeatWrapping;
    this.root.add(deck);
    const N = 520;
    this.rainPos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) this.resetDrop(i, Math.random() * 3.3);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9fb8d8, transparent: true, opacity: 0.45, depthWrite: false }));
    this.rain.visible = false;
    this.rain.frustumCulled = false;
    this.root.add(this.rain);
    this.bolt = new THREE.PointLight(0xdbe8ff, 0, 22, 1.2);
    this.bolt.position.set(PIT.x, 3.3, PIT.z);
    this.root.add(this.bolt);

    /* 15: the trophy shelf's two ledges on the partition's east face (cups are placed per trophy). */
    const ledgeMat = new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.6 });
    for (const y of [1.47, 0.55]) {
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 3.6), ledgeMat);
      ledge.position.set(7.84, y, -4.2);
      this.root.add(ledge);
    }
    this.root.add(this.cups);

    /* 16–18: school desk plates — hanging signs above each disciple desk (identity + live signature). */
    const DESKS: { who: Character; x: number; z: number; yaw: number }[] = [
      { who: "Jax", x: -11.5, z: -9.55, yaw: 0 },
      { who: "Nova", x: -6.5, z: -9.55, yaw: 0 },
      { who: "Gemma", x: -1.5, z: -9.55, yaw: 0 },
      { who: "Sterling", x: -11.5, z: 4.65, yaw: Math.PI },
      { who: "Vince", x: -6.5, z: 4.65, yaw: Math.PI },
    ];
    for (const d of DESKS) {
      const s = makeSign(0.95, 0.55, [480, 280]);
      s.root.position.set(d.x, 2.15, d.z);
      s.root.rotation.y = d.yaw;
      for (const dx of [-0.4, 0.4]) {
        const top = new THREE.Vector3(dx, 0.28, 0).applyEuler(s.root.rotation).add(s.root.position);
        this.root.add(rod(top, new THREE.Vector3(top.x, CEIL, top.z), steel));
      }
      this.root.add(s.root);
      this.schoolPlates.push({ who: d.who, sign: s });
    }

    /* 24: relationship arcs — up to 10 undirected links between desk centres. */
    const REL_MAX = 10;
    this.relPos = new Float32Array(REL_MAX * 6);
    const relGeo = new THREE.BufferGeometry();
    relGeo.setAttribute("position", new THREE.BufferAttribute(this.relPos, 3));
    this.relLines = new THREE.LineSegments(
      relGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    const relCols = new Float32Array(REL_MAX * 6);
    relGeo.setAttribute("color", new THREE.BufferAttribute(relCols, 3));
    this.relLines.frustumCulled = false;
    this.relLines.visible = false;
    this.root.add(this.relLines);
    (this as unknown as { _relCols: Float32Array })._relCols = relCols;

    /* 27–29: Manager war-room props (red phone + read-only arm lever). Monitors/board are layout screens. */
    {
      const phone = new THREE.Group();
      phone.name = "phone_Manager_mesh";
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.26), new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.45 }));
      base.position.y = 0.02;
      const handset = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.12, 4, 8), new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.4 }));
      handset.rotation.z = Math.PI / 2;
      handset.position.set(0, 0.07, 0);
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 16), new THREE.MeshStandardMaterial({ color: 0xfef2f2, roughness: 0.3 }));
      dial.position.set(0, 0.05, 0.06);
      phone.add(base, handset, dial);
      phone.position.set(-0.75, 0.75, 1.55);
      phone.rotation.y = Math.PI / 2;
      this.root.add(phone);

      const leverRoot = new THREE.Group();
      leverRoot.name = "lever_Manager_mesh";
      leverRoot.position.set(0.55, 0, 0.85);
      leverRoot.rotation.y = -Math.PI / 2;
      const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.55, 0.22), new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.4, roughness: 0.45 }));
      pedestal.position.y = 0.275;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.26), new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.5, roughness: 0.35 }));
      plate.position.y = 0.57;
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.55, 0.04),
        new THREE.MeshStandardMaterial({ color: 0x9cc3ff, transparent: true, opacity: 0.22, depthWrite: false }),
      );
      glass.position.set(0, 0.85, 0.14);
      const pivot = new THREE.Group();
      pivot.position.set(0, 0.62, 0);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 10), new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.7, roughness: 0.25 }));
      shaft.position.y = 0.21;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x7f1d1d, emissiveIntensity: 0.35, roughness: 0.35 }));
      knob.position.y = 0.44;
      pivot.add(shaft, knob);
      pivot.rotation.z = (-35 * Math.PI) / 180;
      this.armLeverHandle = pivot;
      const label = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.01), new THREE.MeshStandardMaterial({ color: 0x0f172a }));
      label.position.set(0, 0.18, 0.12);
      leverRoot.add(pedestal, plate, glass, pivot, label);
      this.root.add(leverRoot);
    }

    this.root.traverse((o) => {
      o.userData.overhaul = true;
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
  }

  setProps(p: FloorProps | null, signature: string) {
    this.props = p;
    this.dirty = true;
    void signature;
  }

  setManager(s: ManagerRoomState | null, steer: ManagerSteer | null = null, rules: DiscretionRule[] | null = null) {
    this.managerState = s;
    this.lastSteer = steer;
    this.discretionRules = rules ?? [];
    this.dirty = true;
  }

  /** Chunk B body-language prefs for floor-scene ambient poses. */
  bodyLang(): BodyLang[] {
    return this.props?.school.body ?? [];
  }

  /* ── per frame ─────────────────────────────────────────────────────────── */

  update(dt: number, t: number, clockMs: number) {
    const p = this.props;
    const dial = sessionDial(clockMs, p?.clock ?? null);
    // 9: the rim breathes in its session colour; brighter and pulsing inside a killzone.
    const col = new THREE.Color(dial.color);
    this.rimMat.color.copy(col);
    this.innerRimMat.color.copy(col);
    this.rimMat.opacity = dial.inKillzone ? 0.75 + 0.25 * Math.sin(t * 3) : 0.55;
    this.innerRimMat.opacity = dial.inKillzone ? 0.5 : 0.25;
    // The time-of-day marker rides the rim (00:00 ET at the north, clockwise seen from above).
    const ang = ((dial.etMin + (clockMs / 1000) % 60 / 60) / 1440) * Math.PI * 2;
    this.todMarker.position.set(PIT.x + Math.sin(ang) * PIT.rx, 0.07 + 0.02 * Math.sin(t * 4), PIT.z - Math.cos(ang) * PIT.rz);
    this.todMat.color.copy(col).lerp(new THREE.Color(0xffffff), 0.5);
    if (dial.etMin !== this.lastPitMin) {
      this.lastPitMin = dial.etMin;
      this.drawPitBase(dial.etMin);
    }

    // 11: the pucks ease to the price.
    for (const r of this.tracks.values()) {
      r.cur += (r.want - r.cur) * (1 - Math.exp(-3 * dt));
      const z = RUNWAY_Z.south - r.cur * (RUNWAY_Z.south - RUNWAY_Z.north);
      r.puck.position.z = z;
      r.beam.position.z = z;
      r.puck.visible = r.live;
      r.beam.visible = r.live;
      r.beamMat.opacity = 0.14 + 0.06 * Math.sin(t * 2.2);
    }

    // 10: weather from the VIX band. Nothing at all without a VIX.
    const wx = p?.weather ?? null;
    const k = 1 - Math.exp(-1.5 * dt);
    const wantCloud = wx ? (wx.band === "storm" ? 0.72 : wx.band === "overcast" ? 0.5 : wx.band === "cloud" ? 0.26 : 0) : 0;
    this.cloudMat.opacity += (wantCloud - this.cloudMat.opacity) * k;
    this.cloudMat.color.setHex(wx?.band === "storm" ? 0x6b7280 : wx?.band === "overcast" ? 0x9ca3af : 0xe5e7eb);
    this.cloud.tex.offset.x = (this.cloud.tex.offset.x + dt * 0.006) % 1;
    const storm = wx?.band === "storm";
    this.rain.visible = storm;
    if (storm) {
      const fall = 7.5 * dt;
      for (let i = 0; i < this.rainPos.length / 6; i++) {
        const o = i * 6;
        this.rainPos[o + 1]! -= fall;
        this.rainPos[o + 4]! -= fall;
        if (this.rainPos[o + 4]! < 0) this.resetDrop(i, 3.3);
      }
      (this.rain.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      if (t >= this.nextBoltAt) {
        this.boltUntil = t + 0.22;
        this.thunderAt = t + 0.5 + Math.random() * 0.8;
        this.nextBoltAt = t + 6 + Math.random() * 9 * (1.2 - (wx?.intensity ?? 1));
      }
    } else this.nextBoltAt = Math.max(this.nextBoltAt, t + 4);
    this.bolt.intensity = t < this.boltUntil ? (Math.sin(t * 90) > -0.2 ? 30 : 4) : 0;
    // 29: read-only arm lever pose from ArmSnap (never fires trades).
    if (this.armLeverHandle) {
      const want = (armLeverDisplay(this.managerState?.arms).angleDeg * Math.PI) / 180;
      this.armLeverHandle.rotation.z += (want - this.armLeverHandle.rotation.z) * (1 - Math.exp(-4 * dt));
    }
    if (this.thunderAt && t >= this.thunderAt) {
      this.thunderAt = 0;
      this.onThunder?.();
    }
  }

  /**
   * Redraw the overhaul's layout screens: the clock every second, the rest when the props or the Manager's state
   * changed. Returns nothing; marks textures dirty itself.
   */
  drawScreens(screens: Map<string, OverhaulScreen>, clockMs: number) {
    const sec = Math.floor(clockMs / 1000);
    const p = this.props;
    if (sec !== this.lastSecond) {
      this.lastSecond = sec;
      for (const id of ["ovh_kz_E", "ovh_kz_W"]) {
        const s = screens.get(id);
        if (s) {
          drawKillzoneClock(s.ctx, s.w, s.h, clockMs, p);
          s.tex.needsUpdate = true;
        }
      }
    }
    if (!this.dirty) return;
    this.dirty = false;
    const draw = (id: string, fn: (ctx: Ctx, w: number, h: number) => void) => {
      const s = screens.get(id);
      if (!s) return;
      s.ctx.save();
      try {
        fn(s.ctx, s.w, s.h);
      } finally {
        s.ctx.restore();
      }
      s.tex.needsUpdate = true;
    };
    draw("ovh_tickerwall", (c, w, h) => drawTickerWall(c, w, h, p));
    draw("ovh_trophies", (c, w, h) => drawTrophies(c, w, h, p?.trophies ?? null));
    draw("ovh_scars", (c, w, h) => drawScars(c, w, h, p?.scars ?? null));
    draw("ovh_mgr_0", (c, w, h) => drawManagerCall(c, w, h, this.managerState));
    draw("ovh_mgr_1", (c, w, h) => drawManagerBook(c, w, h, this.managerState));
    draw("ovh_mgr_2", (c, w, h) => drawManagerArms(c, w, h, this.managerState));
    draw("ovh_mgr_board", (c, w, h) => drawDiscretionBoard(c, w, h, this.discretionRules));
    // Chunk B boards
    const school = p?.school ?? null;
    draw("ovh_schools", (c, w, h) => drawSchoolsBoard(c, w, h, school));
    draw("ovh_checklist", (c, w, h) => drawChecklist(c, w, h, school?.checklist ?? null));
    draw("ovh_debate", (c, w, h) => drawDebateBoard(c, w, h, this.managerState, this.lastSteer));
    draw("ovh_briefing", (c, w, h) => drawBriefing(c, w, h, school?.briefing ?? null));
    draw("ovh_ranks", (c, w, h) => drawHitRanks(c, w, h, school?.ranks ?? null));
    // School desk plates
    const deskBy = new Map((school?.desks ?? []).map((d) => [d.who, d]));
    const discBy = new Map((school?.disciples ?? []).map((d) => [d.who, d]));
    for (const { who, sign } of this.schoolPlates) {
      const disc = discBy.get(who);
      if (!disc) continue;
      drawSchoolDeskPlate(sign.ctx, sign.w, sign.h, disc, deskBy.get(who) ?? null);
      sign.tex.needsUpdate = true;
    }
    this.placeRels(school?.rels ?? []);
    // Floor and hanging pieces that are not layout screens.
    for (const u of ["QQQ", "SPY"] as Underlier[]) {
      const r = this.tracks.get(u)!;
      const tr = p?.tracks[u] ?? null;
      drawTrack(r.ctx, 320, 1080, tr, u, p?.synthetic ?? false);
      r.tex.needsUpdate = true;
      r.live = Boolean(tr);
      if (tr) {
        r.want = Math.min(1, Math.max(0, tr.puck));
        const c = new THREE.Color(TONE[tr.changePct == null ? "flat" : tr.changePct >= 0 ? "up" : "down"]);
        r.puckMat.color.copy(c);
        r.beamMat.color.copy(c);
      }
    }
    const stats = p?.stats ?? [];
    this.banners.forEach((b, i) => {
      drawBanner(b.ctx, b.w, b.h, stats[i] ?? null, p?.synthetic ?? false);
      b.tex.needsUpdate = true;
    });
    this.placeCups(p?.trophies ?? []);
  }

  /* ── pieces ───────────────────────────────────────────────────────────── */

  private resetDrop(i: number, y: number) {
    const x = -13.4 + Math.random() * 11.2;
    const z = -5.1 + Math.random() * 8.2;
    const o = i * 6;
    this.rainPos[o] = x;
    this.rainPos[o + 1] = y + 0.22;
    this.rainPos[o + 2] = z;
    this.rainPos[o + 3] = x;
    this.rainPos[o + 4] = y;
    this.rainPos[o + 5] = z;
  }

  private drawCloud() {
    const { ctx } = this.cloud;
    ctx.clearRect(0, 0, 512, 256);
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 70; i++) {
      const x = rnd() * 512;
      const y = rnd() * 256;
      const r = 20 + rnd() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      for (const dx of [-512, 0, 512]) ctx.fillRect(x - r + dx, y - r, r * 2, r * 2);
    }
    this.cloud.tex.needsUpdate = true;
  }

  /** The pit floor: tiers with a shadow towards the middle, and its rim as a 24-hour dial of the sessions. */
  private drawPitBase(etMin: number | null = null) {
    const { ctx, tex } = this.pit;
    const W = 1024;
    const H = 820;
    const cx = W / 2;
    const cy = H / 2;
    ctx.clearRect(0, 0, W, H);
    const ell = (k: number) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, (W / 2) * k, (H / 2) * k, 0, 0, Math.PI * 2);
    };
    // Tiers: outer step, middle step, the floor of the pit — darker as it goes down.
    const tiers: [number, string][] = [
      [1.0, "rgba(30,36,46,0.92)"],
      [0.86, "rgba(22,27,36,0.95)"],
      [0.7, "rgba(14,18,25,0.97)"],
    ];
    for (const [k, c] of tiers) {
      ell(k);
      ctx.fillStyle = c;
      ctx.fill();
      // A lit lip on each step and its shadow just inside.
      ell(k);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(148,163,184,0.35)";
      ctx.stroke();
      ell(k - 0.012);
      ctx.lineWidth = 8;
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.stroke();
    }
    // The session dial on the outer step: each session an arc, the killzones bright, the hours ticked.
    const segs = sessionSegments();
    const toAng = (m: number) => (m / 1440) * Math.PI * 2 - Math.PI / 2; // 00:00 at the top (north)
    const band = (k: number, w: number, a0: number, a1: number, color: string) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, (W / 2) * k, (H / 2) * k, 0, a0, a1);
      ctx.lineWidth = w;
      ctx.strokeStyle = color;
      ctx.stroke();
    };
    for (const s of segs) {
      const a0 = toAng(s.start);
      const a1 = toAng(s.end < s.start ? s.end + 1440 : s.end);
      band(0.93, s.killzone ? 30 : 14, a0, a1, `${SESSION_COLOR[s.id]}${s.killzone ? "cc" : "66"}`);
    }
    ctx.fillStyle = "rgba(226,232,240,0.75)";
    ctx.font = `700 22px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let hr = 0; hr < 24; hr += 3) {
      const a = toAng(hr * 60);
      ctx.fillText(String(hr).padStart(2, "0"), cx + Math.cos(a) * (W / 2) * 0.8, cy + Math.sin(a) * (H / 2) * 0.8);
    }
    for (const s of segs.filter((x) => x.killzone)) {
      const mid = s.start + ((s.end - s.start + 1440) % 1440) / 2;
      const a = toAng(mid);
      ctx.fillStyle = SESSION_COLOR[s.id];
      ctx.font = `800 20px ${FONT}`;
      ctx.fillText(s.label, cx + Math.cos(a) * (W / 2) * 0.865, cy + Math.sin(a) * (H / 2) * 0.865);
    }
    if (etMin != null) {
      const a = toAng(etMin);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (W / 2) * 0.72, cy + Math.sin(a) * (H / 2) * 0.72);
      ctx.lineTo(cx + Math.cos(a) * (W / 2) * 0.99, cy + Math.sin(a) * (H / 2) * 0.99);
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();
    }
    ctx.textAlign = "left";
    tex.needsUpdate = true;
  }


  private placeRels(rels: import("@/lib/room/school-contract").RelLink[]) {
    const DESK: Record<string, [number, number]> = {
      Jax: [-11.5, -9.2],
      Nova: [-6.5, -9.2],
      Gemma: [-1.5, -9.2],
      Sterling: [-11.5, 4.3],
      Vince: [-6.5, 4.3],
    };
    const cols = (this as unknown as { _relCols: Float32Array })._relCols;
    const max = this.relPos.length / 6;
    const n = Math.min(max, rels.length);
    for (let i = 0; i < max; i++) {
      const o = i * 6;
      if (i < n) {
        const r = rels[i]!;
        const a = DESK[r.a]!;
        const b = DESK[r.b]!;
        const y = 0.12 + r.strength * 0.25;
        this.relPos[o] = a[0]!;
        this.relPos[o + 1] = y;
        this.relPos[o + 2] = a[1]!;
        this.relPos[o + 3] = b[0]!;
        this.relPos[o + 4] = y;
        this.relPos[o + 5] = b[1]!;
        const c = new THREE.Color(relToneColor(r.tone));
        cols[o] = c.r;
        cols[o + 1] = c.g;
        cols[o + 2] = c.b;
        cols[o + 3] = c.r;
        cols[o + 4] = c.g;
        cols[o + 5] = c.b;
      } else {
        for (let k = 0; k < 6; k++) this.relPos[o + k] = 0;
      }
    }
    const geo = this.relLines.geometry;
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    geo.setDrawRange(0, n * 2);
    this.relLines.visible = n > 0;
  }

  private placeCups(trophies: Plaque[]) {
    const key = trophies.map((x) => x.title).join("|");
    if (key === this.cupKey) return;
    this.cupKey = key;
    for (const c of [...this.cups.children]) {
      this.cups.remove(c);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
    }
    const metal = [0xf5c542, 0xc0c7d1, 0xcd7f32];
    trophies.slice(0, 6).forEach((tr, i) => {
      const row = Math.floor(i / 3);
      const col = i % 3;
      const z = -4.2 + (1 - col) * 1.233; // canvas columns left→right are +z→−z on this east-facing face
      const y = row === 0 ? 1.49 : 0.57;
      const mat = new THREE.MeshStandardMaterial({ color: metal[Math.min(2, i)], metalness: 0.85, roughness: 0.25, emissive: new THREE.Color(metal[Math.min(2, i)]!), emissiveIntensity: 0.08 });
      const s = tr.source === "ghost" ? 0.8 : 1;
      const pts = [
        [0.0, 0], [0.07, 0], [0.07, 0.015], [0.025, 0.03], [0.02, 0.09], [0.045, 0.11], [0.075, 0.2], [0.08, 0.27], [0.0, 0.27],
      ].map(([r, h]) => new THREE.Vector2(r! * s, h! * s));
      const cup = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), mat);
      cup.position.set(7.86, y, z);
      cup.userData.overhaul = true;
      this.cups.add(cup);
    });
  }
}

/* ── drawing ─────────────────────────────────────────────────────────────── */

function drawKillzoneClock(ctx: Ctx, w: number, h: number, clockMs: number, p: FloorProps | null) {
  const d = sessionDial(clockMs, p?.clock ?? null);
  const cx = w / 2;
  const cy = h / 2;
  const R = w * 0.46;
  ctx.fillStyle = "#05070c";
  ctx.fillRect(0, 0, w, h);
  ctx.beginPath();
  ctx.arc(cx, cy, R + 8, 0, Math.PI * 2);
  ctx.fillStyle = "#0b1220";
  ctx.fill();
  const toAng = (m: number) => (m / 1440) * Math.PI * 2 - Math.PI / 2;
  for (const s of sessionSegments()) {
    ctx.beginPath();
    ctx.arc(cx, cy, R - (s.killzone ? 14 : 10), toAng(s.start), toAng(s.end < s.start ? s.end + 1440 : s.end));
    ctx.lineWidth = s.killzone ? 26 : 12;
    ctx.strokeStyle = `${SESSION_COLOR[s.id]}${s === d.current || s.id === d.current.id ? "ff" : s.killzone ? "aa" : "55"}`;
    ctx.stroke();
  }
  ctx.fillStyle = "#94a3b8";
  ctx.font = `700 18px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let hr = 0; hr < 24; hr += 3) {
    const a = toAng(hr * 60);
    ctx.fillText(String(hr).padStart(2, "0"), cx + Math.cos(a) * (R - 46), cy + Math.sin(a) * (R - 46));
  }
  const a = toAng(d.etMin + (Math.floor(clockMs / 1000) % 60) / 60);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * (R - 4), cy + Math.sin(a) * (R - 4));
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#f8fafc";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fillStyle = "#f8fafc";
  ctx.fill();
  // Centre: the session now, the countdown, the ET clock, the weather.
  ctx.fillStyle = d.color;
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText(d.current.label, cx, cy - 74);
  ctx.fillStyle = d.inKillzone ? "#22c55e" : "#94a3b8";
  ctx.font = `700 17px ${FONT}`;
  ctx.fillText(d.inKillzone ? `KILLZONE · ${fmtMin(d.minsLeft)} left` : d.current.killzone ? "killzone hours · market shut" : "outside the killzones", cx, cy - 44);
  ctx.fillStyle = "#e2e8f0";
  ctx.font = `700 30px ${MONO}`;
  ctx.fillText(d.clock.replace(" ET", ""), cx, cy + 40);
  ctx.fillStyle = "#94a3b8";
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText(Number.isFinite(d.next.inMin) ? `${d.next.seg.label} opens in ${fmtMin(d.next.inMin)}` : "", cx, cy + 72);
  const wx = p?.weather;
  ctx.font = `700 16px ${FONT}`;
  ctx.fillStyle = wx && wx.vix != null ? (wx.band === "storm" ? "#ef4444" : wx.band === "overcast" ? "#f59e0b" : "#cbd5e1") : "#64748b";
  ctx.fillText(wx && wx.vix != null ? `VIX ${wx.vix.toFixed(2)} · ${wx.label} · ${wx.sourceLine}` : wx ? `VIX · ${wx.sourceLine}` : "VIX · Y! · no pulse", cx, cy + 98);
  if (d.marketNote) {
    ctx.fillStyle = "#f59e0b";
    ctx.font = `700 15px ${FONT}`;
    ctx.fillText(fit(ctx, d.marketNote, R * 1.3), cx, cy + 122);
  }
  ctx.textAlign = "left";
}

function fmtMin(m: number): string {
  const mm = Math.max(0, Math.round(m));
  const hh = Math.floor(mm / 60);
  return hh > 0 ? `${hh}h ${String(mm % 60).padStart(2, "0")}m` : `${mm}m`;
}

function drawTickerWall(ctx: Ctx, w: number, h: number, p: FloorProps | null) {
  ctx.fillStyle = "#04060a";
  ctx.fillRect(0, 0, w, h);
  const tiles: Tile[] = p?.ticker ?? [];
  if (!tiles.length) {
    ctx.fillStyle = "#64748b";
    ctx.font = `700 44px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.fillText("Ticker wall — waiting for the first look at the desk", 40, h / 2);
    return;
  }
  const n = tiles.length;
  const tw = w / n;
  tiles.forEach((t, i) => {
    const x = i * tw;
    ctx.fillStyle = i % 2 ? "#070b12" : "#0a101a";
    ctx.fillRect(x, 0, tw, h);
    ctx.fillStyle = TONE[t.tone];
    ctx.fillRect(x, 0, tw, 5);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#94a3b8";
    ctx.font = `700 24px ${FONT}`;
    ctx.fillText(fit(ctx, t.label, tw - 24), x + 14, 36);
    ctx.fillStyle = TONE[t.tone] === TONE.flat ? "#f8fafc" : TONE[t.tone];
    ctx.font = `800 50px ${MONO}`;
    ctx.fillText(fit(ctx, t.value, tw - 24), x + 14, 96);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText(fit(ctx, t.sub, tw - 24), x + 14, 134);
  });
  if (p?.synthetic) {
    ctx.fillStyle = "rgba(239,68,68,0.9)";
    ctx.fillRect(w - 260, h - 34, 260, 34);
    ctx.fillStyle = "#fff";
    ctx.font = `800 22px ${FONT}`;
    ctx.fillText("SYNTHETIC FEED", w - 244, h - 10);
  }
}

function drawTrack(ctx: Ctx, w: number, h: number, tr: LiquidityTrack | null, u: Underlier, synthetic: boolean) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(6,10,16,0.78)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(148,163,184,0.35)";
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, w - 4, h - 4);
  const top = 40;
  const bottom = h - 130;
  const yOf = (pos: number) => bottom - pos * (bottom - top);
  ctx.textBaseline = "alphabetic";
  if (!tr) {
    ctx.fillStyle = "#64748b";
    ctx.font = `800 30px ${FONT}`;
    ctx.fillText(u === "QQQ" ? "NQ" : "ES", 18, h - 80);
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText("no quote — no lanes", 18, h - 46);
    return;
  }
  const COLORS: Record<string, string> = { PDH: "#38bdf8", PDL: "#38bdf8", BSL: "#22c55e", SSL: "#ef4444", DRAW: "#f59e0b" };
  for (const l of tr.lanes) {
    const y = yOf(l.pos);
    ctx.globalAlpha = l.taken ? 0.4 : 1;
    ctx.strokeStyle = COLORS[l.kind] ?? "#e2e8f0";
    ctx.lineWidth = l.kind === "DRAW" ? 4 : 8;
    ctx.setLineDash(l.taken || l.kind === "DRAW" ? [14, 10] : []);
    ctx.beginPath();
    ctx.moveTo(10, y);
    ctx.lineTo(w - 10, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS[l.kind] ?? "#e2e8f0";
    ctx.font = `800 22px ${FONT}`;
    ctx.fillText(`${l.kind}${l.taken ? " · taken" : ""}`, 14, y - 12);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = `700 20px ${MONO}`;
    const label = fit(ctx, `${l.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${l.kind === l.name ? "" : l.name}`.trim(), w - 28);
    ctx.fillText(label, 14, y + 26);
    ctx.globalAlpha = 1;
  }
  // The price line (the puck sits on it in 3D).
  const py = yOf(tr.puck);
  ctx.strokeStyle = "rgba(248,250,252,0.85)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(10, py);
  ctx.lineTo(w - 10, py);
  ctx.stroke();
  ctx.setLineDash([]);
  // Footer: the book, the price, the change, and what the desk's levels did not have.
  ctx.fillStyle = "#f8fafc";
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText(`${tr.say} · ${tr.sym}`, 16, h - 92);
  ctx.font = `800 28px ${MONO}`;
  ctx.fillStyle = tr.changePct == null ? "#e2e8f0" : tr.changePct >= 0 ? "#22c55e" : "#ef4444";
  const chg = tr.changePct == null ? "" : ` ${tr.changePct >= 0 ? "+" : "−"}${Math.abs(tr.changePct).toFixed(2)}%`;
  ctx.fillText(fit(ctx, `${tr.px.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${chg}`, w - 28), 16, h - 56);
  ctx.font = `600 18px ${FONT}`;
  ctx.fillStyle = synthetic ? "#ef4444" : "#94a3b8";
  ctx.fillText(fit(ctx, synthetic ? "SYNTHETIC FEED — not a price" : tr.missing.length ? `not in desk levels: ${tr.missing.join(", ")}` : "desk levels · pools", w - 28), 16, h - 22);
}

function drawBanner(ctx: Ctx, w: number, h: number, t: Tile | null, synthetic: boolean) {
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, w, h);
  const c = t ? TONE[t.tone] : TONE.muted;
  ctx.fillStyle = c;
  ctx.fillRect(0, 0, w, 14);
  // A pennant notch at the bottom.
  ctx.fillStyle = "#05070c";
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(w / 2, h - 40);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  if (!t) {
    ctx.fillStyle = "#64748b";
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText("—", w / 2, h / 2);
    ctx.textAlign = "left";
    return;
  }
  ctx.fillStyle = "#94a3b8";
  ctx.font = `800 28px ${FONT}`;
  wrap(ctx, t.label, w - 30, 2).forEach((l, i) => ctx.fillText(l, w / 2, 70 + i * 32));
  ctx.fillStyle = t.tone === "flat" ? "#f8fafc" : c;
  let size = 64;
  ctx.font = `800 ${size}px ${MONO}`;
  while (size > 30 && ctx.measureText(t.value).width > w - 30) {
    size -= 4;
    ctx.font = `800 ${size}px ${MONO}`;
  }
  ctx.fillText(t.value, w / 2, 210);
  ctx.fillStyle = "#cbd5e1";
  ctx.font = `600 22px ${FONT}`;
  wrap(ctx, t.sub, w - 30, 2).forEach((l, i) => ctx.fillText(l, w / 2, 262 + i * 28));
  ctx.fillStyle = synthetic ? "#ef4444" : "#475569";
  ctx.font = `700 18px ${FONT}`;
  ctx.fillText(synthetic ? "SYNTHETIC FEED" : "ROOM PAPER", w / 2, h - 58);
  ctx.textAlign = "left";
}

function drawTrophies(ctx: Ctx, w: number, h: number, list: Plaque[] | null) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#2a1d14");
  g.addColorStop(1, "#1a120c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#f5c542";
  ctx.font = `800 40px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("TROPHY SHELF", 30, 52);
  ctx.fillStyle = "#a8a29e";
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText("closed paper wins · vetoes that saved · calls graded right · gates whose refusals would have lost", 330, 50);
  const items = (list ?? []).slice(0, 6);
  if (!items.length) {
    ctx.fillStyle = "#a8a29e";
    ctx.font = `600 30px ${FONT}`;
    wrap(ctx, "Empty. The shelf fills from the room's own record — a closed paper win, a veto the re-price says saved money, a chase call the tape graded right, a gate whose refused tickets would have lost.", w - 120, 4).forEach((l, i) => ctx.fillText(l, 60, 200 + i * 44));
    return;
  }
  const cw = w / 3;
  items.forEach((t, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const x = col * cw + 24;
    const y = row === 0 ? 345 : 712; // just under each ledge (the cups stand on the ledge above the text)
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(x, y - 92, cw - 48, 108);
    ctx.fillStyle = "#f5c542";
    ctx.font = `800 28px ${FONT}`;
    ctx.fillText(fit(ctx, t.title, cw - 70), x + 12, y - 56);
    ctx.fillStyle = "#e7e5e4";
    ctx.font = `600 20px ${FONT}`;
    wrap(ctx, t.line, cw - 70, 2).forEach((l, k) => ctx.fillText(l, x + 12, y - 26 + k * 24));
  });
}

function drawScars(ctx: Ctx, w: number, h: number, list: Plaque[] | null) {
  ctx.fillStyle = "#1c1f24";
  ctx.fillRect(0, 0, w, h);
  // Concrete speckle (fixed seed — the wall looks the same every draw).
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.02 + rnd() * 0.04})`;
    ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
  }
  ctx.fillStyle = "#ef4444";
  ctx.font = `800 40px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("WALL OF SCARS", 30, 52);
  ctx.fillStyle = "#9ca3af";
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText("closed paper losses · vetoes that cost · calls graded wrong · gates whose refusals would have won", 350, 50);
  const items = (list ?? []).slice(0, 6);
  if (!items.length) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = `600 30px ${FONT}`;
    wrap(ctx, "No scars recorded yet. Every closed paper loss, costly veto, wrong call and gate that refused a winner is pinned here from the room's own record.", w - 120, 4).forEach((l, i) => ctx.fillText(l, 60, 200 + i * 44));
    return;
  }
  const cw = w / 2;
  const rh = (h - 90) / 3;
  items.forEach((t, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = col * cw + 30;
    const y = 90 + row * rh;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(x, y + 8, cw - 60, rh - 22);
    // The scratch: a few red strokes seeded by the scar itself.
    let s = hash(t.title + t.line) || 1;
    const r2 = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    ctx.strokeStyle = "rgba(239,68,68,0.75)";
    ctx.lineWidth = 4;
    for (let k = 0; k < 3; k++) {
      const sx = x + 14 + r2() * 40;
      const sy = y + 24 + r2() * (rh - 60);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 26 + r2() * 30, sy + 30 + r2() * 20);
      ctx.stroke();
    }
    ctx.fillStyle = "#fca5a5";
    ctx.font = `800 28px ${FONT}`;
    ctx.fillText(fit(ctx, t.title, cw - 190), x + 110, y + 50);
    ctx.fillStyle = "#d1d5db";
    ctx.font = `600 20px ${FONT}`;
    wrap(ctx, t.line, cw - 190, 2).forEach((l, k) => ctx.fillText(l, x + 110, y + 82 + k * 24));
  });
}

function monitorFrame(ctx: Ctx, w: number, h: number, title: string, accent: string) {
  ctx.fillStyle = "#060a12";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, w, 6);
  ctx.fillStyle = "#94a3b8";
  ctx.font = `800 20px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(title, 16, 34);
}

const PHASE_COLOR: Record<string, string> = { OPEN: "#22c55e", MANAGING: "#22c55e", CLOSING: "#f59e0b", POST: "#38bdf8", AGREED: "#14b8a6", PROPOSING: "#14b8a6", REVIEWING: "#14b8a6", BLOCKED: "#ef4444", CHAIRING: "#f59e0b", LISTENING: "#f59e0b", IDLE: "#64748b" };

function drawManagerCall(ctx: Ctx, w: number, h: number, s: ManagerRoomState | null) {
  if (!s) {
    monitorFrame(ctx, w, h, "TRADING STAND", "#64748b");
    ctx.fillStyle = "#64748b";
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText("No Manager state yet", 16, 80);
    return;
  }
  const c = PHASE_COLOR[s.current] ?? "#38bdf8";
  monitorFrame(ctx, w, h, "TRADING STAND · THE CALL", c);
  ctx.fillStyle = c;
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText(s.current, 16, 82);
  ctx.fillStyle = "#e2e8f0";
  ctx.font = `700 20px ${FONT}`;
  ctx.fillText(fit(ctx, `Floor ${s.floor.verdict} · PATH ${s.path.band ?? "—"} · ${s.path.actionable ? "actionable" : "not actionable"}`, w - 32), 16, 116);
  if (s.call) {
    ctx.fillStyle = s.call.action === "VETO" ? "#ef4444" : s.call.agentAgree ? "#22c55e" : "#f59e0b";
    ctx.font = `800 22px ${FONT}`;
    ctx.fillText(fit(ctx, `${s.call.action}${s.call.underlier ? ` · ${s.call.underlier}` : ""}${s.call.side ? ` ${s.call.side}` : ""}`, w - 32), 16, 150);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = `600 18px ${FONT}`;
    wrap(ctx, s.call.reasoning.thesis || "—", w - 32, 4).forEach((l, i) => ctx.fillText(l, 16, 180 + i * 24));
    if (s.call.reasoning.blocks.length) {
      ctx.fillStyle = "#ef4444";
      ctx.font = `700 16px ${FONT}`;
      ctx.fillText(fit(ctx, `blocks: ${s.call.reasoning.blocks.join(", ")}`, w - 32), 16, h - 16);
    }
  } else {
    ctx.fillStyle = "#64748b";
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText("No call this cycle", 16, 152);
  }
}

function drawManagerBook(ctx: Ctx, w: number, h: number, s: ManagerRoomState | null) {
  monitorFrame(ctx, w, h, "TRADING STAND · BOOK & ACCOUNT", "#14b8a6");
  if (!s) return;
  let y = 70;
  const line = (text: string, color = "#e2e8f0", font = `700 20px ${FONT}`) => {
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.fillText(fit(ctx, text, w - 32), 16, y);
    y += 28;
  };
  if (s.open) {
    const pnl = s.open.pnlUsd;
    line(`OPEN ${s.open.contracts}× ${s.open.underlier} ${s.open.side} · ${s.open.source}`, "#22c55e", `800 22px ${FONT}`);
    line(pnl != null ? `P&L ${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(0)}${s.open.pnlPct != null ? ` (${s.open.pnlPct.toFixed(1)}%)` : ""}` : "P&L — no mark", pnl == null ? "#94a3b8" : pnl >= 0 ? "#22c55e" : "#ef4444");
  } else line("No open position", "#64748b");
  if (s.close) line(`Last close: ${s.close.result.toUpperCase()} · ${s.close.label}`, s.close.result === "win" ? "#22c55e" : s.close.result === "loss" ? "#ef4444" : "#94a3b8", `600 18px ${FONT}`);
  y += 6;
  const r = readRhAccount(s.account);
  line(`RH ${r.who}`, "#94a3b8", `700 18px ${FONT}`);
  line(r.line, r.blocked ? "#ef4444" : "#14b8a6", `800 20px ${FONT}`);
  if (s.account.isSnapshot) line(`${r.freshness} — not a live read`, "#f59e0b", `600 16px ${FONT}`);
  line(`arms: autofire ${s.arms.autofireEnabled ? "on" : "off"} · live ${s.arms.liveArmed ? "armed" : "shut"}`, "#64748b", `600 16px ${FONT}`);
}
