/**
 * The Mead Hall — a pine/iron/brass sports bar for prediction markets, as its own 3D view (the Predict tab's hall).
 *
 * The hall itself — the longship bar, the field runner, booths, the Rune Board, the screens, the crowd, the lobby with the Long
 * Table and the hearth — is `MeadHall` (mead-hall-build.ts), the same code the Floor builds its Mead Hall wing from, so the two
 * can never drift apart. This file is only the window onto it: a renderer, an orbit camera, the Owner walking with WASD, and
 * picking. Original Norse art only — no team or league marks.
 *
 * Interaction follows the Floor (floor-scene.ts): the canvas takes the wheel and WASD only after a click into it; Esc or a click
 * outside lets go, so the page never has its scroll hijacked. Owner (Keaton) is the Floor's own OwnerAvatar, walked with WASD while
 * focused.
 *
 * PAPER ONLY. A tap on YES / NO (jumbotron boxes, bar tap handles, a TV, a booth screen, a Rune Board row) calls `onTicket` — the tab
 * opens a paper ticket that writes the predict journal. Nothing here can reach a broker.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PredictionMarket, PredictionMarketFeedState } from "@/lib/predict/prediction-market-feed";
import type { CrowdRead } from "@/lib/predict/signal-engine";
import { HALL_BLOCKS, HALL_CAMERAS, HALL_ROOM } from "@/lib/room/mead-hall-layout";
import { OwnerAvatar } from "@/components/room/floor-proto-avatars";
import { MeadHall, type HallScreen, type MeadMood, type Reaction, type TicketSide } from "./mead-hall-build";
import { MEAD, type HallExtras } from "./mead-screens";

export type { Reaction, MeadMood, TicketSide };

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

type Box = [number, number, number, number]; // x0, z0, x1, z1

const ROOM = HALL_ROOM;
/** Things the Owner cannot walk through: the hall's original six, then the lobby's (Long Table, hearth, lectern, barrels). */
const BLOCKS: Box[] = [
  [1.6, -7, 9, -2.55], // bar + behind the bar
  [2.5, -2.55, 8.3, -1.9], // stools
  [-9, -3.7, -5.6, -1.3], // booth A
  [-9, -0.3, -5.6, 2.1], // booth B
  [-7.2, 3.3, -3.8, 5.3], // pool table
  [-9, -7, -5.2, -5.6], // rune-board corner
  ...HALL_BLOCKS.filter((b) => ["long_table", "hearth", "lectern", "barrels"].includes(b.id)).map((b) => b.box),
];

export class MeadScene {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly opts: MeadSceneOptions;
  private readonly hall: MeadHall;
  private readonly owner: OwnerAvatar;
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
  private camGoal: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;

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
    this.camera.position.set(...HALL_CAMERAS.overview.pos);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...HALL_CAMERAS.overview.target);
    this.controls.enableDamping = true;
    // No scroll hijack: zoom only while focused (click) or with Ctrl/⌘ — Floor's rule.
    this.controls.enableZoom = false;
    this.controls.maxPolarAngle = 1.45;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 30;
    this.controls.addEventListener("start", () => (this.camGoal = null));

    this.hall = new MeadHall({ home: "standalone", mobile, onReaction: opts.onReaction, crowdDriven: opts.crowdDriven });
    this.scene.add(this.hall.root);

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

  private retag(tag: THREE.Sprite, title: string, sub: string) {
    const t = this.hall.kit.canvasTex(384, 84, (c) => {
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
    const m = tag.material as THREE.SpriteMaterial;
    m.map?.dispose();
    m.map = t.tex;
    m.needsUpdate = true;
  }

  /* ── data ── */

  /** New feed state: redraw the screens; react to price moves. Presentation only. */
  setFeed(s: PredictionMarketFeedState) {
    this.hall.setFeed(s);
  }

  /** The Ledger / Long Table extras (crowd, board counts, record). Strings and numbers the engine already made. */
  setExtras(x: HallExtras) {
    this.hall.setExtras(x);
  }

  /**
   * Analyzer mode: react to the signal engine's CrowdRead for one board read (`key` = board asOf). Real velocity only — a
   * quiet/mixed read stays silent, and the same read never reacts twice.
   */
  setCrowd(crowd: CrowdRead, key: string) {
    this.hall.setCrowd(crowd, key);
  }

  /** Make the crowd react (also used by the tab's preview buttons). */
  react(kind: Reaction) {
    this.hall.react(kind);
  }

  getMood(): MeadMood {
    return this.hall.getMood();
  }

  /* ── interaction ── */

  private rayAt(e: { clientX: number; clientY: number }): THREE.Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray;
  }

  private screenHit(e: { clientX: number; clientY: number }): { sc: HallScreen; uv: THREE.Vector2 } | null {
    const hits = this.rayAt(e).intersectObjects(this.hall.screens.map((s) => s.mesh), false);
    const h = hits[0];
    if (!h || !h.uv) return null;
    const sc = this.hall.screens.find((s) => s.mesh === h.object);
    return sc ? { sc, uv: h.uv } : null;
  }

  private onDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY };
  };

  private onUp = (e: PointerEvent) => {
    if (!this.downAt || Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 6) return;
    const hit = this.screenHit(e);
    if (!hit) return;
    const t = this.hall.ticketFor(hit.sc, hit.uv);
    if (t) this.opts.onTicket?.(t.id, t.side);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    const now = performance.now();
    if (now - this.hoverAt < 100) return;
    this.hoverAt = now;
    const hit = this.screenHit(e);
    const t = hit ? this.hall.ticketFor(hit.sc, hit.uv) : null;
    let label: string | null = null;
    if (hit && t) {
      const m = this.hall.getState().markets.find((x) => x.id === t.id);
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
  look(where: "overview" | "jumbotron" | "board" | "bar" | "table" | "hearth" | "door") {
    const c = HALL_CAMERAS[where];
    this.camGoal = { pos: new THREE.Vector3(...c.pos), target: new THREE.Vector3(...c.target) };
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

  private time = 0;

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
    this.hall.update(dt, t);
    if (this.camGoal) {
      const k = 1 - Math.exp(-3.2 * dt);
      this.camera.position.lerp(this.camGoal.pos, k);
      this.controls.target.lerp(this.camGoal.target, k);
      if (this.camera.position.distanceTo(this.camGoal.pos) < 0.03) this.camGoal = null;
    }
    this.controls.update();
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
    this.hall.dispose();
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
