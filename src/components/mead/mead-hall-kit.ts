/**
 * The Mead Hall's small kit: a material cache, canvas textures, and one pass that merges every static mesh by material.
 *
 * The standalone tab and the Floor build the SAME hall from the SAME code (mead-hall-build.ts). The hall is made of a few hundred
 * small meshes (bottles, rivets, shields, benches); drawn one by one that is a few hundred draw calls, which the Floor — already
 * carrying a whole office — cannot afford. `bakeStatic` merges everything that never moves into one mesh per material, so the
 * hall draws in tens of calls and looks identical.
 *
 * Presentation only.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/** One kit per hall: materials are shared by key and disposed together with the hall. */
export class Kit {
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly owned: { dispose(): void }[] = [];

  /** A shared standard material (same parameters, same instance). */
  mat(hex: string | number, rough = 0.7, metal = 0.05, emissive?: number, ei = 0): THREE.MeshStandardMaterial {
    const key = `${typeof hex === "number" ? hex.toString(16) : hex}|${rough}|${metal}|${emissive ?? "-"}|${ei}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: rough, metalness: metal });
      if (emissive != null) {
        m.emissive = new THREE.Color(emissive);
        m.emissiveIntensity = ei;
      }
      this.mats.set(key, m);
    }
    return m;
  }

  /** A material no one else shares (its texture or colour is changed later). */
  own<T extends THREE.Material>(m: T): T {
    this.owned.push(m);
    return m;
  }

  /** A canvas-backed texture the kit will dispose. */
  canvasTex(w: number, h: number, draw: (c: HTMLCanvasElement) => void): { tex: THREE.CanvasTexture; canvas: HTMLCanvasElement } {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    draw(canvas);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.owned.push(tex);
    return { tex, canvas };
  }

  track<T extends { dispose(): void }>(d: T): T {
    this.owned.push(d);
    return d;
  }

  dispose() {
    for (const m of this.mats.values()) m.dispose();
    for (const o of this.owned) o.dispose();
    this.mats.clear();
    this.owned.length = 0;
  }
}

/** Plank texture (floors, hulls). Unchanged from the standalone hall's own. */
export function woodCanvas(c: HTMLCanvasElement, base = "#5a3a1e", dark = "#3e2612") {
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

/** Mark a mesh (or a whole subtree) as one `bakeStatic` must leave alone: a screen, a tap, a flame, anything that moves or is clicked. */
export function keepLive<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => (c.userData.live = true));
  return o;
}

/** Set a three.js layer on an object and everything under it (lights and sprites included). */
export function setLayer(o: THREE.Object3D, layer: number) {
  o.traverse((c) => c.layers.set(layer));
}

/**
 * Merge every static mesh under `root` into one mesh per (material, shadow flags). Transparent, instanced, sprite, skinned and
 * `keepLive` meshes stay as they are. Geometry is baked into `root`'s frame.
 */
export function bakeStatic(root: THREE.Object3D): { before: number; after: number } {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; geoms: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  let before = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    before++;
    if (m.userData.live || Array.isArray(m.material)) return;
    const mat = m.material as THREE.Material;
    if (mat.transparent || mat.visible === false) return;
    if (!(m.geometry as THREE.BufferGeometry).getAttribute("position")) return;
    const key = `${mat.uuid}|${m.castShadow ? 1 : 0}|${m.receiveShadow ? 1 : 0}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { material: mat, cast: m.castShadow, receive: m.receiveShadow, geoms: [], meshes: [] }));
    m.updateWorldMatrix(true, false);
    let geo = m.geometry as THREE.BufferGeometry;
    geo = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") geo.deleteAttribute(name);
    if (!geo.getAttribute("uv")) geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array((geo.getAttribute("position").count || 0) * 2), 2));
    geo.clearGroups();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    g.geoms.push(geo);
    g.meshes.push(m);
  });
  let after = 0;
  for (const g of groups.values()) {
    if (g.geoms.length < 2) {
      for (const geo of g.geoms) geo.dispose();
      continue;
    }
    const merged = mergeGeometries(g.geoms, false);
    for (const geo of g.geoms) geo.dispose();
    if (!merged) continue;
    for (const m of g.meshes) {
      m.parent?.remove(m);
      m.geometry.dispose();
    }
    const out = new THREE.Mesh(merged, g.material);
    out.castShadow = g.cast;
    out.receiveShadow = g.receive;
    out.matrixAutoUpdate = false;
    out.userData.baked = true;
    root.add(out);
    after++;
  }
  // meshes left in place (live, transparent, single) still count
  let left = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData.baked) left++;
  });
  return { before, after: after + left };
}

/**
 * Merge a joint group's own mesh children by material, in the group's frame (a person's head, an arm, the body: the group still
 * turns as one, but its dozen small meshes draw as two or three). Child groups and anything `keepLive` are left alone.
 */
export function bakeLocal(group: THREE.Group): void {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; geoms: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  for (const child of group.children) {
    const m = child as THREE.Mesh;
    if (!m.isMesh || m.userData.live || Array.isArray(m.material)) continue;
    const mat = m.material as THREE.Material;
    if (mat.transparent) continue;
    const key = `${mat.uuid}|${m.castShadow ? 1 : 0}|${m.receiveShadow ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { material: mat, cast: m.castShadow, receive: m.receiveShadow, geoms: [], meshes: [] }));
    m.updateWorldMatrix(true, false);
    let geo = m.geometry as THREE.BufferGeometry;
    geo = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") geo.deleteAttribute(name);
    geo.clearGroups();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    b.geoms.push(geo);
    b.meshes.push(m);
  }
  for (const b of buckets.values()) {
    if (b.geoms.length < 2) {
      for (const g of b.geoms) g.dispose();
      continue;
    }
    const merged = mergeGeometries(b.geoms, false);
    for (const g of b.geoms) g.dispose();
    if (!merged) continue;
    for (const m of b.meshes) {
      group.remove(m);
      m.geometry.dispose();
    }
    const out = new THREE.Mesh(merged, b.material);
    out.castShadow = b.cast;
    out.receiveShadow = b.receive;
    group.add(out);
  }
}
