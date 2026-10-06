/**
 * Prototype Lab avatars — Owner (Keaton) and Trading Stand Manager.
 *
 * Not Character / not in FloorScene.avatars. Presentation only.
 */

import * as THREE from "three";

export type V2 = [number, number];

const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

function makeTag(title: string, subtitle: string, color: string): THREE.Sprite {
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
  ctx.fillText(title.toUpperCase(), 30, 40);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 22px Inter, system-ui, sans-serif";
  ctx.fillText(subtitle, 30, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(1.15, 0.25, 1);
  sp.renderOrder = 10;
  return sp;
}

function makeBubble(): { sprite: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 240;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, opacity: 0 }));
  sprite.scale.set(2.7, 1.01, 1);
  sprite.renderOrder = 20;
  return { sprite, canvas, tex };
}

function drawBubble(canvas: HTMLCanvasElement, tex: THREE.CanvasTexture, text: string) {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 640, 240);
  if (!text) {
    tex.needsUpdate = true;
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
  tex.needsUpdate = true;
}

function mat(hex: string, rough = 0.7) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: rough, metalness: 0.02 });
}

/** Playable Owner — Keaton. Dark jacket + ice/teal accent (no purple). */
export class OwnerAvatar {
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
  readonly tag: THREE.Sprite;
  readonly height = 1.78;
  readonly hipH: number;
  pos: V2;
  /** Floor height under the Owner (the balcony deck, the stairs); 0 on the office floor. */
  elevation = 0;
  yaw = 0;
  moving = false;
  /** Chunk C item 25 — seated on the balcony chair. */
  seated = false;
  private walkPhase = 0;
  private bodyY = 0;

  constructor(start: V2, look: V2) {
    const s = this.height / 1.75;
    const b = 1.05;
    this.hipH = 0.92 * s;
    const skin = mat("#e8c4a0", 0.55);
    const top = mat("#1e293b"); // dark jacket
    const accent = mat("#2dd4bf", 0.4); // ice/teal
    const bottom = mat("#0f172a");
    const shoes = mat("#020617", 0.5);
    const hair = mat("#1c1917", 0.85);
    const dark = mat("#0b0f19", 0.4);
    const shadowed = (m: THREE.Mesh) => {
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    const capsule = (r: number, len: number, m: THREE.Material) => shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), m));

    this.root.add(this.body);
    const hips = new THREE.Group();
    hips.position.y = this.hipH;
    this.body.add(hips);
    const pelvis = capsule(0.13 * b, 0.1 * b, bottom);
    pelvis.rotation.z = Math.PI / 2;
    pelvis.scale.set(1, 1, 0.85);
    hips.add(pelvis);
    hips.add(this.spine);
    const torso = capsule(0.165 * b, 0.28 * s, top);
    torso.position.y = 0.28 * s;
    torso.scale.set(1, 1, 0.72);
    this.spine.add(torso);
    // Teal lapel accent stripe
    const lapel = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22 * s, 0.02), accent));
    lapel.position.set(-0.12 * b, 0.32 * s, 0.12);
    this.spine.add(lapel);
    const neck = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.1, 10), skin));
    neck.position.y = 0.52 * s;
    this.spine.add(neck);
    this.head.position.y = 0.58 * s;
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
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.138, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairCap.position.set(0, 0.125, -0.01);
    hairCap.castShadow = true;
    this.head.add(hairCap);

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
      el.add(hand);
    };
    armSide(this.shL, this.elL, 1);
    armSide(this.shR, this.elR, -1);
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
      shoe.position.set(0, -0.44 * s, 0.05);
      kn.add(shoe);
    };
    legSide(this.hipL, this.knL, 1);
    legSide(this.hipR, this.knR, -1);

    this.tag = makeTag("Keaton", "Owner · Floor", "#2dd4bf");
    this.root.add(this.tag);
    this.root.traverse((o) => {
      o.userData.proto = "owner";
    });

    this.pos = [...start];
    this.yaw = Math.atan2(look[0] - start[0], look[1] - start[1]);
    this.root.position.set(this.pos[0], 0, this.pos[1]);
    this.root.rotation.y = this.yaw;
  }

  /** Sit / stand on the balcony chair (Chunk C item 25). */
  setSeated(on: boolean) {
    this.seated = on;
    if (on) this.moving = false;
  }

  /** Try a world step; caller supplies walkability. Standing only — seated Owner must stand first. */
  tryMove(dx: number, dz: number, walkable: (x: number, z: number) => boolean): boolean {
    if (this.seated) {
      this.moving = false;
      return false;
    }
    if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) {
      this.moving = false;
      return false;
    }
    const nx = this.pos[0] + dx;
    const nz = this.pos[1] + dz;
    if (!walkable(nx, nz)) {
      // Slide on axes
      if (walkable(nx, this.pos[1])) {
        this.pos = [nx, this.pos[1]];
        this.yaw = Math.atan2(dx, 0.0001);
        this.moving = true;
        return true;
      }
      if (walkable(this.pos[0], nz)) {
        this.pos = [this.pos[0], nz];
        this.yaw = Math.atan2(0.0001, dz);
        this.moving = true;
        return true;
      }
      this.moving = false;
      return false;
    }
    this.pos = [nx, nz];
    this.yaw = Math.atan2(dx, dz);
    this.moving = true;
    return true;
  }

  update(dt: number, t: number) {
    if (this.moving && !this.seated) this.walkPhase += dt * 1.35 * 4.4;
    else if (!this.seated) this.moving = false;
    this.root.position.set(this.pos[0], this.elevation, this.pos[1]);
    this.root.rotation.y = this.yaw;
    const k = 1 - Math.exp(-12 * dt);
    const setR = (g: THREE.Object3D, rx: number, ry = 0, rz = 0) => {
      g.rotation.x += (rx - g.rotation.x) * k;
      g.rotation.y += (ry - g.rotation.y) * k;
      g.rotation.z += (rz - g.rotation.z) * k;
    };
    if (this.seated) {
      const seat = 0.47 - this.hipH;
      this.bodyY = damp(this.bodyY, seat, 10, dt);
      setR(this.hipL, -1.5);
      setR(this.hipR, -1.5);
      this.knL.rotation.x += (1.5 - this.knL.rotation.x) * k;
      this.knR.rotation.x += (1.5 - this.knR.rotation.x) * k;
      setR(this.shL, -0.55 + 0.04 * Math.sin(t * 1.2), 0, 0.06);
      setR(this.shR, -0.5 + 0.04 * Math.sin(t * 1.2 + 1), 0, -0.06);
      this.elL.rotation.x += (-0.9 - this.elL.rotation.x) * k;
      this.elR.rotation.x += (-0.85 - this.elR.rotation.x) * k;
      setR(this.spine, 0.08 + 0.02 * Math.sin(t * 1.1));
      this.body.position.y = this.bodyY;
      this.tag.position.y = this.bodyY + this.height + 0.23;
      return;
    }
    if (this.moving) {
      const s = Math.sin(this.walkPhase);
      setR(this.hipL, 0.55 * s);
      setR(this.hipR, -0.55 * s);
      this.knL.rotation.x += ((0.15 + 0.75 * Math.max(0, Math.cos(this.walkPhase))) - this.knL.rotation.x) * k;
      this.knR.rotation.x += ((0.15 + 0.75 * Math.max(0, -Math.cos(this.walkPhase))) - this.knR.rotation.x) * k;
      setR(this.shL, -0.4 * s, 0, 0.08);
      setR(this.shR, 0.4 * s, 0, -0.08);
      this.elL.rotation.x += (-0.3 - this.elL.rotation.x) * k;
      this.elR.rotation.x += (-0.3 - this.elR.rotation.x) * k;
      setR(this.spine, 0.05);
      this.bodyY = damp(this.bodyY, 0.03 * Math.abs(Math.cos(this.walkPhase)), 10, dt);
    } else {
      setR(this.hipL, 0);
      setR(this.hipR, 0);
      this.knL.rotation.x += (0 - this.knL.rotation.x) * k;
      this.knR.rotation.x += (0 - this.knR.rotation.x) * k;
      setR(this.shL, 0.05 * Math.sin(t * 1.1), 0, 0.05);
      setR(this.shR, 0.05 * Math.sin(t * 1.1 + 1), 0, -0.05);
      this.elL.rotation.x += (-0.15 - this.elL.rotation.x) * k;
      this.elR.rotation.x += (-0.15 - this.elR.rotation.x) * k;
      setR(this.spine, 0.02 * Math.sin(t * 1.3));
      this.bodyY = damp(this.bodyY, 0, 10, dt);
    }
    this.body.position.y = this.bodyY;
    this.tag.position.y = this.bodyY + this.height + 0.23;
  }
}

const MOOD_GLOW: Record<string, number> = {
  WAIT: 0x3b5bdb,
  STALKING: 0xf59e0b,
  ARMED: 0x14b8a6,
  ENTER: 0x22c55e,
};

/** Trading Stand Manager — seated at Chair's desk. Distinct from the five crew. */
/**
 * The Manager's account monitor: a small plate beside the stand with
 * Trading Stand's managerAccountLine. Red (the veto red) when the envelope
 * cannot fill; a SNAPSHOT tag when the block is not a live read.
 */
function makePlate(): { sprite: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 150;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.9, 0.445, 1);
  sprite.renderOrder = 11;
  sprite.visible = false;
  return { sprite, canvas, tex };
}

function drawPlate(
  canvas: HTMLCanvasElement,
  tex: THREE.CanvasTexture,
  a: { who: string; line: string; blocked: boolean; snapshot: string | null },
) {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 640, 150);
  const c = a.blocked ? "#ef4444" : "#14b8a6";
  ctx.fillStyle = a.blocked ? "rgba(60,8,8,0.92)" : "rgba(6,24,24,0.9)";
  ctx.beginPath();
  ctx.roundRect(4, 4, 632, 142, 16);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = c;
  ctx.stroke();
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "700 26px Inter, system-ui, sans-serif";
  ctx.fillText(`RH ${a.who}`, 24, 44);
  if (a.snapshot) {
    ctx.font = "800 20px Inter, system-ui, sans-serif";
    const w = ctx.measureText(a.snapshot.toUpperCase()).width + 20;
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(616 - w, 20, w, 32);
    ctx.fillStyle = "#111";
    ctx.fillText(a.snapshot.toUpperCase(), 626 - w, 44);
  }
  ctx.fillStyle = c;
  ctx.font = "800 30px Inter, system-ui, sans-serif";
  let line = a.line;
  while (ctx.measureText(line).width > 596 && line.length > 4) line = `${line.slice(0, -2)}…`;
  ctx.fillText(line, 24, 100);
  tex.needsUpdate = true;
}

export class ManagerAvatar {
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
  private readonly markMat: THREE.MeshStandardMaterial;
  private readonly ringMat: THREE.MeshStandardMaterial;
  readonly tag: THREE.Sprite;
  readonly bubble: THREE.Sprite;
  private readonly bubbleCanvas: HTMLCanvasElement;
  private readonly bubbleTex: THREE.CanvasTexture;
  private bubbleText = "";
  private showBubble = false;
  readonly plate: THREE.Sprite;
  private readonly plateCanvas: HTMLCanvasElement;
  private readonly plateTex: THREE.CanvasTexture;
  private plateKey = "";
  readonly height = 1.72;
  readonly hipH: number;
  pos: V2;
  yaw = 0;
  private bodyY = 0;

  constructor(desk: { pos: V2; look: V2 }) {
    const s = this.height / 1.75;
    const b = 1.0;
    this.hipH = 0.92 * s;
    const skin = mat("#c4a882", 0.55);
    const top = mat("#334155"); // slate bot body
    const accent = mat("#38bdf8", 0.35);
    const bottom = mat("#1e293b");
    const shoes = mat("#0f172a", 0.5);
    const dark = mat("#0b0f19", 0.4);
    const shadowed = (m: THREE.Mesh) => {
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    const capsule = (r: number, len: number, m: THREE.Material) => shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), m));

    this.root.add(this.body);
    const hips = new THREE.Group();
    hips.position.y = this.hipH;
    this.body.add(hips);
    const pelvis = capsule(0.13 * b, 0.1 * b, bottom);
    pelvis.rotation.z = Math.PI / 2;
    pelvis.scale.set(1, 1, 0.85);
    hips.add(pelvis);
    hips.add(this.spine);
    const torso = capsule(0.16 * b, 0.26 * s, top);
    torso.position.y = 0.27 * s;
    torso.scale.set(1, 1, 0.72);
    this.spine.add(torso);
    this.markMat = new THREE.MeshStandardMaterial({ color: "#38bdf8", emissive: "#0ea5e9", emissiveIntensity: 0.8, roughness: 0.35 });
    const mark = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.018, 0.05), this.markMat));
    mark.position.set(-0.15 * b, 0.4 * s, 0.12);
    this.spine.add(mark);
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
    // Headset
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 20, Math.PI), accent);
    band.position.y = 0.13;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), dark);
    cup.rotation.z = Math.PI / 2;
    cup.position.set(-0.14, 0.12, 0);
    const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), accent);
    mic.rotation.x = Math.PI / 2.4;
    mic.position.set(-0.12, 0.08, 0.07);
    this.head.add(band, cup, mic);
    // Mood accent ring above head
    this.ringMat = new THREE.MeshStandardMaterial({
      color: "#38bdf8",
      emissive: "#0ea5e9",
      emissiveIntensity: 1.2,
      roughness: 0.3,
      transparent: true,
      opacity: 0.85,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 24), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.36;
    this.head.add(ring);

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
      el.add(hand);
    };
    armSide(this.shL, this.elL, 1);
    armSide(this.shR, this.elR, -1);
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
      shoe.position.set(0, -0.44 * s, 0.05);
      kn.add(shoe);
    };
    legSide(this.hipL, this.knL, 1);
    legSide(this.hipR, this.knR, -1);

    this.tag = makeTag("Trading Stand", "Manager · Bot", "#38bdf8");
    this.root.add(this.tag);
    const bub = makeBubble();
    this.bubble = bub.sprite;
    this.bubbleCanvas = bub.canvas;
    this.bubbleTex = bub.tex;
    this.root.add(this.bubble);
    const pl = makePlate();
    this.plate = pl.sprite;
    this.plateCanvas = pl.canvas;
    this.plateTex = pl.tex;
    this.plate.position.set(0.95, 1.25, 0.2);
    this.root.add(this.plate);
    this.root.traverse((o) => {
      o.userData.proto = "manager";
    });

    this.pos = [...desk.pos];
    this.yaw = Math.atan2(desk.look[0] - desk.pos[0], desk.look[1] - desk.pos[1]);
    this.root.position.set(this.pos[0], 0, this.pos[1]);
    this.root.rotation.y = this.yaw;
    // Seated pose offsets applied in update
    this.bodyY = 0.47 - this.hipH;
  }

  say(text: string | null) {
    const next = text ?? "";
    if (next === this.bubbleText && this.showBubble === Boolean(text)) return;
    this.bubbleText = next;
    this.showBubble = Boolean(text);
    drawBubble(this.bubbleCanvas, this.bubbleTex, next);
  }

  /** The account monitor (null hides it). */
  setAccount(a: { who: string; line: string; blocked: boolean; snapshot: string | null } | null) {
    const key = a ? `${a.who}|${a.line}|${a.blocked}|${a.snapshot}` : "";
    if (key === this.plateKey) return;
    this.plateKey = key;
    this.plate.visible = !!a;
    if (a) drawPlate(this.plateCanvas, this.plateTex, a);
  }

  setMoodAccent(state: string) {
    const glow = MOOD_GLOW[state] ?? 0x38bdf8;
    const c = new THREE.Color(glow);
    this.markMat.color.copy(c);
    this.markMat.emissive.copy(c);
    this.ringMat.color.copy(c);
    this.ringMat.emissive.copy(c);
  }

  update(dt: number, t: number) {
    // Seated: hips bent, typing-ish arms
    const k = 1 - Math.exp(-10 * dt);
    const seat = 0.47 - this.hipH;
    this.bodyY = damp(this.bodyY, seat, 10, dt);
    this.body.position.y = this.bodyY;
    this.hipL.rotation.x += (-1.5 - this.hipL.rotation.x) * k;
    this.hipR.rotation.x += (-1.5 - this.hipR.rotation.x) * k;
    this.knL.rotation.x += (1.5 - this.knL.rotation.x) * k;
    this.knR.rotation.x += (1.5 - this.knR.rotation.x) * k;
    this.shL.rotation.x += (-1.1 + 0.08 * Math.sin(t * 4) - this.shL.rotation.x) * k;
    this.shR.rotation.x += (-1.05 + 0.08 * Math.sin(t * 4 + 1.2) - this.shR.rotation.x) * k;
    this.elL.rotation.x += (-1.2 - this.elL.rotation.x) * k;
    this.elR.rotation.x += (-1.15 - this.elR.rotation.x) * k;
    this.spine.rotation.x += (0.02 * Math.sin(t * 1.3) - this.spine.rotation.x) * k;
    this.root.position.set(this.pos[0], 0, this.pos[1]);
    this.root.rotation.y = this.yaw;
    const headY = this.bodyY + this.height + 0.05;
    this.tag.position.y = headY + 0.22;
    this.bubble.position.y = headY + 0.9;
    const bm = this.bubble.material as THREE.SpriteMaterial;
    bm.opacity = damp(bm.opacity, this.showBubble && this.bubbleText ? 1 : 0, 8, dt);
  }
}
