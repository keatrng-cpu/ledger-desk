/**
 * The Mead Hall's own people — the bartender and the regulars. The standalone tab and the Floor show the same ones.
 * (The five from the desk are the Floor's own avatars; these are the hall's.)
 *
 * Capsule bodies, brass collar, nasal iron helm or hair, a speech bubble over the head. They sit, stand, sip, and when the crowd
 * reacts (cheer / groan / hail) they throw their arms up. Presentation only — never a signal.
 */

import * as THREE from "three";
import { MEAD, drawBubble } from "./mead-screens";
import { bakeLocal, damp, type Kit } from "./mead-hall-kit";

export type Reaction = "cheer" | "groan" | "hail";
type V2 = [number, number];

export interface PersonLook {
  shirt: string;
  skin?: string;
  pants?: string;
  helmet?: boolean;
  beard?: string;
  hair?: string;
  /** Holds a mug, and lifts it now and then. */
  mug?: boolean;
}

export class Person {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly bubble: { sprite: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture };
  private reaction: { kind: Reaction; t0: number; dur: number } | null = null;
  private bubbleUntil = 0;
  private readonly phase: number;
  private readonly mug: boolean;
  readonly seated: boolean;
  readonly height: number;
  /** Raised off the floor (a bar stool). */
  baseY = 0;

  constructor(kit: Kit, look: PersonLook, pos: V2, faceTo: V2, seated: boolean, seed = 0) {
    this.seated = seated;
    // Deterministic: a person's idle rhythm comes from where they stand, never from Math.random (the Floor must replay the same).
    this.phase = ((pos[0] * 12.9898 + pos[1] * 78.233 + seed * 3.7) % 10 + 10) % 10;
    this.mug = Boolean(look.mug);
    const skin = kit.mat(look.skin ?? "#e2b48c", 0.6);
    const shirt = kit.mat(look.shirt, 0.75);
    const pants = kit.mat(look.pants ?? "#1a3329", 0.8);
    const capsule = (r: number, l: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 10), m);
      mesh.castShadow = true;
      return mesh;
    };
    const hipY = seated ? 0.5 : 0.92;
    this.height = seated ? 1.3 : 1.75;
    this.root.add(this.body);
    this.body.position.y = hipY;
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
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 16), kit.mat(MEAD.brass, 0.4, 0.4));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.62;
    this.body.add(collar);
    this.head.position.y = 0.78;
    this.body.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 18, 14), skin);
    skull.castShadow = true;
    this.head.add(skull);
    for (const x of [-0.05, 0.05]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), kit.mat("#111"));
      eye.position.set(x, 0.02, 0.13);
      this.head.add(eye);
    }
    if (look.hair) {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.148, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), kit.mat(look.hair, 0.9));
      hair.position.y = 0.01;
      this.head.add(hair);
    }
    if (look.beard) {
      const beard = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.28, 10), kit.mat(look.beard, 0.9));
      beard.rotation.x = Math.PI;
      beard.position.set(0, -0.14, 0.06);
      this.head.add(beard);
    }
    if (look.helmet) {
      // Nasal/spectacle iron helm — no cartoon white/gold curved horns.
      const steel = kit.mat("#8a9099", 0.35, 0.75);
      const iron = kit.mat(MEAD.iron, 0.4, 0.7);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel);
      dome.position.y = 0.02;
      this.head.add(dome);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.018, 6, 20), iron);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.03;
      this.head.add(band);
      for (const side of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 16), iron);
        ring.position.set(side * 0.055, 0.0, 0.12);
        this.head.add(ring);
      }
      const nasal = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.025), steel);
      nasal.position.set(0, -0.04, 0.14);
      this.head.add(nasal);
    }
    const arm = (g: THREE.Group, side: number, withMug: boolean) => {
      g.position.set(side * 0.25, 0.56, 0);
      this.body.add(g);
      const upper = capsule(0.055, 0.28, shirt);
      upper.position.y = -0.2;
      g.add(upper);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skin);
      hand.position.y = -0.44;
      g.add(hand);
      if (withMug) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.11, 10), kit.mat("#7c5a32", 0.6));
        cup.position.set(0, -0.46, 0.07);
        g.add(cup);
        const foam = new THREE.Mesh(new THREE.CylinderGeometry(0.051, 0.051, 0.02, 10), kit.mat(MEAD.white, 0.9));
        foam.position.set(0, -0.4, 0.07);
        g.add(foam);
      }
    };
    arm(this.armL, 1, false);
    arm(this.armR, -1, this.mug);
    const bt = kit.canvasTex(512, 200, () => undefined);
    const sm = new THREE.SpriteMaterial({ map: bt.tex, transparent: true, depthTest: false, opacity: 0 });
    kit.own(sm);
    this.bubble = { ...bt, sprite: new THREE.Sprite(sm) };
    this.bubble.sprite.scale.set(1.4, 0.55, 1);
    this.bubble.sprite.position.y = this.height + 0.55;
    this.bubble.sprite.renderOrder = 20;
    this.root.add(this.bubble.sprite);
    this.root.position.set(pos[0], 0, pos[1]);
    this.root.rotation.y = Math.atan2(faceTo[0] - pos[0], faceTo[1] - pos[1]);
    // One draw per material for each joint (the head, an arm, the body), not one per capsule: the hall carries a dozen people.
    for (const g of [this.head, this.armL, this.armR, this.body]) bakeLocal(g);
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

  /** Turn to look at a point (hall frame) — a patron glancing up at the jumbotron. */
  face(to: V2) {
    this.root.rotation.y = Math.atan2(to[0] - this.root.position.x, to[1] - this.root.position.z);
  }

  update(dt: number, t: number) {
    const r = this.reaction;
    let armL = 0.12;
    let armR = -0.12;
    let armX = 0;
    let armRX = 0;
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
        armRX = -0.9;
        nod = 0.45;
      } else {
        const beat = Math.sin((t - r.t0) * 5.2);
        armL = 2.9 - 0.25 * beat;
        armR = -2.9 + 0.25 * beat;
        lift = this.seated ? 0.04 * Math.max(0, beat) : 0.1 * Math.max(0, beat);
        nod = -0.2;
      }
    } else if (this.mug) {
      // A sip now and then: the forearm comes up and the head tips back a touch.
      const s = Math.pow(Math.max(0, Math.sin(t * 0.43 + this.phase)), 14);
      armRX = -1.25 * s;
      armR = -0.12 - 0.35 * s;
      nod -= 0.12 * s;
    }
    this.armL.rotation.z = damp(this.armL.rotation.z, armL, 10, dt);
    this.armR.rotation.z = damp(this.armR.rotation.z, armR, 10, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, armX, 10, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, armRX, 10, dt);
    this.head.rotation.x = damp(this.head.rotation.x, nod, 8, dt);
    this.root.position.y = damp(this.root.position.y, this.baseY + lift, 14, dt);
    const m = this.bubble.sprite.material as THREE.SpriteMaterial;
    m.opacity = damp(m.opacity, t < this.bubbleUntil ? 1 : 0, 8, dt);
  }
}
