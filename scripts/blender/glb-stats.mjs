/**
 * glb-stats.mjs - read a .glb's JSON chunk and report what the runtime and the budgets care about.
 *
 *   node scripts/blender/glb-stats.mjs public/floor/office.glb
 *   node scripts/blender/glb-stats.mjs new.glb --against old.glb     # node-name / triangle / size diff
 *   node scripts/blender/glb-stats.mjs public/floor/office.glb --json
 *
 * No dependencies. Triangles are counted from the index accessors (a non-indexed primitive counts its POSITION
 * accessor / 3), instanced through the node tree, so the figure is what the GPU is asked to draw.
 */
import { readFileSync, statSync } from "node:fs";

export function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "glTF") throw new Error(`${path}: not a GLB`);
  if (buf.readUInt32LE(8) !== buf.length) throw new Error(`${path}: header length ${buf.readUInt32LE(8)} != file ${buf.length}`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
  return { json, bytes: buf.length, buf, jsonLen };
}

function primTris(g, p) {
  const mode = p.mode ?? 4;
  if (mode !== 4) return 0;
  if (p.indices != null) return g.accessors[p.indices].count / 3;
  const pos = p.attributes?.POSITION;
  return pos != null ? g.accessors[pos].count / 3 : 0;
}

export function stats(path) {
  const { json: g, bytes } = readGlb(path);
  const nodes = g.nodes ?? [];
  const names = nodes.map((n) => n.name ?? "");
  const meshTris = (g.meshes ?? []).map((m) => m.primitives.reduce((a, p) => a + primTris(g, p), 0));
  let instTris = 0;
  let meshNodes = 0;
  for (const n of nodes) if (n.mesh != null) { instTris += meshTris[n.mesh]; meshNodes++; }
  const uniqueTris = meshTris.reduce((a, b) => a + b, 0);
  const prims = (g.meshes ?? []).reduce((a, m) => a + m.primitives.length, 0);
  const attrs = new Set();
  for (const m of g.meshes ?? []) for (const p of m.primitives) for (const k of Object.keys(p.attributes)) attrs.add(k);
  const morphMeshes = (g.meshes ?? []).filter((m) => m.primitives.some((p) => p.targets?.length)).length;
  // bytes of vertex data per attribute (+ indices), and the component type each is stored as
  const attrBytes = {};
  const attrType = {};
  let vertices = 0;
  for (const m of g.meshes ?? [])
    for (const p of m.primitives) {
      vertices += g.accessors[p.attributes.POSITION].count;
      for (const [k, a] of Object.entries(p.attributes)) {
        const ac = g.accessors[a];
        const n = { VEC3: 3, VEC2: 2, VEC4: 4, SCALAR: 1 }[ac.type];
        const cs = { 5126: 4, 5121: 1, 5123: 2, 5125: 4, 5120: 1, 5122: 2 }[ac.componentType];
        attrBytes[k] = (attrBytes[k] ?? 0) + ac.count * n * cs;
        attrType[k] = `${{ 5126: "f32", 5121: "u8", 5123: "u16", 5125: "u32" }[ac.componentType] ?? ac.componentType}${ac.normalized ? "n" : ""} ${ac.type}`;
      }
      if (p.indices != null) {
        const ac = g.accessors[p.indices];
        attrBytes.INDICES = (attrBytes.INDICES ?? 0) + ac.count * ({ 5123: 2, 5125: 4, 5121: 1 }[ac.componentType]);
        attrType.INDICES = `${{ 5123: "u16", 5125: "u32", 5121: "u8" }[ac.componentType]}`;
      }
    }
  return {
    vertices,
    attrBytes,
    attrType,
    jsonBytes: JSON.stringify(g).length,
    accessors: (g.accessors ?? []).length,
    path,
    bytes,
    nodes: nodes.length,
    meshNodes,
    meshes: (g.meshes ?? []).length,
    primitives: prims,
    trianglesInstanced: instTris,
    trianglesUnique: uniqueTris,
    materials: (g.materials ?? []).length,
    textures: (g.textures ?? []).length,
    images: (g.images ?? []).map((i) => ({ name: i.name, mime: i.mimeType, bytes: i.bufferView != null ? g.bufferViews[i.bufferView].byteLength : null })),
    attributes: [...attrs].sort(),
    morphMeshes,
    extensionsUsed: g.extensionsUsed ?? [],
    extensionsRequired: g.extensionsRequired ?? [],
    names,
    extras: nodes.filter((n) => n.extras).map((n) => ({ name: n.name, extras: n.extras })),
  };
}

function show(s) {
  console.log(`${s.path}`);
  console.log(`  size            ${s.bytes} bytes (${(s.bytes / 1e6).toFixed(3)} MB)`);
  console.log(`  nodes           ${s.nodes}  (mesh nodes ${s.meshNodes}, meshes ${s.meshes}, primitives ${s.primitives})`);
  console.log(`  triangles       ${s.trianglesInstanced} drawn (${s.trianglesUnique} unique mesh data)`);
  console.log(`  materials       ${s.materials}   textures ${s.textures}   images ${s.images.length}`);
  for (const i of s.images) console.log(`    image ${i.name ?? "?"} ${i.mime ?? ""} ${i.bytes ?? "?"} bytes`);
  console.log(`  vertex attrs    ${s.attributes.join(", ")}`);
  console.log(`  vertices        ${s.vertices}   accessors ${s.accessors}   json ${s.jsonBytes} bytes`);
  console.log(`  bytes by attr   ${Object.entries(s.attrBytes).map(([k, v]) => `${k} ${v} (${s.attrType[k]})`).join("; ")}`);
  console.log(`  morph meshes    ${s.morphMeshes}`);
  console.log(`  extensions      used [${s.extensionsUsed.join(", ")}] required [${s.extensionsRequired.join(", ")}]`);
  console.log(`  nodes w/ extras ${s.extras.length}`);
}

const argv = process.argv.slice(2);
if (argv.length && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  const file = argv.find((a) => !a.startsWith("--"));
  const against = argv.includes("--against") ? argv[argv.indexOf("--against") + 1] : null;
  const s = stats(file);
  if (argv.includes("--json")) {
    const { names, extras, ...rest } = s;
    console.log(JSON.stringify(rest, null, 2));
  } else show(s);
  if (against) {
    const o = stats(against);
    console.log("");
    show(o);
    const a = new Set(s.names);
    const b = new Set(o.names);
    const onlyNew = [...a].filter((x) => !b.has(x));
    const onlyOld = [...b].filter((x) => !a.has(x));
    console.log(`\nnode names: ${a.size} vs ${b.size} unique; only in first: ${onlyNew.length}${onlyNew.length ? " " + JSON.stringify(onlyNew.slice(0, 40)) : ""}; only in second: ${onlyOld.length}${onlyOld.length ? " " + JSON.stringify(onlyOld.slice(0, 40)) : ""}`);
    console.log(`triangles: ${s.trianglesInstanced} vs ${o.trianglesInstanced} (${(((s.trianglesInstanced - o.trianglesInstanced) / o.trianglesInstanced) * 100).toFixed(2)}%)`);
    console.log(`bytes:     ${s.bytes} vs ${o.bytes} (${(((s.bytes - o.bytes) / o.bytes) * 100).toFixed(2)}%)`);
  }
}
