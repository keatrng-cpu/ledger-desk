/**
 * What the Mead Hall adds to the standalone hall's original room: the front lobby (z 7 … 11) and the dressing of a real mead hall.
 *
 *   - the Long Table with benches and a board set into it (where the five sit and argue the cents),
 *   - the hearth with a real fire and two carved armchairs,
 *   - the Skald's stand (a lectern with its own small screen),
 *   - the Skald's Ledger on the west wall (the crowd, the board, the record, the next settlement),
 *   - roof trusses with a dragon head at each end of the ridge, a longship hung over the table, an antler chandelier,
 *     pennants, a shield wall, barrels, a dartboard.
 *
 * Built into the same hall for both homes (the Predict tab and the Floor). Original Norse art only — no team or league marks.
 * Every number on a screen here is a value the engine, the ledgers or the clock already produced; nothing is computed into a signal.
 */

import * as THREE from "three";
import type { PredictionMarketFeedState } from "@/lib/predict/prediction-market-feed";
import { HALL_ROOM } from "@/lib/room/mead-hall-layout";
import type { HallScreen } from "./mead-hall-build";
import { keepLive, type Kit } from "./mead-hall-kit";
import { MEAD, drawKnotPanel, drawLectern, drawLedger, drawTabletop, type HallExtras } from "./mead-screens";

export interface HallExtrasCtx {
  kit: Kit;
  root: THREE.Group;
  screens: HallScreen[];
  lights: THREE.PointLight[];
  floorHome: boolean;
  add: <T extends THREE.Object3D>(o: T, shadow?: boolean) => T;
  box: (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry?: number) => THREE.Mesh;
}

export interface HallExtrasHandle {
  update(dt: number, t: number): void;
  redraw(state: PredictionMarketFeedState, extra: HallExtras): void;
}

const Y = new THREE.Vector3(0, 1, 0);

export function buildHallExtras(ctx: HallExtrasCtx): HallExtrasHandle {
  const { kit, root, screens } = ctx;
  const R = HALL_ROOM;
  const H = R.h;
  const wood = kit.mat("#3b2411", 0.8);
  const woodLight = kit.mat("#4a2a12", 0.7);
  const hull = kit.mat("#6b4423", 0.75);
  const dark = kit.mat("#3a2210", 0.7);
  const iron = kit.mat("#4b5159", 0.45, 0.7);
  const brass = kit.mat(MEAD.brass, 0.35, 0.6, 0x4a3000, 0.2);
  const pine = kit.mat(MEAD.pine, 0.85);
  const stone = kit.mat("#3f444d", 0.95);
  const stoneLight = kit.mat("#5a6068", 0.95);
  const cream = kit.mat("#efe3c2", 0.7);
  const flameMat = kit.mat("#ffd27a", 0.3, 0, 0xffa53a, 2.6);

  /** A rod from a to b (chains, rafters, antler tines). */
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material): THREE.Mesh => {
    const d = b.clone().sub(a);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), m);
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.quaternion.setFromUnitVectors(Y, d.clone().normalize());
    ctx.add(mesh);
    return mesh;
  };
  const cyl = (rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 12): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
    mesh.position.set(x, y, z);
    ctx.add(mesh);
    return mesh;
  };

  /* ── roof trusses: an open frame (no planks), so the camera still sees in from above ── */
  const rise = 1.7;
  const ang = Math.atan2(rise, R.x1);
  const rafterLen = Math.hypot(R.x1, rise) + 0.3;
  const cz = (R.z0 + R.z1) / 2;
  for (const z of [-6.4, -1.5, 3.4, 8.3]) {
    for (const s of [-1, 1]) {
      const r = ctx.box(rafterLen, 0.22, 0.24, wood, (s * R.x1) / 2, H + rise / 2, z);
      r.rotation.z = -s * ang;
    }
    ctx.box(0.22, rise, 0.22, wood, 0, H + rise / 2, z);
  }
  ctx.box(0.24, 0.24, R.z1 - R.z0 + 0.8, wood, 0, H + rise, cz);
  // A dragon head at each end of the ridge (the bar's prows, carved smaller, looking out of the hall).
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.5), hull);
    g.add(skull);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.42, 6), hull);
    snout.rotation.x = (Math.PI / 2) * side;
    snout.position.z = side * 0.42;
    g.add(snout);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.36), dark);
    jaw.position.set(0, -0.2, side * 0.2);
    jaw.rotation.x = side * 0.22;
    g.add(jaw);
    for (const ex of [-0.16, 0.16]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), kit.mat(MEAD.brass, 0.2, 0.2, 0xc4a35a, 2));
      eye.position.set(ex, 0.08, side * 0.16);
      g.add(eye);
    }
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.7, 8), hull);
    neck.position.set(0, -0.4, side * -0.05);
    g.add(neck);
    g.position.set(0, H + rise + 0.2, side < 0 ? R.z0 - 0.35 : R.z1 + 0.35);
    ctx.add(g);
  }

  /* ── pennants (they sway a little), shield wall, banners of knotwork ── */
  const pennantTex = kit.canvasTex(256, 512, (c) => drawKnotPanel(c, MEAD.pineDeep));
  const pennantMat = kit.own(new THREE.MeshStandardMaterial({ map: pennantTex.tex, roughness: 0.8, side: THREE.DoubleSide }));
  const pennants: THREE.Group[] = [];
  for (const [x, z] of [
    [-7.7, -1.5],
    [7.7, -1.5],
    [-7.7, 8.2],
    [7.7, 2.4],
  ] as [number, number][]) {
    const g = new THREE.Group();
    const rodTop = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 6), brass);
    rodTop.rotation.z = Math.PI / 2;
    g.add(rodTop);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 2.5), pennantMat);
    cloth.position.y = -1.3;
    g.add(cloth);
    g.position.set(x, H - 0.34, z);
    ctx.root.add(g);
    keepLive(g);
    pennants.push(g);
  }
  const shieldTex = kit.canvasTex(256, 256, (c) => {
    const x = c.getContext("2d")!;
    x.fillStyle = MEAD.pine;
    x.beginPath();
    x.arc(128, 128, 124, 0, Math.PI * 2);
    x.fill();
    x.lineWidth = 14;
    x.strokeStyle = MEAD.brass;
    x.stroke();
    x.fillStyle = MEAD.brass;
    for (let i = 0; i < 8; i++) {
      x.save();
      x.translate(128, 128);
      x.rotate((i / 8) * Math.PI * 2);
      x.fillRect(-6, -118, 12, 118);
      x.restore();
    }
    x.beginPath();
    x.arc(128, 128, 30, 0, Math.PI * 2);
    x.fillStyle = "#c0c0c0";
    x.fill();
  });
  const shieldMat = kit.own(new THREE.MeshStandardMaterial({ map: shieldTex.tex, roughness: 0.5, metalness: 0.3 }));
  const shield = (x: number, y: number, z: number, ry: number, r = 0.42) => {
    const s = new THREE.Mesh(new THREE.CircleGeometry(r, 32), shieldMat);
    s.position.set(x, y, z);
    s.rotation.y = ry;
    root.add(s);
  };
  for (const z of [-5.2, -2.6, 0.2, 2.4, 5.5, 8.5]) shield(R.x0 + 0.08, 4.5, z, Math.PI / 2);

  /* ── barrels in the south-east corner ── */
  const barrelGeo = new THREE.LatheGeometry(
    [
      [0.3, 0],
      [0.37, 0.18],
      [0.4, 0.4],
      [0.37, 0.62],
      [0.3, 0.8],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    18,
  );
  const barrel = (x: number, y: number, z: number, lying = false) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(barrelGeo, kit.mat("#6b4423", 0.8));
    g.add(body);
    for (const hy of [0.2, 0.6]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.385, 0.018, 6, 22), iron);
      hoop.rotation.x = Math.PI / 2;
      hoop.position.y = hy;
      g.add(hoop);
    }
    const lid = new THREE.Mesh(new THREE.CircleGeometry(0.3, 18), kit.mat("#4a2a12", 0.8));
    lid.rotation.x = -Math.PI / 2;
    lid.position.y = 0.801;
    g.add(lid);
    if (lying) {
      g.rotation.z = Math.PI / 2;
      g.position.set(x + 0.4, y, z);
    } else g.position.set(x, y, z);
    ctx.add(g);
  };
  barrel(8.5, 0, 10.45);
  barrel(7.7, 0, 10.45);
  barrel(7.7, 1.2, 10.45, true);
  barrel(8.55, 0, 9.85);

  /* ── the Long Table ── */
  const TX = 3.4;
  const TZ = 8.6;
  ctx.box(5.0, 0.09, 1.1, woodLight, TX, 0.82, TZ);
  for (const s of [-1, 1]) {
    ctx.box(0.14, 0.78, 0.95, dark, TX + s * 2.1, 0.39, TZ);
    ctx.box(0.7, 0.1, 1.0, dark, TX + s * 2.1, 0.05, TZ);
  }
  ctx.box(4.2, 0.1, 0.1, dark, TX, 0.34, TZ);
  ctx.box(5.0, 0.03, 0.06, brass, TX, 0.87, TZ - 0.55);
  ctx.box(5.0, 0.03, 0.06, brass, TX, 0.87, TZ + 0.55);
  for (const bz of [TZ - 1.0, TZ + 1.0]) {
    ctx.box(4.6, 0.07, 0.42, woodLight, TX, 0.46, bz);
    for (const dx of [-1.9, 0, 1.9]) ctx.box(0.1, 0.43, 0.36, dark, TX + dx, 0.22, bz);
  }
  // A woven runner under the table.
  const rugTex = kit.canvasTex(512, 256, (c) => drawKnotPanel(c, "#2a1a10"));
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 3.0), kit.own(new THREE.MeshStandardMaterial({ map: rugTex.tex, roughness: 0.95 })));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(TX, 0.013, TZ);
  rug.receiveShadow = true;
  root.add(rug);
  // Goblets and candles down the middle.
  for (const [gx, gz] of [
    [TX - 2.0, TZ - 0.32],
    [TX - 1.1, TZ + 0.36],
    [TX + 1.4, TZ - 0.36],
    [TX + 2.1, TZ + 0.3],
  ] as [number, number][]) {
    cyl(0.055, 0.04, 0.13, brass, gx, 0.935, gz, 10);
    cyl(0.05, 0.05, 0.02, kit.mat("#7c2d12", 0.5), gx, 1.0, gz, 10);
  }
  // A three-branch candelabra in the middle of the table.
  cyl(0.07, 0.09, 0.04, iron, TX, 0.89, TZ, 10);
  for (const dz of [-0.16, 0, 0.16]) {
    cyl(0.03, 0.03, dz === 0 ? 0.26 : 0.18, cream, TX, dz === 0 ? 1.04 : 1.0, TZ + dz, 8);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 6), flameMat);
    flame.position.set(TX, dz === 0 ? 1.21 : 1.13, TZ + dz);
    ctx.add(flame, false);
  }
  // The board, laid into the table twice — one turned to each bench, so whoever sits there reads it upright.
  for (const side of [-1, 1]) {
    const tab = kit.canvasTex(1024, 374, () => undefined);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.766), kit.own(new THREE.MeshBasicMaterial({ map: tab.tex, toneMapped: false })));
    mesh.rotation.x = -Math.PI / 2;
    // The plane's top edge points north (−z). The south bench reads it as it is; the north bench reads the half turned round.
    if (side > 0) mesh.rotation.z = Math.PI;
    mesh.position.set(TX + side * 1.28, 0.872, TZ);
    mesh.name = side < 0 ? "mead_tabletop" : "mead_tabletop_n";
    root.add(mesh);
    screens.push({ id: mesh.name, mesh, canvas: tab.canvas, tex: tab.tex, kind: "table", index: side < 0 ? 0 : 1, label: "The Long Table — the board, laid flat" });
  }

  /* ── a longship hung over the table ── */
  const ship = new THREE.Group();
  const prof = new THREE.Shape();
  prof.moveTo(-1.75, 0.62);
  prof.quadraticCurveTo(-1.3, 0.02, 0, 0);
  prof.quadraticCurveTo(1.3, 0.02, 1.75, 0.62);
  prof.lineTo(1.55, 0.5);
  prof.quadraticCurveTo(0.95, 0.3, 0, 0.3);
  prof.quadraticCurveTo(-0.95, 0.3, -1.55, 0.5);
  prof.closePath();
  const shipGeo = new THREE.ExtrudeGeometry(prof, { depth: 0.62, bevelEnabled: false });
  shipGeo.translate(0, 0, -0.31);
  ship.add(new THREE.Mesh(shipGeo, hull));
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.04, 0.5), dark);
  deck.position.set(0, 0.32, 0);
  ship.add(deck);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.6, 8), woodLight);
  mast.position.set(0, 1.1, 0);
  ship.add(mast);
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.3, 6), woodLight);
  yard.rotation.x = Math.PI / 2;
  yard.position.set(0, 1.7, 0);
  ship.add(yard);
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.95), pennantMat);
  sail.rotation.y = Math.PI / 2;
  sail.position.set(0, 1.18, 0);
  ship.add(sail);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 14), i % 2 ? pine : cream);
      sh.rotation.x = Math.PI / 2;
      sh.position.set(-1.0 + i * 0.66, 0.2, s * 0.33);
      ship.add(sh);
    }
  }
  const shipY = 5.1;
  ship.position.set(TX, shipY, TZ);
  ship.rotation.y = Math.PI / 2;
  ctx.add(ship);
  // Four chains up to the beam at z 9 (the ship hangs along z, its depth across x).
  for (const [dx, dz] of [
    [-0.3, -1.4],
    [0.3, -1.4],
    [-0.3, 1.4],
    [0.3, 1.4],
  ] as [number, number][]) rod(new THREE.Vector3(TX + dx, shipY + 0.5, TZ + dz), new THREE.Vector3(TX + dx * 0.5, H - 0.2, 9.0), 0.012, iron);

  /* ── an antler chandelier over the runner ── */
  {
    const cx = -1.8;
    const cy = 5.7;
    const czz = 6.0;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.04, 8, 28), iron);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cx, cy, czz);
    ctx.add(ring);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const px = cx + Math.cos(a) * 0.75;
      const pz = czz + Math.sin(a) * 0.75;
      cyl(0.035, 0.035, 0.2, cream, px, cy + 0.12, pz, 8);
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 6), flameMat);
      f.position.set(px, cy + 0.26, pz);
      ctx.add(f, false);
      const tine = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.5, 5), cream);
      tine.position.set(cx + Math.cos(a) * 0.88, cy - 0.12, czz + Math.sin(a) * 0.88);
      tine.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
      ctx.add(tine);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      rod(new THREE.Vector3(cx + Math.cos(a) * 0.75, cy, czz + Math.sin(a) * 0.75), new THREE.Vector3(cx, H - 0.2, czz), 0.012, iron);
    }
  }

  /* ── the hearth, with a fire ── */
  const HX = R.x1;
  const HZ = 6.4;
  // The chimney breast around an opening 1.6 m wide and 1.15 m high.
  const breast = (w: number, h: number, z: number, y: number) => ctx.box(0.9, h, w, stone, HX - 0.45, y, z);
  breast(0.8, H, HZ - 1.2, H / 2);
  breast(0.8, H, HZ + 1.2, H / 2);
  breast(1.6, H - 1.15, HZ, 1.15 + (H - 1.15) / 2);
  ctx.box(0.12, 0.22, 3.0, stoneLight, HX - 0.98, 1.27, HZ);
  ctx.box(0.5, 0.1, 3.0, woodLight, HX - 1.15, 1.55, HZ);
  for (const sz of [-1, 1]) ctx.box(0.18, 1.25, 0.18, stoneLight, HX - 0.99, 0.62, HZ + sz * 0.88);
  ctx.box(1.0, 0.08, 2.1, stoneLight, HX - 0.65, 0.04, HZ);
  ctx.box(0.84, 0.04, 1.6, kit.mat("#120c08", 0.95), HX - 0.5, 0.1, HZ);
  for (const lz of [-0.28, 0.12]) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 1.0, 8), kit.mat("#2b1a0b", 0.9));
    log.rotation.x = Math.PI / 2;
    log.position.set(HX - 0.55, 0.2, HZ + lz);
    ctx.add(log);
  }
  // Over the mantel: two shields, crossed axes and a drinking horn.
  shield(HX - 0.12, 2.5, HZ - 0.8, -Math.PI / 2, 0.38);
  shield(HX - 0.12, 2.5, HZ + 0.8, -Math.PI / 2, 0.38);
  for (const s of [-1, 1]) {
    const haft = ctx.box(0.05, 1.0, 0.05, woodLight, HX - 0.12, 3.35, HZ);
    haft.rotation.x = s * 0.6;
    const blade = ctx.box(0.04, 0.22, 0.3, iron, HX - 0.12, 3.35 + 0.42 * Math.cos(0.6), HZ + s * 0.5 * Math.sin(0.6) * 0.84);
    blade.rotation.x = s * 0.6;
  }
  // The hearth rug and two carved armchairs facing the fire.
  const hearthRugTex = kit.canvasTex(512, 384, (c) => drawKnotPanel(c, "#3a2210"));
  const hearthRug = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.4), kit.own(new THREE.MeshStandardMaterial({ map: hearthRugTex.tex, roughness: 0.95 })));
  hearthRug.rotation.x = -Math.PI / 2;
  hearthRug.position.set(6.95, 0.014, HZ);
  hearthRug.receiveShadow = true;
  root.add(hearthRug);
  const chairBack = kit.canvasTex(192, 256, (c) => drawKnotPanel(c, MEAD.pine));
  const chairPanel = kit.own(new THREE.MeshStandardMaterial({ map: chairBack.tex, roughness: 0.8 }));
  for (const cz2 of [5.4, 7.4]) {
    const x = 6.7;
    ctx.box(0.72, 0.16, 0.72, pine, x, 0.4, cz2);
    ctx.box(0.12, 1.2, 0.74, pine, x - 0.35, 0.95, cz2);
    ctx.box(0.14, 0.07, 0.8, brass, x - 0.35, 1.58, cz2);
    for (const sz of [-1, 1]) ctx.box(0.7, 0.16, 0.1, wood, x, 0.66, cz2 + sz * 0.36);
    for (const [lx, lz] of [
      [-0.3, -0.3],
      [0.3, -0.3],
      [-0.3, 0.3],
      [0.3, 0.3],
    ]) ctx.box(0.08, 0.34, 0.08, wood, x + lx, 0.17, cz2 + lz);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.8), chairPanel);
    p.position.set(x - 0.28, 0.98, cz2);
    p.rotation.y = Math.PI / 2;
    root.add(p);
  }
  // The fire: three layers of flame, additive, and a light that breathes.
  const flameTex = kit.canvasTex(64, 128, (c) => {
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(32, 96, 4, 32, 80, 60);
    g.addColorStop(0, "rgba(255,244,190,1)");
    g.addColorStop(0.35, "rgba(255,170,60,0.85)");
    g.addColorStop(0.75, "rgba(220,70,20,0.3)");
    g.addColorStop(1, "rgba(120,20,0,0)");
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(10, 128);
    x.quadraticCurveTo(0, 60, 32, 0);
    x.quadraticCurveTo(64, 60, 54, 128);
    x.closePath();
    x.fill();
  });
  const flames: THREE.Mesh[] = [];
  for (const [fz, fh] of [
    [-0.32, 0.8],
    [0.0, 1.05],
    [0.3, 0.7],
  ] as [number, number][]) {
    const f = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, fh),
      kit.own(new THREE.MeshBasicMaterial({ map: flameTex.tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })),
    );
    f.rotation.y = Math.PI / 2;
    f.position.set(HX - 0.55, 0.25 + fh / 2, HZ + fz);
    f.userData.base = fh;
    root.add(f);
    keepLive(f);
    flames.push(f);
  }
  const fire = new THREE.PointLight(0xff8a3a, 10, 10, 1.5);
  fire.position.set(HX - 1.4, 0.9, HZ);
  root.add(fire);

  /* ── the Skald's stand ── */
  const LX = -0.25;
  const LZ = 8.6;
  ctx.box(0.5, 0.95, 0.6, wood, LX, 0.475, LZ);
  ctx.box(0.62, 0.06, 0.74, brass, LX, 0.97, LZ);
  const lectern = kit.canvasTex(512, 384, () => undefined);
  const lecternMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.465), kit.own(new THREE.MeshBasicMaterial({ map: lectern.tex, toneMapped: false })));
  lecternMesh.rotation.order = "YXZ";
  lecternMesh.rotation.y = -Math.PI / 2;
  lecternMesh.rotation.x = -0.5;
  lecternMesh.position.set(LX - 0.07, 1.12, LZ);
  lecternMesh.name = "mead_lectern_screen";
  root.add(lecternMesh);
  const slope = ctx.box(0.05, 0.54, 0.74, dark, LX + 0.02, 1.1, LZ);
  slope.rotation.z = 0.5;
  screens.push({ id: "mead_lectern_screen", mesh: lecternMesh, canvas: lectern.canvas, tex: lectern.tex, kind: "lectern", index: 0, label: "The Skald's stand — the conditions, not a prediction" });

  /* ── the Skald's Ledger, on the west wall beside the door ── */
  const ledger = kit.canvasTex(1024, 710, () => undefined);
  const ledgerMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.8), kit.own(new THREE.MeshBasicMaterial({ map: ledger.tex, toneMapped: false })));
  ledgerMesh.position.set(R.x0 + 0.14, 2.55, 9.0);
  ledgerMesh.rotation.y = Math.PI / 2;
  ledgerMesh.name = "mead_ledger";
  root.add(ledgerMesh);
  ctx.box(0.1, 1.98, 2.8, wood, R.x0 + 0.06, 2.55, 9.0);
  ctx.box(0.12, 0.07, 2.9, brass, R.x0 + 0.08, 3.58, 9.0);
  ctx.box(0.12, 0.07, 2.9, brass, R.x0 + 0.08, 1.52, 9.0);
  screens.push({ id: "mead_ledger", mesh: ledgerMesh, canvas: ledger.canvas, tex: ledger.tex, kind: "ledger", index: 0, label: "The Skald's Ledger — the crowd, the board, the record" });

  /* ── a dartboard on the east wall, above the barrels ── */
  const dartTex = kit.canvasTex(256, 256, (c) => {
    const x = c.getContext("2d")!;
    const rings: [number, string][] = [
      [124, "#1a0f08"],
      [112, MEAD.pine],
      [90, "#efe3c2"],
      [76, MEAD.pine],
      [44, "#efe3c2"],
      [30, MEAD.brass],
      [14, "#7c2d12"],
    ];
    for (const [r, col] of rings) {
      x.fillStyle = col;
      x.beginPath();
      x.arc(128, 128, r, 0, Math.PI * 2);
      x.fill();
    }
    x.strokeStyle = "rgba(0,0,0,0.5)";
    x.lineWidth = 2;
    for (let i = 0; i < 20; i++) {
      x.beginPath();
      x.moveTo(128, 128);
      x.lineTo(128 + Math.cos((i / 20) * Math.PI * 2) * 112, 128 + Math.sin((i / 20) * Math.PI * 2) * 112);
      x.stroke();
    }
  });
  const dart = new THREE.Mesh(new THREE.CircleGeometry(0.3, 28), kit.own(new THREE.MeshStandardMaterial({ map: dartTex.tex, roughness: 0.8 })));
  dart.position.set(R.x1 - 0.1, 1.75, 9.0);
  dart.rotation.y = -Math.PI / 2;
  root.add(dart);
  cyl(0.34, 0.34, 0.05, wood, R.x1 - 0.06, 1.75, 9.0, 20).rotation.z = Math.PI / 2;
  for (const [dy, dz] of [
    [0.05, -0.08],
    [-0.1, 0.12],
    [0.12, 0.04],
  ]) {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 5), brass);
    d.rotation.z = Math.PI / 2;
    d.position.set(R.x1 - 0.19, 1.75 + dy, 9.0 + dz);
    ctx.add(d);
  }

  const fireBase = [0.8, 1.05, 0.7];
  return {
    update(_dt: number, t: number) {
      flames.forEach((f, i) => {
        const flick = 0.82 + 0.18 * Math.sin(t * (7 + i * 2.3) + i * 1.9) * Math.sin(t * 3.1 + i);
        f.scale.set(0.9 + 0.1 * Math.sin(t * 9 + i), flick, 1);
        f.position.y = 0.25 + (fireBase[i]! * flick) / 2;
        (f.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.25 * flick;
      });
      fire.intensity = 10 + 2.6 * Math.sin(t * 8.3) * Math.sin(t * 3.7) + 1.4 * Math.sin(t * 17.1);
      pennants.forEach((g, i) => {
        g.rotation.z = 0.035 * Math.sin(t * 0.8 + i * 1.7);
        g.rotation.x = 0.02 * Math.sin(t * 0.6 + i);
      });
    },
    redraw(state: PredictionMarketFeedState, extra: HallExtras) {
      for (const sc of screens) {
        if (sc.kind === "ledger") drawLedger(sc.canvas, state, extra);
        else if (sc.kind === "table") drawTabletop(sc.canvas, state, extra);
        else if (sc.kind === "lectern") drawLectern(sc.canvas, state);
        else continue;
        sc.tex.needsUpdate = true;
      }
    },
  };
}
