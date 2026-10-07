"""
floor_opt.py - size passes run on the finished scene, before the glTF export.

  hidden_faces   drop polygons nobody can see: faces that look down at floor level, and faces pressed flat against an
                 opposing face (a box standing on a desk, the back of a TV against its wall, a baseboard against a wall)
  merge_screen_materials
                 every screen quad carried its own scr_<id> material; the runtime replaces a screen's material with its own
                 canvas material, so one scr_blank serves all of them (nodes keep their ids)
  dedupe_meshes  objects whose mesh data is identical (same vertices, polygons, materials, shading) share ONE mesh datablock,
                 so the file stores a chair once, not twelve times. Node names, transforms and extras stay per object.

Nothing here renames a node or touches a material the runtime matches by name (mat_<id>, mat_key_<Name>).
"""

import hashlib

import bmesh
import bpy
import numpy as np
from mathutils import Vector

KEEP_PREFIX = ("door_",)         # door panels are tiny and always visible


def _newell(pts):
    n = Vector()
    k = len(pts)
    for i in range(k):
        a, b = pts[i], pts[(i + 1) % k]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def _inside(pt, poly2, drop):
    """Point in a 2D polygon after dropping axis `drop` (crossing number)."""
    ax = [i for i in range(3) if i != drop]
    x, y = pt[ax[0]], pt[ax[1]]
    inside = False
    k = len(poly2)
    for i in range(k):
        x1, y1 = poly2[i][ax[0]], poly2[i][ax[1]]
        x2, y2 = poly2[(i + 1) % k][ax[0]], poly2[(i + 1) % k][ax[1]]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def hidden_faces(core, log=print, tol=0.0003):
    """Delete polygons nobody can see: down-facing faces at floor level, and faces lying flat against an opposing face
    that covers them (every sample point of the face is inside a coplanar, opposite-facing opaque polygon; "coplanar"
    means within `tol` = 0.3 mm, far tighter than the thinnest layer anywhere in the scene, 2 mm).
    Returns (polygons, triangles) removed."""
    objs = [o for o in bpy.data.objects if o.type == "MESH"]
    bpy.context.view_layer.update()
    screens = {s["id"] for s in core.LAYOUT["screens"]}
    info = []       # (obj index, local polygon index, world points, unit normal, plane offset, opaque)
    groups = {}
    for oi, o in enumerate(objs):
        if o.name.startswith(KEEP_PREFIX) or o.name in screens:
            continue
        mw = o.matrix_world
        mats = [m.name if m else "" for m in o.data.materials]
        for p in o.data.polygons:
            pts = [mw @ o.data.vertices[i].co for i in p.vertices]
            n = _newell(pts)
            if n.length < 1e-9:
                continue
            n.normalize()
            d = n.dot(pts[0])
            opaque = not (p.material_index < len(mats) and mats[p.material_index] == "glass")
            sgn = 1.0 if (n.x > 1e-6 or (abs(n.x) <= 1e-6 and (n.y > 1e-6 or (abs(n.y) <= 1e-6 and n.z > 0)))) else -1.0
            key = (round(n.x * sgn * 500), round(n.y * sgn * 500), round(n.z * sgn * 500), int(np.floor(d * sgn / 0.001)))
            info.append((oi, p.index, pts, n, d, opaque, sgn))
            groups.setdefault(key, []).append(len(info) - 1)
    drop = {}
    n_poly = n_tri = 0
    for key, members in groups.items():
        if len(members) < 2:
            continue
        # opposite polygons live in this bin or the next one down/up
        for mi in members:
            oi, local, pts, n, d, opaque, sgn = info[mi]
            cands = []
            for dk in (-1, 0, 1):
                k2 = (key[0], key[1], key[2], key[3] + dk)
                for mj in groups.get(k2, ()):
                    o2 = info[mj]
                    if mj != mi and o2[5] and o2[3].dot(n) < -0.999 and abs(o2[4] + d) < tol:
                        cands.append(o2)
            hidden = False
            if n.z < -0.98 and max(p.z for p in pts) < 0.012:
                hidden = True
            elif cands:
                c = sum(pts, Vector()) / len(pts)
                # the centroid, every corner (up to 12, spread round a big n-gon) and the edge midpoints, pulled 10% in
                step = max(1, len(pts) // 12)
                ring = pts[::step]
                mids = [(pts[i] + pts[(i + 1) % len(pts)]) / 2 for i in range(0, len(pts), step)]
                samples = [c] + [c + (q - c) * 0.9 for q in ring + mids]
                axis = max(range(3), key=lambda i: abs(n[i]))
                hidden = all(any(_inside(sp, o2[2], axis) for o2 in cands) for sp in samples)
            if hidden:
                drop.setdefault(oi, []).append(local)
                n_poly += 1
                n_tri += len(pts) - 2
    for oi, locals_ in drop.items():
        ob = objs[oi]
        me = ob.data
        if me.users > 1:
            me = me.copy()
            ob.data = me
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        faces = [bm.faces[k] for k in sorted(set(locals_))]
        bmesh.ops.delete(bm, geom=faces, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(me)
        bm.free()
        me.update()
    log("opt: hidden faces removed: %d polygons, %d triangles, in %d objects" % (n_poly, n_tri, len(drop)))
    return n_poly, n_tri


def merge_screen_materials(core, log=print):
    """One scr_blank for every scr_<id> material."""
    blank = core.new_mat("scr_blank", "#05070c", 0.4, 0.0)
    mat = core.MATS[blank]
    n = 0
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        for i, slot in enumerate(o.material_slots):
            if slot.material and slot.material.name.startswith("scr_") and slot.material is not mat:
                o.material_slots[i].material = mat
                n += 1
    for m in list(bpy.data.materials):
        if m.name.startswith("scr_") and m is not mat and m.users == 0:
            bpy.data.materials.remove(m)
    log("opt: %d screen materials merged into scr_blank" % n)
    return n


def _mesh_key(me):
    h = hashlib.md5()
    nv = len(me.vertices)
    co = np.empty(nv * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    h.update(np.round(co, 5).tobytes())
    h.update(str(nv).encode())
    npoly = len(me.polygons)
    h.update(str(npoly).encode())
    mi = np.empty(npoly, dtype=np.int32)
    me.polygons.foreach_get("material_index", mi)
    h.update(mi.tobytes())
    sm = np.empty(npoly, dtype=np.int8)
    me.polygons.foreach_get("use_smooth", sm)
    h.update(sm.tobytes())
    ls = np.empty(npoly, dtype=np.int32)
    me.polygons.foreach_get("loop_start", ls)
    h.update(ls.tobytes())
    nl = len(me.loops)
    vi = np.empty(nl, dtype=np.int32)
    me.loops.foreach_get("vertex_index", vi)
    h.update(vi.tobytes())
    for m in me.materials:
        h.update((m.name if m else "").encode() + b"|")
    for uvl in me.uv_layers:
        uv = np.empty(nl * 2, dtype=np.float32)
        uvl.data.foreach_get("uv", uv)
        h.update(np.round(uv, 5).tobytes())
    for ca in me.color_attributes:
        c = np.empty(len(ca.data) * 4, dtype=np.float32)
        ca.data.foreach_get("color", c)
        h.update(np.round(c, 3).tobytes())
    return h.hexdigest()


def dedupe_meshes(core, log=print):
    """Share one mesh datablock between objects with identical geometry. Returns (objects relinked, meshes freed)."""
    canon = {}
    relinked = 0
    for o in sorted((o for o in bpy.data.objects if o.type == "MESH"), key=lambda o: o.name):
        me = o.data
        key = _mesh_key(me)
        if key in canon and canon[key] is not me:
            old = me
            o.data = canon[key]
            relinked += 1
            if old.users == 0:
                bpy.data.meshes.remove(old)
        else:
            canon[key] = me
    freed = len(bpy.data.meshes) - len({id(m) for m in bpy.data.meshes if m.users})
    log("opt: %d objects now share mesh data (%d unique meshes remain)" % (relinked, len(canon)))
    return relinked, len(canon)
