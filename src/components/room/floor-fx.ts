/**
 * The floor's spectacle — order tickets that fly to the tape, confetti on a
 * winner, the opening and closing bell, the little icons over people's heads.
 * Visual only: every effect is triggered by something the cycle already
 * decided (a BUY_OPEN, a profitable SELL_CLOSE, 09:30 on the clock); nothing
 * here decides anything.
 */

import * as THREE from "three";

type V3 = [number, number, number];

/** A canvas-backed sprite with text — the order ticket, the emotes. */
function textSprite(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number, scale: [number, number]): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  sp.scale.set(scale[0], scale[1], 1);
  sp.renderOrder = 30;
  return sp;
}

/* ── The order ticket ───────────────────────────────────────────────────── */

export class TicketFlight {
  readonly sprite: THREE.Sprite;
  private t = 0;
  private readonly dur: number;
  private readonly from: THREE.Vector3;
  private readonly to: THREE.Vector3;
  private readonly mid: THREE.Vector3;
  done = false;

  private readonly ghost: boolean;

  constructor(text: string, style: "buy" | "sell" | "ghost" | "ghost_win" | "ghost_loss", from: V3, to: V3, dur = 1.9) {
    this.ghost = style.startsWith("ghost");
    const fill =
      style === "buy" ? "rgba(6,78,59,0.95)" : style === "sell" ? "rgba(127,29,29,0.95)" : style === "ghost_win" ? "rgba(20,83,45,0.75)" : style === "ghost_loss" ? "rgba(127,29,29,0.7)" : "rgba(76,29,149,0.6)";
    const edge = style === "buy" || style === "ghost_win" ? "#34d399" : style === "ghost" ? "#c4b5fd" : "#fca5a5";
    this.dur = dur;
    this.sprite = textSprite(
      (ctx, w, h) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.roundRect(4, 4, w - 8, h - 8, 22);
        ctx.fill();
        ctx.strokeStyle = edge;
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.fillStyle = "#f8fafc";
        ctx.font = "800 44px ui-monospace, Menlo, monospace";
        ctx.textBaseline = "middle";
        ctx.fillText(text, 26, h / 2 + 2);
      },
      768,
      120,
      [1.9, 0.3],
    );
    this.from = new THREE.Vector3(...from);
    this.to = new THREE.Vector3(...to);
    this.mid = this.from.clone().lerp(this.to, 0.5).add(new THREE.Vector3(0, 1.6, 0));
    this.sprite.position.copy(this.from);
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    const k = Math.min(1, this.t / this.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    // Quadratic Bezier up and over to the tape.
    const a = this.from.clone().lerp(this.mid, e);
    const b = this.mid.clone().lerp(this.to, e);
    this.sprite.position.copy(a.lerp(b, e));
    const pop = k > 0.85 ? 1 + (k - 0.85) * 6 : 1;
    this.sprite.scale.set(1.9 * pop, 0.3 * pop, 1);
    const base = this.ghost ? 0.75 : 1;
    (this.sprite.material as THREE.SpriteMaterial).opacity = base * (k > 0.85 ? Math.max(0, 1 - (k - 0.85) / 0.15) : 1);
    if (k >= 1) this.done = true;
  }

  dispose(): void {
    const m = this.sprite.material as THREE.SpriteMaterial;
    m.map?.dispose();
    m.dispose();
  }
}

/* ── Confetti ───────────────────────────────────────────────────────────── */

export class Confetti {
  readonly points: THREE.Points;
  private readonly vel: Float32Array;
  private t = 0;
  private readonly life = 3.6;
  done = false;

  constructor(at: V3, n = 420, seed = 1) {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    let s = seed;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const palette = [new THREE.Color("#22c55e"), new THREE.Color("#facc15"), new THREE.Color("#38bdf8"), new THREE.Color("#f472b6"), new THREE.Color("#f8fafc")];
    for (let i = 0; i < n; i++) {
      pos[i * 3] = at[0] + (rnd() - 0.5) * 0.6;
      pos[i * 3 + 1] = at[1] + rnd() * 0.3;
      pos[i * 3 + 2] = at[2] + (rnd() - 0.5) * 0.6;
      const a = rnd() * Math.PI * 2;
      const sp = 1.2 + rnd() * 2.6;
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = 2.4 + rnd() * 3.2;
      this.vel[i * 3 + 2] = Math.sin(a) * sp;
      const c = palette[Math.floor(rnd() * palette.length)]!;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, depthWrite: false }));
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    const pos = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      this.vel[i + 1] -= 6.5 * dt;
      // Paper flutters: drag on the way down.
      if (this.vel[i + 1]! < -1.2) this.vel[i + 1] = -1.2;
      a[i] += this.vel[i]! * dt * 0.6;
      a[i + 1] = Math.max(0.02, a[i + 1]! + this.vel[i + 1]! * dt);
      a[i + 2] += this.vel[i + 2]! * dt * 0.6;
    }
    pos.needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - Math.max(0, this.t - 2.4) / (this.life - 2.4));
    if (this.t >= this.life) this.done = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/* ── The bell ───────────────────────────────────────────────────────────── */

export class Bell {
  readonly root = new THREE.Group();
  private readonly swing = new THREE.Group();
  private ring = 0;

  constructor(at: [number, number]) {
    const brass = new THREE.MeshStandardMaterial({ color: "#b8860b", metalness: 0.85, roughness: 0.3 });
    const wood = new THREE.MeshStandardMaterial({ color: "#5b3a22", roughness: 0.7 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.7, 10), wood);
    post.position.y = 0.85;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.06, 18), wood);
    base.position.y = 0.03;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), wood);
    arm.position.set(0.2, 1.68, 0);
    // A bell from a profile.
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const y = i / 12;
      prof.push(new THREE.Vector2(0.03 + 0.15 * Math.pow(y, 1.6), -y * 0.24));
    }
    const bell = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), brass);
    bell.castShadow = true;
    const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), brass);
    clapper.position.y = -0.2;
    this.swing.add(bell, clapper);
    this.swing.position.set(0.38, 1.66, 0);
    this.root.add(post, base, arm, this.swing);
    this.root.position.set(at[0], 0, at[1]);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
  }

  strike(): void {
    this.ring = 3.2;
  }

  update(dt: number, t: number): void {
    if (this.ring <= 0) {
      this.swing.rotation.z *= 0.9;
      return;
    }
    this.ring = Math.max(0, this.ring - dt);
    this.swing.rotation.z = Math.sin(t * 9) * 0.5 * (this.ring / 3.2);
  }
}

/* ── Emotes ─────────────────────────────────────────────────────────────── */

export type EmoteKind = "coffee" | "sleepy" | "stress" | "money" | "ugh" | "idea" | "grudge";

/** A small icon over a head, drawn with shapes (no emoji font needed). */
export function drawEmote(ctx: CanvasRenderingContext2D, w: number, h: number, kind: EmoteKind | null): void {
  ctx.clearRect(0, 0, w, h);
  if (!kind) return;
  ctx.fillStyle = "rgba(9,13,24,0.88)";
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = w / 2;
  const cy = h / 2;
  switch (kind) {
    case "coffee": {
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(cx - 22, cy - 10, 34, 34);
      ctx.strokeStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(cx + 16, cy + 6, 10, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 3;
      for (const dx of [-12, 0]) {
        ctx.beginPath();
        ctx.moveTo(cx + dx - 4, cy - 16);
        ctx.quadraticCurveTo(cx + dx + 6, cy - 26, cx + dx - 2, cy - 36);
        ctx.stroke();
      }
      break;
    }
    case "sleepy":
      ctx.fillStyle = "#93c5fd";
      ctx.font = "900 40px ui-sans-serif, system-ui";
      ctx.fillText("Zz", cx, cy + 2);
      break;
    case "stress":
      ctx.fillStyle = "#f87171";
      ctx.font = "900 52px ui-sans-serif, system-ui";
      ctx.fillText("!!", cx, cy + 2);
      break;
    case "money":
      ctx.fillStyle = "#4ade80";
      ctx.font = "900 56px ui-sans-serif, system-ui";
      ctx.fillText("$", cx, cy + 3);
      break;
    case "ugh":
      ctx.strokeStyle = "#fca5a5";
      ctx.beginPath();
      ctx.moveTo(cx - 24, cy - 14);
      ctx.lineTo(cx - 8, cy + 2);
      ctx.moveTo(cx - 8, cy - 14);
      ctx.lineTo(cx - 24, cy + 2);
      ctx.moveTo(cx + 8, cy - 14);
      ctx.lineTo(cx + 24, cy + 2);
      ctx.moveTo(cx + 24, cy - 14);
      ctx.lineTo(cx + 8, cy + 2);
      ctx.moveTo(cx - 16, cy + 22);
      ctx.lineTo(cx + 16, cy + 22);
      ctx.stroke();
      break;
    case "idea":
      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      ctx.arc(cx, cy - 6, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - 9, cy + 10, 18, 14);
      break;
    case "grudge":
      ctx.strokeStyle = "#fb923c";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx - 24, cy - 18);
      ctx.lineTo(cx - 4, cy - 8);
      ctx.moveTo(cx + 24, cy - 18);
      ctx.lineTo(cx + 4, cy - 8);
      ctx.moveTo(cx - 16, cy + 18);
      ctx.quadraticCurveTo(cx, cy + 6, cx + 16, cy + 18);
      ctx.stroke();
      break;
  }
}
