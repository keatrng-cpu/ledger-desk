"""
floor_ao.py - baked ambient occlusion for the office, written as vertex colours (glTF COLOR_0).

Why vertex colours: three's GLTFLoader multiplies COLOR_0 into the base colour, so the runtime needs no change and
no image files. The exporter is told to export the ACTIVE colour attribute; floor_pack.py then squeezes it to
unsigned bytes (Blender writes unsigned shorts).

What gets which occlusion
  floors   (rooms)   AO on a lattice, then merged by a kd-tree into the fewest rectangles whose bilinear fit stays
                     inside a tolerance ("world" AO: occluders are every floor, solid wall and piece of furniture)
  walls    solid / low / window walls: every large vertical face is merged the same way. Glass walls get nothing.
  objects  furniture, props, housings: "self" AO in the object's own frame (its geometry plus a ground plane for
                     floor-standing pieces). Because it is local, identical pieces keep identical colours and the mesh
                     data can still be shared (floor_opt.dedupe).
  skipped  screens, emissives, keyboards (the runtime replaces their materials), the base slab, door panels, decals.

Deterministic: fixed sample pattern, rotation from a position hash (fixed for lattices), no random state.
Rays use mathutils' BVH. The kd merge splits where the error is, so a gradient along a wall costs a few long
rectangles, not a grid. Neighbouring rectangles share every vertex on their common edge, so there are no cracks.
"""

import math
import os
import time

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

AO_NAME = "ao"

WORLD_FLOOR = dict(maxd=1.5, n=32, k=0.80, lo=0.28, near=0.35)
WORLD_WALL = dict(maxd=1.3, n=32, k=0.72, lo=0.34, near=0.35)
SELF_OBJ = dict(maxd=0.5, n=14, k=0.68, lo=0.38, near=0.4)
# deep corners lean cool, like the scene's own shadow colour
TINT = (1.0, 0.97, 0.88)

LATTICE = float(os.environ.get("FLOOR_AO_LATTICE", "0.15"))   # metres between samples
TOL = float(os.environ.get("FLOOR_AO_TOL", "0.06"))           # largest shade error a merged rectangle may hide
MIN_WALL_FACE = 0.45                                           # smallest wall face side (m) worth refining


# --------------------------------------------------------------------------
# kd merge of a lattice
# --------------------------------------------------------------------------


def _kd_leaves(V, tol):
    """Rectangles (i0, i1, j0, j1) over lattice vertices whose corner-bilinear fit matches V within tol.
    Splits along the axis that is least linear, at the sample that deviates most."""
    leaves = []
    stack = [(0, V.shape[0] - 1, 0, V.shape[1] - 1)]
    while stack:
        i0, i1, j0, j1 = stack.pop()
        ni, nj = i1 - i0, j1 - j0
        if ni == 1 and nj == 1:
            leaves.append((i0, i1, j0, j1))
            continue
        sub = V[i0:i1 + 1, j0:j1 + 1]
        u = np.linspace(0.0, 1.0, ni + 1)[:, None]
        v = np.linspace(0.0, 1.0, nj + 1)[None, :]
        a, b, c, d = sub[0, 0], sub[-1, 0], sub[0, -1], sub[-1, -1]
        err = float(np.abs(sub - (a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v)).max())
        if err <= tol:
            leaves.append((i0, i1, j0, j1))
            continue
        ei, ai, ej, aj = -1.0, None, -1.0, None
        if ni > 1:
            line = sub[0:1, :] * (1 - u) + sub[-1:, :] * u
            dev = np.abs(sub - line).max(axis=1)
            ei, ai = float(dev.max()), i0 + int(dev.argmax())
        if nj > 1:
            line = sub[:, 0:1] * (1 - v) + sub[:, -1:] * v
            dev = np.abs(sub - line).max(axis=0)
            ej, aj = float(dev.max()), j0 + int(dev.argmax())
        if ei >= ej and ai is not None and i0 < ai < i1:
            stack += [(i0, ai, j0, j1), (ai, i1, j0, j1)]
        elif aj is not None and j0 < aj < j1:
            stack += [(i0, i1, j0, aj), (i0, i1, aj, j1)]
        elif ni >= nj and ni > 1:
            m = (i0 + i1) // 2
            stack += [(i0, m, j0, j1), (m, i1, j0, j1)]
        else:
            m = (j0 + j1) // 2
            stack += [(i0, i1, j0, m), (i0, i1, m, j1)]
    return leaves


def _rect_tris(leaf, corners):
    """Triangles (lattice index pairs) for one rectangle, using every neighbour-induced vertex on its edges so the
    mesh has no cracks. Counter-clockwise in (i, j)."""
    i0, i1, j0, j1 = leaf
    B = [(i, j0) for i in range(i0, i1 + 1) if i in (i0, i1) or (i, j0) in corners]
    R = [(i1, j) for j in range(j0, j1 + 1) if j in (j0, j1) or (i1, j) in corners]
    T = [(i, j1) for i in range(i1, i0 - 1, -1) if i in (i0, i1) or (i, j1) in corners]
    L = [(i0, j) for j in range(j1, j0 - 1, -1) if j in (j0, j1) or (i0, j) in corners]
    tris = []

    def half(Bs, Rs, apex):
        # triangle apex -> Bs... -> Rs...; fan from Rs[1] over Bs, fan from apex over Rs[1:]
        r1 = Rs[1]
        for k in range(len(Bs) - 1):
            tris.append((r1, Bs[k], Bs[k + 1]))
        for k in range(1, len(Rs) - 1):
            tris.append((apex, Rs[k], Rs[k + 1]))

    half(B, R, (i0, j0))
    half(T, L, (i1, j1))
    return tris


def refine_rect(world, org, du, dv, w, h, normal, spec):
    """AO over a rectangle (origin org, unit axes du and dv, size w x h, outward normal), merged by the kd rule.
    Returns (vertices, triangles, leaves) with the triangles facing along `normal`."""
    ni = max(1, int(round(w / LATTICE)))
    nj = max(1, int(round(h / LATTICE)))
    occ = np.zeros((ni + 1, nj + 1), dtype=np.float32)
    for i in range(ni + 1):
        for j in range(nj + 1):
            p = org + du * (w * i / ni) + dv * (h * j / nj)
            occ[i, j] = _occlusion(world, p, normal, spec, ang=0.0)
    shade = np.maximum(spec["lo"], 1.0 - spec["k"] * occ)
    leaves = _kd_leaves(shade, TOL)
    corners = set()
    for (i0, i1, j0, j1) in leaves:
        corners.update(((i0, j0), (i1, j0), (i0, j1), (i1, j1)))
    tris = []
    for leaf in leaves:
        tris += _rect_tris(leaf, corners)
    used = sorted({p for t in tris for p in t})
    index = {p: n for n, p in enumerate(used)}
    verts = [org + du * (w * i / ni) + dv * (h * j / nj) for (i, j) in used]
    faces = [(index[a], index[b], index[c]) for (a, b, c) in tris]
    # orient with the outward normal
    a, b, c = (verts[k] for k in faces[0])
    if (b - a).cross(c - a).dot(normal) < 0:
        faces = [(x, z, y) for (x, y, z) in faces]
    return verts, faces, len(leaves)


# --------------------------------------------------------------------------
# occlusion
# --------------------------------------------------------------------------

_DIR_CACHE = {}


def _hemisphere(n):
    """Cosine-weighted directions about +Z (Hammersley)."""
    if n in _DIR_CACHE:
        return _DIR_CACHE[n]
    out = []
    for i in range(n):
        u = (i + 0.5) / n
        v, f, k = 0.0, 0.5, i
        while k:
            v += f * (k & 1)
            k >>= 1
            f *= 0.5
        r = math.sqrt(u)
        phi = 2 * math.pi * v
        out.append((r * math.cos(phi), r * math.sin(phi), math.sqrt(max(0.0, 1.0 - u))))
    _DIR_CACHE[n] = out
    return out


def _frame(n, ang):
    """Orthonormal frame about normal n, rotated by ang."""
    a = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))
    t = a.cross(n).normalized()
    b = n.cross(t)
    c, s = math.cos(ang), math.sin(ang)
    t2 = t * c + b * s
    b2 = n.cross(t2)
    return t2, b2


def _occlusion(bvh, p, n, spec, ang=None):
    """0 = open sky, 1 = buried. Close hits count fully, far hits fade out."""
    dirs = _hemisphere(spec["n"])
    maxd = spec["maxd"]
    if ang is None:
        h = (round(p.x * 977) * 73856093) ^ (round(p.y * 977) * 19349663) ^ (round(p.z * 977) * 83492791)
        ang = ((h & 0xFFFF) / 65536.0) * 2 * math.pi
    t, b = _frame(n, ang)
    o = p + n * 0.003
    near = spec.get("near", 0.55) * maxd
    acc = 0.0
    for (x, y, z) in dirs:
        d = t * x + b * y + n * z
        dist = bvh.ray_cast(o, d, maxd)[3]
        if dist is None:
            continue
        acc += 1.0 if dist <= near else (maxd - dist) / (maxd - near)
    return acc / len(dirs)


def _shade(occ, spec):
    v = max(spec["lo"], 1.0 - spec["k"] * occ)
    return (v, 1.0 - (1.0 - v) * TINT[1], 1.0 - (1.0 - v) * TINT[2], 1.0)


def _build_bvh(verts, polys):
    return BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)


def _mesh_world(ob):
    me = ob.data
    mw = ob.matrix_world
    verts = [tuple(mw @ v.co) for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    return verts, polys


def _bake_mesh(me, bvh, to_world, normal_to_world, spec, ang=None):
    """Write the AO colour attribute for every loop of me. Returns the number of unique samples evaluated."""
    nloops = len(me.loops)
    if nloops == 0:
        return 0
    vi = np.empty(nloops, dtype=np.int32)
    me.loops.foreach_get("vertex_index", vi)
    nrm = np.empty(nloops * 3, dtype=np.float32)
    me.corner_normals.foreach_get("vector", nrm)
    nrm = nrm.reshape(-1, 3)
    q = np.round(nrm * 12).astype(np.int64) + 12
    key = vi.astype(np.int64) * 25 ** 3 + q[:, 0] * 625 + q[:, 1] * 25 + q[:, 2]
    uniq, first, inverse = np.unique(key, return_index=True, return_inverse=True)
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    cols = np.ones((len(uniq), 4), dtype=np.float32)
    for k, li in enumerate(first):
        p = to_world @ Vector(co[vi[li]])
        n = (normal_to_world @ Vector(nrm[li])).normalized()
        cols[k] = _shade(_occlusion(bvh, p, n, spec, ang), spec)
    out = cols[inverse].astype(np.float32)
    if AO_NAME in me.color_attributes:
        me.color_attributes.remove(me.color_attributes[AO_NAME])
    attr = me.color_attributes.new(name=AO_NAME, type="FLOAT_COLOR", domain="CORNER")
    attr.data.foreach_set("color", out.ravel())
    me.color_attributes.active_color = attr
    try:
        me.color_attributes.render_color_index = me.color_attributes.find(AO_NAME)
    except Exception:
        pass
    return len(uniq)


# --------------------------------------------------------------------------
# floors
# --------------------------------------------------------------------------


def build_floors(core, world, log=print):
    """Re-mesh every room floor from the kd merge and bake it. Returns the triangle count."""
    total = 0
    for r in core.LAYOUT["rooms"]:
        ob = bpy.data.objects.get(r["id"])
        if ob is None:
            continue
        (x0, x1), (z0, z1) = r["x"], r["z"]
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        # world corner (x0, -z0), u = +x (east), v = -y (south)
        verts, faces, leaves = refine_rect(world, Vector((x0, -z0, 0.0)), Vector((1, 0, 0)), Vector((0, -1, 0)),
                                           x1 - x0, z1 - z0, Vector((0, 0, 1)), WORLD_FLOOR)
        local = [(v.x - cx, v.y + cz, 0.0) for v in verts]
        old = ob.data
        me = bpy.data.meshes.new("geo_mesh_" + r["id"])
        me.from_pydata(local, [], faces)
        me.materials.append(core.MATS[r["floor"]])
        me.polygons.foreach_set("use_smooth", [False] * len(faces))
        me.update()
        assert all(p.normal.z > 0.99 for p in me.polygons), "floor must face up: " + r["id"]
        ob.data = me
        bpy.data.meshes.remove(old)
        _bake_mesh(me, world, ob.matrix_world, ob.matrix_world.to_3x3(), WORLD_FLOOR, ang=0.0)
        log("  floor %-14s %5.1fx%5.1f  leaves %4d  tris %4d" % (r["id"], x1 - x0, z1 - z0, leaves, len(faces)))
        total += len(faces)
    return total


# --------------------------------------------------------------------------
# walls
# --------------------------------------------------------------------------


def build_walls(core, world, log=print):
    """Merge every large vertical face of the solid / low / window walls by the kd rule."""
    walls = {w["id"]: w for w in core.LAYOUT["walls"]}
    total_before = total_after = 0
    for name, wl in walls.items():
        if wl["kind"] == "glass":
            continue
        ob = bpy.data.objects.get(name)
        if ob is None:
            continue
        me = ob.data
        mw = ob.matrix_world
        inv = mw.inverted()
        keep_polys, keep_mat, keep_smooth = [], [], []
        new_verts = [tuple(v.co) for v in me.vertices]
        new_polys, new_mat = [], []
        before = sum(len(p.vertices) - 2 for p in me.polygons)
        for p in me.polygons:
            wv = [mw @ me.vertices[i].co for i in p.vertices]
            n = (mw.to_3x3() @ p.normal).normalized()
            ok = False
            if len(wv) == 4 and abs(n.z) < 0.2:
                zs = [v.z for v in wv]
                hv = Vector((n.y, -n.x, 0.0))      # in-plane horizontal axis
                us = [v.dot(hv) for v in wv]
                ok = (max(zs) - min(zs)) >= MIN_WALL_FACE and (max(us) - min(us)) >= MIN_WALL_FACE
            if not ok:
                keep_polys.append(tuple(p.vertices))
                keep_mat.append(p.material_index)
                keep_smooth.append(p.use_smooth)
                continue
            z0, z1 = min(zs), max(zs)
            u0, u1 = min(us), max(us)
            base = wv[0]
            org = base + hv * (u0 - base.dot(hv)) + Vector((0, 0, z0 - base.z))
            verts, faces, leaves = refine_rect(world, org, hv, Vector((0, 0, 1)), u1 - u0, z1 - z0, n, WORLD_WALL)
            off = len(new_verts)
            new_verts += [tuple(inv @ v) for v in verts]
            for f in faces:
                new_polys.append(tuple(off + k for k in f))
                new_mat.append(p.material_index)
        if not new_polys:
            continue
        nm = bpy.data.meshes.new(me.name + "_ao")
        nm.from_pydata(new_verts, [], keep_polys + new_polys)
        for m in me.materials:
            nm.materials.append(m)
        nm.polygons.foreach_set("material_index", keep_mat + new_mat)
        nm.polygons.foreach_set("use_smooth", keep_smooth + [False] * len(new_polys))
        nm.update()
        ob.data = nm
        bpy.data.meshes.remove(me)
        after = sum(len(p.vertices) - 2 for p in nm.polygons)
        total_before += before
        total_after += after
        log("  wall %-18s %-6s tris %4d -> %4d" % (name, wl["kind"], before, after))
    return total_before, total_after


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------


def classify(core):
    """Names -> category for every mesh object: 'floor', 'wall', 'obj' or None."""
    rooms = {r["id"] for r in core.LAYOUT["rooms"]}
    walls = {w["id"]: w for w in core.LAYOUT["walls"]}
    screens = {s["id"] for s in core.LAYOUT["screens"]}
    emis = {e["id"] for e in core.LAYOUT["emissives"]}
    keys = {f["id"] for f in core.FURN if f["kind"] == "keyboard"}
    out = {}
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        n = ob.name
        if n in rooms:
            out[n] = "floor"
        elif n in walls:
            out[n] = None if walls[n]["kind"] == "glass" else "wall"
        elif n in screens or n in emis or n in keys or n == "geo_slab" or n.startswith("door_"):
            out[n] = None
        elif n.startswith("geo_alarm") or n.startswith("geo_decal_"):
            out[n] = None
        else:
            out[n] = "obj"
    return out


def bake(core, log=print):
    t0 = time.time()
    cats = classify(core)
    bpy.context.view_layer.update()

    # world occluders: floors, solid walls, furniture; not glass, screens, emissives, doors
    verts, polys = [], []
    for ob in bpy.data.objects:
        if cats.get(ob.name) not in ("floor", "wall", "obj"):
            continue
        v, p = _mesh_world(ob)
        base = len(verts)
        verts += v
        polys += [tuple(i + base for i in poly) for poly in p]
    world = _build_bvh(verts, polys)
    log("ao: world BVH %d verts %d polys (%.1fs)" % (len(verts), len(polys), time.time() - t0))

    nf = build_floors(core, world, log)
    log("ao: floors -> %d triangles (%.1fs)" % (nf, time.time() - t0))
    wb, wa = build_walls(core, world, log)
    log("ao: walls %d -> %d triangles (%.1fs)" % (wb, wa, time.time() - t0))
    bpy.context.view_layer.update()

    done_self = {}
    stats = dict(wall=0, obj=0)
    ident = Matrix.Identity(3)
    for ob in list(bpy.data.objects):
        cat = cats.get(ob.name)
        if cat is None or ob.type != "MESH" or cat == "floor":
            continue
        me = ob.data
        if cat == "wall":
            stats["wall"] += _bake_mesh(me, world, ob.matrix_world, ob.matrix_world.to_3x3(), WORLD_WALL, ang=0.0)
        else:
            if me.name in done_self:
                continue
            ground = not (ob.name.startswith("geo_housing_") or ob.name.startswith("geo_pendant")
                          or ob.name.startswith("geo_wall_clock") or ob.name.startswith("geo_dress_wall"))
            lv = [tuple(v.co) for v in me.vertices]
            lp = [tuple(p.vertices) for p in me.polygons]
            if ground:
                base = len(lv)
                g = 6.0
                lv += [(-g, -g, 0.0), (g, -g, 0.0), (g, g, 0.0), (-g, g, 0.0)]
                lp.append((base, base + 1, base + 2, base + 3))
            bvh = _build_bvh(lv, lp)
            stats["obj"] += _bake_mesh(me, bvh, Matrix.Identity(4), ident, SELF_OBJ)
            done_self[me.name] = True
    log("ao: baked unique samples %s in %.1fs" % (stats, time.time() - t0))
    return stats
