"""
build_floor.py - headless Blender build of the trading-floor 3D assets.

What it builds
  public/floor/office.glb
      The static office: one floor plane per room, the walls (solid, glass with
      mullions and door frames, the low cutaway wall, the east window wall), every
      furniture entry, one quad per screen (plus its physical housing), the emissive
      LED strips / beacon / rack LED panel, and a little extra life (pendant lamps,
      a wall clock, desk props). Procedural PBR colours only - no image textures,
      no lights, no cameras.
  public/floor/portraits/{jax,nova,sterling,gemma,vince}.png
      256x256 stylized busts of the crew, Cycles CPU, on a solid #0f172a ground.

Source of truth
  src/data/floor-layout.json is read (never written). Every id, position, size,
  yaw and colour comes from it; the three.js runtime reads the same file.
  Layout axes are three.js (x east, y up, z south, metres); a layout point
  (x, y, z) maps to Blender (x, -z, y) and the glTF exporter's +Y-up conversion
  maps it back. Yaw 0 = the object's front faces three +z = Blender -Y; every
  object is modelled front-to-Blender -Y, then rotation_euler.z = radians(yaw).

Naming contract (what the runtime looks up)
  - rooms[].id, walls[].id, furniture[].id, screens[].id, emissives[].id are
    object names, verbatim. Everything else is prefixed geo_.
  - screens: a single UV'd quad (u left->right seen from the front, v
    bottom->top), its own material scr_<id>, 5 mm in front of its housing.
  - keyboards: one mesh, one material mat_key_<Name>.
  - emissives: material mat_<id> (the rack LED panel: mat_rack_leds).
  - No geo_ object or material name contains an emissive id or "key_<Name>",
    because the runtime substring-matches those.

Rebuild (from the repo root)
  pip install bpy==5.0.1                        # Blender as a Python module (Python 3.11)
  python scripts/blender/build_floor.py         # office.glb + portraits
  python scripts/blender/build_floor.py --office
  python scripts/blender/build_floor.py --portraits
  python scripts/blender/build_floor.py --verify   # re-import office.glb, check names / tris / size
"""

import json
import math
import os
import random
import struct
import sys
import types

import bpy
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True      # the helper modules (floor_*.py) must not leave __pycache__ in the repo
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
LAYOUT_PATH = os.path.join(REPO, "src", "data", "floor-layout.json")
OUT_DIR = os.environ.get("FLOOR_OUT_DIR") or os.path.join(REPO, "public", "floor")
GLB_PATH = os.path.join(OUT_DIR, "office.glb")
PORTRAIT_DIR = os.path.join(OUT_DIR, "portraits")

with open(LAYOUT_PATH) as fh:
    LAYOUT = json.load(fh)

# Entries flagged "procedural" (the annex offices and their screens) are built at runtime by the three.js scene
# (floor-scene.ts buildFallback) from the same plan, so a GLB rebuild never doubles them.
for _key in ("rooms", "walls", "furniture", "screens", "emissives"):
    LAYOUT[_key] = [i for i in LAYOUT.get(_key, []) if not i.get("procedural")]

FURN = LAYOUT["furniture"]
SCREENS = LAYOUT["screens"]
EMISSIVES = LAYOUT["emissives"]

WALL_T = 0.12        # wall thickness
BEVEL = 0.015        # default furniture bevel
PANE = 0.012         # glass pane thickness (centred in the 0.12 wall envelope)
FRAME_D = 0.044      # glass framing depth (mullions, jambs, door head)
DOOR_H = 2.05        # door opening height in glass walls (transom above)
CEIL = LAYOUT.get("ceiling", 3.6)

# --------------------------------------------------------------------------
# colour + materials
# --------------------------------------------------------------------------


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(_lin(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


# name: (srgb hex, roughness, metallic, extra)
PAL = {
    # floors
    "carpet_red": ("#5a3a3b", 0.95, 0.0), "carpet_violet": ("#4a405e", 0.95, 0.0),
    "carpet_green": ("#3a5546", 0.95, 0.0), "carpet_navy": ("#2f3c57", 0.95, 0.0),
    "carpet_slate": ("#4b535d", 0.95, 0.0), "carpet_teal": ("#2b5a63", 0.95, 0.0),
    "carpet_plum": ("#5a3a55", 0.95, 0.0), "carpet_charcoal": ("#2f3238", 0.95, 0.0),
    "wood": ("#a5733f", 0.5, 0.0),
    "tile": ("#9ba1a9", 0.5, 0.0),
    # architecture
    "wall": ("#dcd5cb", 0.85, 0.0), "baseboard": ("#4e4842", 0.6, 0.0),
    "alu": ("#b9bfc6", 0.32, 0.85), "slab": ("#2a2d33", 0.9, 0.0), "cap_wood": ("#7b5434", 0.45, 0.0),
    "glass": ("#cfe4f7", 0.05, 0.0, {"alpha": 0.18}),
    # furniture
    "desk_wood": ("#b98a5a", 0.45, 0.0), "walnut": ("#4a2c1c", 0.38, 0.0), "walnut_light": ("#5c3a25", 0.4, 0.0),
    "metal_dark": ("#2a2d33", 0.4, 0.6), "black_plastic": ("#17181b", 0.5, 0.0), "chrome": ("#d4d8dd", 0.15, 1.0),
    "brass": ("#b58e55", 0.32, 0.9), "red_accent": ("#c4262d", 0.45, 0.0), "chair_black": ("#1b1c1f", 0.55, 0.0),
    "mesh_grey": ("#3d4148", 0.8, 0.0), "leather_brown": ("#6e3f24", 0.42, 0.0),
    "neon_back": ("#101216", 0.4, 0.0), "bag_red": ("#9e2328", 0.48, 0.0), "chain": ("#9aa1a9", 0.35, 0.9),
    "can_green": ("#2fbf4f", 0.25, 0.6), "can_black": ("#1d1f22", 0.25, 0.6), "can_pink": ("#ff4d8a", 0.25, 0.6),
    "shelf_wood": ("#6a4830", 0.5, 0.0),
    "book_0": ("#8c2f39", 0.7, 0.0), "book_1": ("#2f5d8a", 0.7, 0.0), "book_2": ("#d9b44a", 0.7, 0.0),
    "book_3": ("#3e7c59", 0.7, 0.0), "book_4": ("#e8e2d0", 0.7, 0.0), "book_5": ("#5b4b8a", 0.7, 0.0),
    "book_6": ("#c8642e", 0.7, 0.0), "book_7": ("#2b2d33", 0.7, 0.0),
    "pot_ceramic": ("#e6e1d8", 0.45, 0.0), "pot_terracotta": ("#b4643f", 0.7, 0.0), "soil": ("#3a2a1e", 0.95, 0.0),
    "leaf_dark": ("#2f6b3b", 0.65, 0.0), "leaf_light": ("#4e9a53", 0.65, 0.0), "trunk": ("#6b4a2e", 0.8, 0.0),
    "globe_wood": ("#5a3a22", 0.45, 0.0), "globe_ocean": ("#2c6ba3", 0.35, 0.0), "globe_land": ("#c9b27a", 0.6, 0.0),
    "mustard": ("#b8862e", 0.85, 0.0), "cabinet_grey": ("#7a8189", 0.45, 0.5),
    "safe_metal": ("#2e343b", 0.4, 0.6), "safe_door": ("#3b434c", 0.35, 0.6),
    "rack_black": ("#14161a", 0.5, 0.3), "rack_door": ("#1f242b", 0.35, 0.4), "rack_unit": ("#2c323a", 0.45, 0.3),
    "headset_cyan": ("#22d3ee", 0.35, 0.0),
    "table_wood": ("#7c4d2b", 0.4, 0.0), "printer_white": ("#e3e3e0", 0.45, 0.0), "printer_dark": ("#3a3d42", 0.45, 0.0),
    "bench_fabric": ("#475a70", 0.85, 0.0), "cabinet_navy": ("#2f4059", 0.45, 0.0), "stone": ("#e8e4dd", 0.25, 0.0),
    "steel": ("#c6cace", 0.3, 0.85), "cooler_white": ("#eef0f2", 0.35, 0.0), "bottle_blue": ("#4f9fe0", 0.08, 0.0),
    "couch_fabric": ("#8a4a35", 0.85, 0.0), "couch_cushion": ("#9c5a42", 0.85, 0.0), "pillow_gold": ("#d9b26a", 0.8, 0.0),
    "rug_border": ("#33445c", 0.95, 0.0), "rug_field": ("#c9b892", 0.95, 0.0),
    "frame_dark": ("#2b2f36", 0.4, 0.5), "mug_white": ("#f2f2f0", 0.3, 0.0), "paper_yellow": ("#f2d36b", 0.7, 0.0),
    "tap_red": ("#d33a3a", 0.4, 0.0), "tap_blue": ("#3a6fd3", 0.4, 0.0),
    # screen housings
    "tv_black": ("#0b0c0f", 0.35, 0.2), "board_white": ("#f3f4f5", 0.3, 0.0), "board_slate": ("#22282b", 0.8, 0.0),
    "frame_wood": ("#7a5232", 0.5, 0.0), "dark_wood": ("#3b2617", 0.45, 0.0), "frame_black": ("#15171b", 0.4, 0.0),
    "marker_red": ("#d23b3b", 0.4, 0.0), "marker_blue": ("#2f5fd0", 0.4, 0.0), "marker_green": ("#2f9e4f", 0.4, 0.0),
    "chalk": ("#f1efe8", 0.9, 0.0),
    # lamps
    "lamp_shade": ("#1c1e22", 0.4, 0.5), "lamp_glow": ("#fff1d6", 0.4, 0.0, {"emit": "#ffe6b8", "strength": 2.0}),
    "clock_face": ("#f4f2ec", 0.4, 0.0),
}

MATS = {}


def _principled(m):
    for n in m.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            return n
    raise RuntimeError("no principled node")


def new_mat(name, color, rough=0.6, metal=0.0, alpha=1.0, emit=None, strength=1.0):
    if name in MATS:
        return name
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = _principled(m)
    rgb = hexrgb(color)
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
    if emit:
        b.inputs["Emission Color"].default_value = (*hexrgb(emit), 1.0)
        b.inputs["Emission Strength"].default_value = strength
    m.diffuse_color = (*rgb, alpha)
    m.use_backface_culling = True
    MATS[name] = m
    return name


def ensure(name):
    if name in MATS:
        return name
    if name not in PAL:
        raise KeyError("material not in palette: " + name)
    spec = PAL[name]
    extra = spec[3] if len(spec) > 3 else {}
    return new_mat(name, spec[0], spec[1], spec[2], alpha=extra.get("alpha", 1.0),
                   emit=extra.get("emit"), strength=extra.get("strength", 1.0))


# --------------------------------------------------------------------------
# geometry
# --------------------------------------------------------------------------

I4 = Matrix.Identity(4)


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def Rz(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def Rx(deg):
    return Matrix.Rotation(math.radians(deg), 4, "X")


def Ry(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Y")


def S(x, y, z):
    return Matrix.Diagonal((x, y, z, 1.0))


def B(x, y, z):
    """three.js point -> Blender point."""
    return Vector((x, -z, y))


def _newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    k = len(pts)
    for i in range(k):
        a, b = pts[i], pts[(i + 1) % k]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


class Geo:
    """Accumulates polygons (with per-face material and smooth flag) for one object."""

    def __init__(self):
        self.v, self.f, self.fm, self.fs, self.mats = [], [], [], [], []
        self.uv = None

    def add(self, verts, faces, mat, smooth=False, M=None, fix=True, refs=None):
        vs = [Vector(p) for p in verts]
        cen = sum(vs, Vector()) / len(vs)
        out = []
        for k, f in enumerate(faces):
            f = list(f)
            if fix:
                pts = [vs[i] for i in f]
                n = _newell(pts)
                fc = sum(pts, Vector()) / len(pts)
                ref = Vector(refs[k]) if refs is not None else cen
                if n.dot(fc - ref) < 0:
                    f.reverse()
            out.append(f)
        if M is not None:
            vs = [M @ p for p in vs]
        base = len(self.v)
        self.v.extend((p.x, p.y, p.z) for p in vs)
        ensure(mat)
        if mat not in self.mats:
            self.mats.append(mat)
        mi = self.mats.index(mat)
        for k, f in enumerate(out):
            self.f.append([base + i for i in f])
            self.fm.append(mi)
            self.fs.append(bool(smooth[k]) if isinstance(smooth, (list, tuple)) else bool(smooth))


def _xf(c, R, M):
    m = T(*c)
    if R is not None:
        m = m @ R
    if M is not None:
        m = M @ m
    return m


_BOX_FACES = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]


def box(g, c, s, mat, bev=0.0, R=None, M=None):
    """Axis-aligned box (centre c, size s) with an optional chamfer bevel."""
    hx, hy, hz = abs(s[0]) / 2, abs(s[1]) / 2, abs(s[2]) / 2
    b = min(bev, hx * 0.45, hy * 0.45, hz * 0.45)
    if b < 0.0025:
        verts = [(sx * hx, sy * hy, sz * hz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
        g.add(verts, _BOX_FACES, mat, False, _xf(c, R, M))
        return
    idx, verts = {}, []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                idx[(sx, sy, sz, "x")] = len(verts)
                verts.append((sx * hx, sy * (hy - b), sz * (hz - b)))
                idx[(sx, sy, sz, "y")] = len(verts)
                verts.append((sx * (hx - b), sy * hy, sz * (hz - b)))
                idx[(sx, sy, sz, "z")] = len(verts)
                verts.append((sx * (hx - b), sy * (hy - b), sz * hz))
    F = []
    for s_ in (-1, 1):
        F.append([idx[(s_, -1, -1, "x")], idx[(s_, 1, -1, "x")], idx[(s_, 1, 1, "x")], idx[(s_, -1, 1, "x")]])
        F.append([idx[(-1, s_, -1, "y")], idx[(1, s_, -1, "y")], idx[(1, s_, 1, "y")], idx[(-1, s_, 1, "y")]])
        F.append([idx[(-1, -1, s_, "z")], idx[(1, -1, s_, "z")], idx[(1, 1, s_, "z")], idx[(-1, 1, s_, "z")]])
    for a in (-1, 1):
        for b2 in (-1, 1):
            F.append([idx[(-1, a, b2, "y")], idx[(1, a, b2, "y")], idx[(1, a, b2, "z")], idx[(-1, a, b2, "z")]])
            F.append([idx[(a, -1, b2, "x")], idx[(a, 1, b2, "x")], idx[(a, 1, b2, "z")], idx[(a, -1, b2, "z")]])
            F.append([idx[(a, b2, -1, "x")], idx[(a, b2, 1, "x")], idx[(a, b2, 1, "y")], idx[(a, b2, -1, "y")]])
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                F.append([idx[(sx, sy, sz, "x")], idx[(sx, sy, sz, "y")], idx[(sx, sy, sz, "z")]])
    g.add(verts, F, mat, False, _xf(c, R, M))


def tbox(g, c, bot, top, h, mat, off=(0.0, 0.0), R=None, M=None):
    """Tapered box: bottom rect `bot` at z=0, top rect `top` at z=h (local), base centre c."""
    verts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (0, 1):
                d = top if sz else bot
                ox, oy = (off if sz else (0.0, 0.0))
                verts.append((ox + sx * d[0] / 2, oy + sy * d[1] / 2, h * sz))
    g.add(verts, _BOX_FACES, mat, False, _xf(c, R, M))


def cyl(g, c, r, h, mat, seg=16, r2=None, caps=(True, True), R=None, M=None, smooth=True):
    """Cylinder / frustum along local +Z from base centre c."""
    r2 = r if r2 is None else max(r2, 1e-4)
    verts = [(r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg), 0.0) for i in range(seg)]
    verts += [(r2 * math.cos(2 * math.pi * i / seg), r2 * math.sin(2 * math.pi * i / seg), h) for i in range(seg)]
    faces, sm = [], []
    for i in range(seg):
        j = (i + 1) % seg
        faces.append([i, j, seg + j, seg + i])
        sm.append(smooth)
    if caps[0]:
        faces.append(list(range(seg)))
        sm.append(False)
    if caps[1]:
        faces.append(list(range(seg, 2 * seg)))
        sm.append(False)
    g.add(verts, faces, mat, sm, _xf(c, R, M))


def sphere(g, c, r, mat, seg=16, rings=10, scale=(1, 1, 1), R=None, M=None, cut=None, smooth=True):
    """UV sphere (ellipsoid via scale). cut=z in [-1,1] trims below with a flat cap (dome)."""
    phi_end = math.pi if cut is None else math.acos(max(-1.0, min(1.0, cut)))
    verts = [(0.0, 0.0, 1.0)]
    nring = rings - 1 if cut is None else rings
    for k in range(1, nring + 1):
        phi = (math.pi * k / rings) if cut is None else (phi_end * k / rings)
        for i in range(seg):
            th = 2 * math.pi * i / seg
            verts.append((math.sin(phi) * math.cos(th), math.sin(phi) * math.sin(th), math.cos(phi)))
    faces, sm = [], []
    for i in range(seg):
        faces.append([0, 1 + i, 1 + (i + 1) % seg])
        sm.append(smooth)
    for k in range(nring - 1):
        a0, b0 = 1 + k * seg, 1 + (k + 1) * seg
        for i in range(seg):
            j = (i + 1) % seg
            faces.append([a0 + i, a0 + j, b0 + j, b0 + i])
            sm.append(smooth)
    last = 1 + (nring - 1) * seg
    if cut is None:
        verts.append((0.0, 0.0, -1.0))
        bp = len(verts) - 1
        for i in range(seg):
            faces.append([last + i, bp, last + (i + 1) % seg])
            sm.append(smooth)
    else:
        faces.append([last + i for i in range(seg)])
        sm.append(False)
    sx, sy, sz = r * scale[0], r * scale[1], r * scale[2]
    verts = [(x * sx, y * sy, z * sz) for (x, y, z) in verts]
    g.add(verts, faces, mat, sm, _xf(c, R, M))


def torus(g, c, R0, r, mat, seg=16, seg2=6, arc=360.0, a0=0.0, R=None, M=None, smooth=True):
    """Torus (or arc of one) around local Z in the XY plane."""
    full = arc >= 359.999
    n = seg if full else seg + 1
    verts = []
    for i in range(n):
        th = math.radians(a0 + arc * i / seg)
        for j in range(seg2):
            ph = 2 * math.pi * j / seg2
            rr = R0 + r * math.cos(ph)
            verts.append((rr * math.cos(th), rr * math.sin(th), r * math.sin(ph)))
    faces, refs, sm = [], [], []
    for i in range(seg):
        i2 = (i + 1) % n
        th = math.radians(a0 + arc * (i + 0.5) / seg)
        ref = (R0 * math.cos(th), R0 * math.sin(th), 0.0)
        for j in range(seg2):
            j2 = (j + 1) % seg2
            faces.append([i * seg2 + j, i2 * seg2 + j, i2 * seg2 + j2, i * seg2 + j2])
            refs.append(ref)
            sm.append(smooth)
    if not full:
        for i, sgn in ((0, 1), (seg, -1)):
            th = math.radians(a0 + arc * i / seg + sgn * 1.0)
            faces.append([i * seg2 + j for j in range(seg2)])
            refs.append((R0 * math.cos(th), R0 * math.sin(th), 0.0))
            sm.append(False)
    g.add(verts, faces, mat, sm, _xf(c, R, M), refs=refs)


def quad(g, w, h, mat):
    """Front-facing (-Y) quad in the XZ plane, centred at the origin, CCW seen from the front."""
    verts = [(-w / 2, 0.0, -h / 2), (w / 2, 0.0, -h / 2), (w / 2, 0.0, h / 2), (-w / 2, 0.0, h / 2)]
    g.add(verts, [[0, 1, 2, 3]], mat, False, None, fix=False)
    g.uv = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]


def ring(g, w, h, b, y0, y1, mat, bev=0.0, zc=0.0):
    """Rectangular frame of width b around a w x h opening, depth y0..y1 (local)."""
    yc, yd = (y0 + y1) / 2, abs(y1 - y0)
    box(g, (0, yc, zc + h / 2 + b / 2), (w + 2 * b, yd, b), mat, bev)
    box(g, (0, yc, zc - h / 2 - b / 2), (w + 2 * b, yd, b), mat, bev)
    box(g, (-w / 2 - b / 2, yc, zc), (b, yd, h), mat, bev)
    box(g, (w / 2 + b / 2, yc, zc), (b, yd, h), mat, bev)


def make_obj(name, g, loc=(0.0, 0.0, 0.0), rotz=0.0, origin=None):
    if name in bpy.data.objects:
        raise RuntimeError("duplicate object name " + name)
    verts = g.v
    if origin is not None:
        ox, oy, oz = origin
        verts = [(x - ox, y - oy, z - oz) for (x, y, z) in verts]
        loc = origin
    me = bpy.data.meshes.new("geo_mesh_" + name)
    me.from_pydata(verts, [], g.f)
    for mname in g.mats:
        me.materials.append(MATS[mname])
    me.polygons.foreach_set("material_index", g.fm)
    me.polygons.foreach_set("use_smooth", g.fs)
    if g.uv is not None:
        uvl = me.uv_layers.new(name="UVMap")
        for li, loop in enumerate(me.loops):
            uvl.data[li].uv = g.uv[loop.vertex_index % len(g.uv)]
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(loc)
    ob.rotation_euler = (0.0, 0.0, math.radians(rotz))
    return ob


# --------------------------------------------------------------------------
# layout helpers
# --------------------------------------------------------------------------


def local_of(item, px, pz):
    """three.js floor point -> the item's local (Blender) frame."""
    x, z = item["pos"]
    v = Vector((px - x, -(pz - z), 0.0))
    return Matrix.Rotation(-math.radians(item.get("rot", 0)), 3, "Z") @ v


SUPPORTS = ("desk", "counter", "meeting_table", "coffee_table", "bar_table")
TABLETOP = ("keyboard", "energy_cans", "headset_stand", "coffee_machine")


def support_height(item):
    """Height of the surface an item stands on (onTop, or the desk/counter under it)."""
    if item.get("onTop") is not None:
        return float(item["onTop"])
    if item["kind"] not in TABLETOP:
        return 0.0
    for f in FURN:
        if f["kind"] in SUPPORTS and f is not item:
            lv = local_of(f, *item["pos"])
            if abs(lv.x) <= f["size"][0] / 2 and abs(lv.y) <= f["size"][2] / 2:
                return float(f["size"][1])
    return 0.0


def sitter_side(desk):
    """Local-y sign of the side a desk's chair is on (-1 = front)."""
    best, bd = None, 9e9
    for f in FURN:
        if f["kind"] == "office_chair":
            d = math.hypot(f["pos"][0] - desk["pos"][0], f["pos"][1] - desk["pos"][1])
            if d < bd:
                best, bd = f, d
    if best is None or bd > 2.0:
        return -1.0
    return 1.0 if local_of(desk, *best["pos"]).y > 0 else -1.0


def glass_gap_behind(s):
    """Free depth behind a screen before a glass pane it is mounted on (None if not on glass)."""
    cx, cy, cz = s["center"]
    yaw = math.radians(s["facing"])
    fx, fz = math.sin(yaw), math.cos(yaw)
    bottom = cy - s["size"][1] / 2
    best = None
    for wl in LAYOUT["walls"]:
        if wl["kind"] != "glass" or bottom >= wl["height"]:
            continue
        (ax, az), (bx, bz) = wl["a"], wl["b"]
        if abs(az - bz) < 1e-6 and abs(fz) > 0.9 and min(ax, bx) <= cx <= max(ax, bx):
            dist = (cz - az) * fz
        elif abs(ax - bx) < 1e-6 and abs(fx) > 0.9 and min(az, bz) <= cz <= max(az, bz):
            dist = (cx - ax) * fx
        else:
            continue
        if 0 < dist < 0.3:
            gap = dist - PANE / 2
            best = gap if best is None else min(best, gap)
    return best


def wall_top_below(s):
    """Top of a wall right under a screen (for hanging the marquee housing on it)."""
    cx, cy, cz = s["center"]
    bottom = cy - s["size"][1] / 2
    for wl in LAYOUT["walls"]:
        (ax, az), (bx, bz) = wl["a"], wl["b"]
        if abs(az - bz) < 1e-6 and abs(cz - az) < 0.15 and min(ax, bx) - 0.1 <= cx <= max(ax, bx) + 0.1:
            if 0 <= bottom - wl["height"] < 0.4:
                return wl["height"]
        if abs(ax - bx) < 1e-6 and abs(cx - ax) < 0.15 and min(az, bz) - 0.1 <= cz <= max(az, bz) + 0.1:
            if 0 <= bottom - wl["height"] < 0.4:
                return wl["height"]
    return None


def screens_on_wall(wl):
    """Exclusion ranges (along the wall axis) for screens mounted on a glass wall."""
    (ax, az), (bx, bz) = wl["a"], wl["b"]
    horiz = abs(az - bz) < 1e-6
    out = []
    for s in SCREENS:
        cx, cy, cz = s["center"]
        if cy - s["size"][1] / 2 >= wl["height"]:
            continue
        yaw = math.radians(s["facing"])
        if horiz and abs(math.cos(yaw)) > 0.9 and abs(cz - az) < 0.2 and min(ax, bx) <= cx <= max(ax, bx):
            out.append((cx - s["size"][0] / 2 - 0.09, cx + s["size"][0] / 2 + 0.09))
        if (not horiz) and abs(math.sin(yaw)) > 0.9 and abs(cx - ax) < 0.2 and min(az, bz) <= cz <= max(az, bz):
            out.append((cz - s["size"][0] / 2 - 0.09, cz + s["size"][0] / 2 + 0.09))
    return out


# --------------------------------------------------------------------------
# rooms + walls
# --------------------------------------------------------------------------


def build_rooms():
    for r in LAYOUT["rooms"]:
        (x0, x1), (z0, z1) = r["x"], r["z"]
        g = Geo()
        verts = [(x0, -z0, 0.0), (x0, -z1, 0.0), (x1, -z1, 0.0), (x1, -z0, 0.0)]
        g.add(verts, [[0, 1, 2, 3]], r["floor"], False, None, fix=False)
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        make_obj(r["id"], g, origin=(cx, -cz, 0.0))
    # a dark base slab under the whole plan so the cutaway reads as a model
    (bx0, bx1), (bz0, bz1) = LAYOUT["bounds"]["x"], LAYOUT["bounds"]["z"]
    g = Geo()
    m = WALL_T / 2 + 0.02
    box(g, ((bx0 + bx1) / 2, -(bz0 + bz1) / 2, -0.085), (bx1 - bx0 + 2 * m, bz1 - bz0 + 2 * m, 0.15), "slab", 0.02)
    make_obj("geo_slab", g, origin=((bx0 + bx1) / 2, -(bz0 + bz1) / 2, 0.0))


def door_frame_at(u, c, horiz):
    for f in FURN:
        if f["kind"] == "door_frame":
            fx, fz = f["pos"]
            along, across = (fx, fz) if horiz else (fz, fx)
            if abs(across - c) < 0.2 and abs(along - u) < 1.5:
                return True
    return False


def build_walls():
    (bx0, bx1), (bz0, bz1) = LAYOUT["bounds"]["x"], LAYOUT["bounds"]["z"]
    t = WALL_T
    for wl in LAYOUT["walls"]:
        g = Geo()
        (ax, az), (bx, bz) = wl["a"], wl["b"]
        H, kind = float(wl["height"]), wl["kind"]
        horiz = abs(az - bz) < 1e-6
        if horiz:
            u0, u1 = sorted((ax, bx))
            c = az
            ext = abs(c - bz0) < 1e-6 or abs(c - bz1) < 1e-6
            mid = (bz0 + bz1) / 2
        else:
            u0, u1 = sorted((az, bz))
            c = ax
            ext = abs(c - bx0) < 1e-6 or abs(c - bx1) < 1e-6
            mid = (bx0 + bx1) / 2
        sides = [1.0 if c < mid else -1.0] if ext else [1.0, -1.0]

        def P(u, y, d):
            return Vector((u, -(c + d), y)) if horiz else Vector((c + d, -u, y))

        def wb(ua, ub, ya, yb, da, db, mat, bev=0.0):
            p0, p1 = P(ua, ya, da), P(ub, yb, db)
            box(g, tuple((p0 + p1) / 2), [abs(p1[i] - p0[i]) for i in range(3)], mat, bev)

        doors = sorted(tuple(sorted(dr)) for dr in wl.get("doors", []))
        spans, cur = [], u0
        for d0, d1 in doors:
            if d0 > cur:
                spans.append((cur, d0))
            cur = max(cur, d1)
        if cur < u1:
            spans.append((cur, u1))

        if kind in ("solid", "low"):
            for ua, ub in spans:
                ea = ua - t / 2 if abs(ua - u0) < 1e-6 else ua
                eb = ub + t / 2 if abs(ub - u1) < 1e-6 else ub
                wb(ea, eb, -0.01, H, -t / 2, t / 2, "wall")
                for sd in sides:
                    ba = ua + (t / 2 if abs(ua - u0) < 1e-6 else 0.0)
                    bb = ub - (t / 2 if abs(ub - u1) < 1e-6 else 0.0)
                    wb(ba, bb, 0.0, 0.1, sd * t / 2, sd * (t / 2 + 0.014), "baseboard", 0.003)
                if kind == "low":
                    wb(ea, eb, H - 0.045, H + 0.005, -t / 2 - 0.025, t / 2 + 0.025, "cap_wood", 0.008)
            for d0, d1 in doors:
                if H > DOOR_H + 0.2:
                    wb(d0, d1, DOOR_H + 0.05, H, -t / 2, t / 2, "wall")
                if not door_frame_at((d0 + d1) / 2, c, horiz):
                    top = min(H, DOOR_H + 0.05)
                    wb(d0, d0 + 0.04, 0.0, top, -t / 2 - 0.01, t / 2 + 0.01, "alu", 0.004)
                    wb(d1 - 0.04, d1, 0.0, top, -t / 2 - 0.01, t / 2 + 0.01, "alu", 0.004)

        elif kind == "window":
            ops = []
            for s in SCREENS:
                if s["kind"] != "window":
                    continue
                sx_, sy_, sz_ = s["center"]
                across, along = (sz_, sx_) if horiz else (sx_, sz_)
                if abs(across - c) < 0.25 and u0 <= along <= u1:
                    w_, h_ = s["size"]
                    ops.append((along - w_ / 2, along + w_ / 2, sy_ - h_ / 2, sy_ + h_ / 2))
            ops.sort()
            cur = u0 - t / 2
            for oa, ob_, ya, yb in ops:
                wb(cur, oa, -0.01, H, -t / 2, t / 2, "wall")
                wb(oa, ob_, -0.01, ya, -t / 2, t / 2, "wall")
                wb(oa, ob_, yb, H, -t / 2, t / 2, "wall")
                cur = ob_
            wb(cur, u1 + t / 2, -0.01, H, -t / 2, t / 2, "wall")
            sd = sides[0]
            for sd2 in sides:
                wb(u0 + t / 2, u1 - t / 2, 0.0, 0.1, sd2 * t / 2, sd2 * (t / 2 + 0.014), "baseboard", 0.003)
            fw = 0.055
            for oa, ob_, ya, yb in ops:
                din, dout = sd * (t / 2 + 0.035), -sd * (t / 2 + 0.01)
                da, db = min(din, dout), max(din, dout)
                wb(oa - fw, ob_ + fw, yb, yb + fw, da, db, "alu", 0.006)
                wb(oa - fw, oa, ya, yb, da, db, "alu", 0.006)
                wb(ob_, ob_ + fw, ya, yb, da, db, "alu", 0.006)
                sill_in = sd * (t / 2 + 0.11)
                wb(oa - fw - 0.04, ob_ + fw + 0.04, ya - 0.045, ya, min(sill_in, dout), max(sill_in, dout), "alu", 0.008)
                um = (oa + ob_) / 2
                wb(um - 0.03, um + 0.03, ya, yb, -0.03, 0.03, "alu", 0.004)
                yt = ya + (yb - ya) * 0.7
                wb(oa, ob_, yt - 0.025, yt + 0.025, -0.03, 0.03, "alu", 0.004)

        elif kind == "glass":
            fd = FRAME_D / 2
            excl = screens_on_wall(wl)
            for ua, ub in spans:
                wb(ua, ub, -0.01, 0.08, -t / 2, t / 2, "alu", 0.006)
                wb(ua, ub, 0.08, H - 0.06, -PANE / 2, PANE / 2, "glass")
                wb(ua, ua + 0.05, -0.01, H - 0.06, -fd, fd, "alu", 0.004)
                wb(ub - 0.05, ub, -0.01, H - 0.06, -fd, fd, "alu", 0.004)
                L = ub - ua
                n = max(0, int(math.ceil(L / 1.5)) - 1)
                for k in range(1, n + 1):
                    um = ua + L * k / (n + 1)
                    if any(lo <= um <= hi for lo, hi in excl):
                        continue
                    wb(um - 0.02, um + 0.02, 0.08, H - 0.06, -fd, fd, "alu", 0.004)
            for d0, d1 in doors:
                wb(d0 - 0.05, d1 + 0.05, DOOR_H, DOOR_H + 0.05, -fd, fd, "alu", 0.004)
                wb(d0, d1, DOOR_H + 0.05, H - 0.06, -PANE / 2, PANE / 2, "glass")
                wb(d0, d1, 0.0, 0.006, -t / 2 + 0.01, t / 2 - 0.01, "alu")   # threshold strip
            wb(u0, u1, H - 0.06, H, -0.05, 0.05, "alu", 0.006)

        make_obj(wl["id"], g, origin=tuple(P((u0 + u1) / 2, 0.0, 0.0)))


# --------------------------------------------------------------------------
# furniture builders (local frame: origin on the floor/surface at pos, front = -Y)
# --------------------------------------------------------------------------


def f_desk(g, it, w, h, d):
    ex = it.get("style") == "executive"
    s = sitter_side(it)
    top_t = 0.06 if ex else 0.05
    box(g, (0, 0, h - top_t / 2), (w, d, top_t), "walnut" if ex else "desk_wood", BEVEL)
    under = h - top_t
    if ex:
        pw = 0.46
        px = -w / 2 + pw / 2 + 0.03
        box(g, (px, 0, under / 2), (pw, d - 0.08, under), "walnut", 0.01)
        for k in range(3):
            zc = 0.13 + k * 0.215
            box(g, (px, s * (d / 2 - 0.04) + s * 0.006, zc), (pw - 0.05, 0.012, 0.19), "walnut_light", 0.004)
            box(g, (px, s * (d / 2 - 0.04) + s * 0.016, zc + 0.05), (0.12, 0.012, 0.014), "brass", 0.003)
        box(g, (w / 2 - 0.05, 0, under / 2), (0.07, d - 0.08, under), "walnut", 0.01)
        box(g, (0.1, -s * (d / 2 - 0.05), under / 2 + 0.06), (w - 0.62, 0.03, under - 0.12), "walnut", 0.008)
    else:
        for sx in (-1, 1):
            x = sx * (w / 2 - 0.12)
            box(g, (x, 0, 0.02), (0.07, d - 0.08, 0.04), "metal_dark", 0.008)
            box(g, (x, 0, under / 2), (0.06, 0.06, under), "metal_dark", 0.008)
            box(g, (x, 0, under - 0.02), (0.05, d - 0.12, 0.04), "metal_dark", 0.006)
        box(g, (0, -s * (d / 2 - 0.1), under - 0.2), (w - 0.36, 0.015, 0.32), "metal_dark", 0.004)


def f_office_chair(g, it, w, h, d):
    style = it.get("style", "mesh")
    shell = {"gaming": "chair_black", "mesh": "mesh_grey", "leather": "leather_brown"}.get(style, "mesh_grey")
    trim = {"gaming": "red_accent", "mesh": "black_plastic", "leather": "walnut"}.get(style, "black_plastic")
    base = "chrome" if style == "leather" else "black_plastic"
    for k in range(5):
        a = 90 + 72 * k
        box(g, (0.135, 0, 0.075), (0.27, 0.045, 0.035), base, 0.008, M=Rz(a))
        sphere(g, (0.27, 0, 0.027), 0.027, "black_plastic", seg=10, rings=6, M=Rz(a))
    cyl(g, (0, 0, 0.055), 0.05, 0.05, base, seg=14)
    cyl(g, (0, 0, 0.1), 0.022, 0.29, "chrome", seg=12)
    box(g, (0, 0, 0.4), (0.2, 0.2, 0.04), "black_plastic", 0.006)
    sw, sd = w * 0.84, d * 0.8
    box(g, (0, -0.02, 0.43), (sw, sd, 0.08), shell, 0.03)
    bz0 = 0.53
    bh = h - bz0
    back_y = d / 2 - 0.08
    box(g, (0, back_y - 0.02, 0.47), (0.08, 0.06, 0.12), "black_plastic", 0.01)
    tilt = Rx(-9)
    piv = T(0, back_y, bz0)
    box(g, (0, 0, bh / 2), (w * 0.76, 0.075, bh), shell, 0.03, M=piv @ tilt)
    if style == "gaming":
        for sx in (-1, 1):
            box(g, (sx * w * 0.36, -0.03, bh * 0.45), (0.06, 0.07, bh * 0.85), "red_accent", 0.02, M=piv @ tilt)
        box(g, (0, -0.05, bh - 0.12), (w * 0.4, 0.06, 0.12), "red_accent", 0.025, M=piv @ tilt)
        box(g, (0, -0.045, bh * 0.35), (w * 0.08, 0.02, bh * 0.4), "red_accent", 0.005, M=piv @ tilt)
    elif style == "leather":
        for k in range(3):
            box(g, (0, -0.042, 0.12 + k * bh * 0.27), (w * 0.7, 0.012, 0.02), "walnut", 0.004, M=piv @ tilt)
    for sx in (-1, 1):
        box(g, (sx * w * 0.43, 0.02, 0.56), (0.035, 0.05, 0.17), "black_plastic", 0.008)
        box(g, (sx * w * 0.43, 0.0, 0.655), (0.065, 0.25, 0.035), trim if style != "mesh" else "black_plastic", 0.012)


def key_name(it):
    return "mat_" + it["id"]


def f_keyboard(g, it, w, h, d):
    mat = key_name(it)
    if mat not in MATS:
        new_mat(mat, "#1b1d22", 0.5, 0.0)
    box(g, (0, 0, h * 0.3), (w, d, h * 0.6), mat, 0.006)
    rows = 5
    kw = (w - 0.03) / 4
    for r in range(rows):
        y = -d / 2 + 0.022 + r * (d - 0.044) / (rows - 1)
        for k in range(4):
            x = -w / 2 + 0.015 + kw * (k + 0.5)
            box(g, (x, y, h * 0.6 + h * 0.18), (kw - 0.008, (d - 0.05) / rows - 0.004, h * 0.36), mat)


def neon_screen_for(it):
    best, bd = None, 9e9
    for s in SCREENS:
        if s["kind"] == "neon":
            dd = math.hypot(s["center"][0] - it["pos"][0], s["center"][2] - it["pos"][1])
            if dd < bd:
                best, bd = s, dd
    return best if bd < 0.6 else None


def f_neon_frame(g, it, w, h, d):
    s = neon_screen_for(it)
    zc = s["center"][1] if s else 1.9
    sy = local_of(it, s["center"][0], s["center"][2]).y if s else -d / 2
    back = d / 2
    front = sy + 0.005
    box(g, (0, (front + back) / 2, zc), (w, back - front, h), "neon_back", 0.006)
    sw, sh = (s["size"] if s else (w - 0.1, h - 0.1))
    bw = max(0.02, (w - sw) / 2)
    bh = max(0.02, (h - sh) / 2)
    yc, yd = (sy - 0.006 + back) / 2, back - (sy - 0.006)
    box(g, (0, yc, zc + sh / 2 + bh / 2), (w, yd, bh), "frame_black", 0.004)
    box(g, (0, yc, zc - sh / 2 - bh / 2), (w, yd, bh), "frame_black", 0.004)
    box(g, (-sw / 2 - bw / 2, yc, zc), (bw, yd, sh), "frame_black", 0.004)
    box(g, (sw / 2 + bw / 2, yc, zc), (bw, yd, sh), "frame_black", 0.004)


def f_punching_bag(g, it, w, h, d):
    r = w / 2
    bot = 0.62
    cyl(g, (0, 0, bot), r, h - bot - 0.1, "bag_red", seg=20, caps=(False, False))
    sphere(g, (0, 0, bot), r, "bag_red", seg=20, rings=8, scale=(1, 1, 0.28))
    cyl(g, (0, 0, h - 0.16), r + 0.004, 0.06, "chair_black", seg=20, caps=(False, False))
    sphere(g, (0, 0, h - 0.1), r, "chair_black", seg=20, rings=8, scale=(1, 1, 0.22), cut=0.0)
    cyl(g, (0, 0, bot + 0.45), r + 0.003, 0.05, "chair_black", seg=20, caps=(False, False))
    apex = h + 0.24
    for k in range(4):
        a = math.radians(45 + 90 * k)
        p0 = Vector((math.cos(a) * r * 0.75, math.sin(a) * r * 0.75, h - 0.06))
        p1 = Vector((0, 0, apex))
        v = p1 - p0
        rot = v.to_track_quat("Z", "Y").to_matrix().to_4x4()
        cyl(g, (0, 0, 0), 0.006, v.length, "chain", seg=6, R=None, M=T(*p0) @ rot)
    torus(g, (0, 0, apex), 0.03, 0.006, "chain", seg=10, seg2=4, M=Rx(90))
    top = CEIL - 0.2
    z = apex + 0.04
    i = 0
    while z < top:
        torus(g, (0, 0, 0), 0.016, 0.0045, "chain", seg=8, seg2=4,
              M=T(0, 0, z) @ Rz(90 * (i % 2)) @ Rx(90) @ S(1, 1.45, 1))
        z += 0.034
        i += 1
    cyl(g, (0, 0, top), 0.012, 0.06, "chain", seg=8)
    cyl(g, (0, 0, top + 0.06), 0.09, 0.025, "metal_dark", seg=16)


def f_energy_cans(g, it, w, h, d):
    mats = ["can_green", "can_black", "can_pink"]
    r = min(d / 2 - 0.01, 0.034)
    for k, m in enumerate(mats):
        x = (k - 1) * (w / 3)
        y = 0.012 * (1 if k == 1 else -1)
        cyl(g, (x, y, 0.0), r, h - 0.012, m, seg=14)
        cyl(g, (x, y, h - 0.012), r * 0.92, 0.012, "chrome", seg=14)


def f_bookshelf(g, it, w, h, d):
    rnd = random.Random(it["id"])
    wood = "shelf_wood"
    box(g, (-w / 2 + 0.018, 0, h / 2), (0.036, d, h), wood, 0.006)
    box(g, (w / 2 - 0.018, 0, h / 2), (0.036, d, h), wood, 0.006)
    box(g, (0, 0, h - 0.02), (w, d, 0.04), wood, 0.006)
    box(g, (0, 0, 0.04), (w - 0.07, d, 0.08), wood, 0.004)
    box(g, (0, d / 2 - 0.009, h / 2), (w - 0.07, 0.018, h - 0.04), wood)
    n = 5
    z0, z1 = 0.08, h - 0.04
    step = (z1 - z0) / n
    for k in range(n):
        zb = z0 + k * step
        if k > 0:
            box(g, (0, 0, zb - 0.012), (w - 0.07, d - 0.02, 0.024), wood, 0.004)
        x = -w / 2 + 0.05
        xmax = w / 2 - 0.05
        while x < xmax - 0.03:
            if rnd.random() < 0.12:
                x += rnd.uniform(0.06, 0.18)
                continue
            bw = rnd.uniform(0.024, 0.055)
            if x + bw > xmax:
                break
            bh = rnd.uniform(0.62, 0.88) * (step - 0.03)
            bd = rnd.uniform(0.17, d - 0.07)
            box(g, (x + bw / 2, -d / 2 + 0.03 + bd / 2, zb + bh / 2), (bw, bd, bh), "book_%d" % rnd.randrange(8))
            x += bw + rnd.uniform(0.0, 0.006)


def f_plant(g, it, w, h, d):
    rnd = random.Random(it["id"])
    R = min(w, d) / 2 * 0.72
    ph = max(0.24, min(0.42, 0.3 * h))
    pot = "pot_terracotta" if rnd.random() < 0.4 else "pot_ceramic"
    cyl(g, (0, 0, 0), R * 0.74, ph, pot, seg=18, r2=R)
    cyl(g, (0, 0, ph - 0.025), R * 1.04, 0.03, pot, seg=18)
    cyl(g, (0, 0, ph - 0.05), R * 0.95, 0.03, "soil", seg=18, smooth=False)
    tall = h >= 1.2
    if tall:
        cyl(g, (0, 0, ph - 0.03), 0.018, h * 0.55, "trunk", seg=8)
        blobs = 7
        for k in range(blobs):
            a = 2 * math.pi * k / blobs + rnd.uniform(-0.3, 0.3)
            zt = ph + (h - ph) * rnd.uniform(0.35, 0.82)
            rr = (w / 2) * rnd.uniform(0.35, 0.6)
            rs = (w / 2) * rnd.uniform(0.4, 0.55)
            sphere(g, (math.cos(a) * rr * 0.6, math.sin(a) * rr * 0.6, zt), rs, "leaf_dark" if k % 2 else "leaf_light",
                   seg=12, rings=8, scale=(1, 1, 0.8))
        sphere(g, (0, 0, h - (w / 2) * 0.45), (w / 2) * 0.55, "leaf_light", seg=12, rings=8, scale=(1, 1, 0.85))
    else:
        for k in range(5):
            a = 2 * math.pi * k / 5 + rnd.uniform(-0.3, 0.3)
            rs = (w / 2) * rnd.uniform(0.45, 0.6)
            zt = ph + (h - ph) * rnd.uniform(0.3, 0.55)
            sphere(g, (math.cos(a) * rs * 0.5, math.sin(a) * rs * 0.5, zt), rs, "leaf_dark" if k % 2 else "leaf_light",
                   seg=12, rings=8, scale=(1, 1, 0.9))
        sphere(g, (0, 0, h - (w / 2) * 0.5), (w / 2) * 0.55, "leaf_light", seg=12, rings=8)


def f_globe(g, it, w, h, d):
    R = min(w / 2 - 0.02, 0.2)
    zc = h - R - 0.04
    cyl(g, (0, 0, 0), w / 2 * 0.85, 0.035, "globe_wood", seg=20)
    for k in range(3):
        a = 90 + 120 * k
        box(g, (0.1, 0, 0.12), (0.2, 0.035, 0.035), "globe_wood", 0.008, M=Rz(a) @ T(0.0, 0, 0) @ Ry(0))
    cyl(g, (0, 0, 0.03), 0.035, zc - R - 0.05, "globe_wood", seg=12)
    cyl(g, (0, 0, zc - R - 0.04), 0.06, 0.035, "brass", seg=14)
    tilt = T(0, 0, zc) @ Ry(23.5)
    sphere(g, (0, 0, 0), R, "globe_ocean", seg=24, rings=14, M=tilt)
    rnd = random.Random("globe")
    for k in range(5):
        lon, lat = rnd.uniform(0, 360), rnd.uniform(-40, 55)
        p = Vector((math.cos(math.radians(lat)) * math.cos(math.radians(lon)),
                    math.cos(math.radians(lat)) * math.sin(math.radians(lon)), math.sin(math.radians(lat))))
        rot = p.to_track_quat("Z", "Y").to_matrix().to_4x4()
        sphere(g, (0, 0, 0), R * rnd.uniform(0.32, 0.5), "globe_land", seg=10, rings=6, scale=(1, 0.7, 0.18),
               M=tilt @ T(*(p * (R * 0.94))) @ rot)
    torus(g, (0, 0, 0), R + 0.025, 0.007, "brass", seg=24, seg2=5, arc=200, a0=-100, M=tilt @ Rx(90) @ Rz(90))


def f_armchair(g, it, w, h, d):
    fab = "mustard"
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(g, (sx * (w / 2 - 0.07), sy * (d / 2 - 0.07), 0), 0.022, 0.09, "globe_wood", seg=8, r2=0.016)
    box(g, (0, 0, 0.09 + 0.14), (w, d, 0.28), fab, 0.03)
    box(g, (0, -0.06, 0.43), (w - 0.3, d - 0.28, 0.12), fab, 0.035)
    box(g, (0, d / 2 - 0.1, 0.37 + (h - 0.37) / 2), (w, 0.2, h - 0.37), fab, 0.04)
    for sx in (-1, 1):
        box(g, (sx * (w / 2 - 0.08), 0.0, 0.09 + 0.28), (0.16, d - 0.02, 0.56), fab, 0.04)


def f_filing_cabinet(g, it, w, h, d):
    box(g, (0, 0, h / 2), (w, d, h), "cabinet_grey", 0.01)
    n = 4
    dh = (h - 0.06) / n
    for k in range(n):
        zc = 0.04 + dh * (k + 0.5)
        box(g, (0, -d / 2 - 0.004, zc), (w - 0.04, 0.012, dh - 0.022), "cabinet_grey", 0.004)
        box(g, (0, -d / 2 - 0.016, zc + dh * 0.22), (0.14, 0.02, 0.018), "alu", 0.004)
        box(g, (0, -d / 2 - 0.011, zc - dh * 0.05), (0.08, 0.006, 0.035), "board_white")


def f_safe(g, it, w, h, d):
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(g, (sx * (w / 2 - 0.06), sy * (d / 2 - 0.06), 0.02), (0.06, 0.06, 0.04), "black_plastic", 0.006)
    box(g, (0, 0, 0.04 + (h - 0.04) / 2), (w, d, h - 0.04), "safe_metal", 0.03)
    box(g, (0, -d / 2 - 0.008, 0.04 + (h - 0.04) / 2), (w - 0.09, 0.02, h - 0.13), "safe_door", 0.012)
    zc = 0.04 + (h - 0.04) * 0.62
    cyl(g, (0.0, 0, 0), 0.065, 0.025, "brass", seg=20, M=T(0.08, -d / 2 - 0.018, zc) @ Rx(90))
    cyl(g, (0.0, 0, 0), 0.02, 0.03, "chrome", seg=10, M=T(0.08, -d / 2 - 0.042, zc) @ Rx(90))
    hz = 0.04 + (h - 0.04) * 0.38
    cyl(g, (0.0, 0, 0), 0.03, 0.03, "chrome", seg=12, M=T(0.08, -d / 2 - 0.018, hz) @ Rx(90))
    for k in range(3):
        box(g, (0.07, 0, 0), (0.14, 0.018, 0.018), "chrome", 0.004,
            M=T(0.08, -d / 2 - 0.045, hz) @ Ry(120 * k + 30))
    for zz in (0.25, h - 0.2):
        cyl(g, (0, 0, 0), 0.016, 0.08, "chrome", seg=8, M=T(-w / 2 + 0.03, -d / 2 - 0.01, zz - 0.04))


def rack_depth(it, d):
    for e in EMISSIVES:
        if e["kind"] != "led_panel":
            continue
        ax, ay, az = e["a"]
        lv = local_of(it, ax, az)
        if abs(lv.x) < it["size"][0] / 2 and -d / 2 <= lv.y < 0:
            return 2 * (abs(lv.y) - e["thickness"] / 2)
    return d


def f_server_rack(g, it, w, h, d):
    d = rack_depth(it, d)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(g, (sx * (w / 2 - 0.06), sy * (d / 2 - 0.06), 0), 0.025, 0.05, "black_plastic", seg=8)
    box(g, (0, 0, 0.05 + (h - 0.05) / 2), (w, d, h - 0.05), "rack_black", 0.012)
    box(g, (0, -d / 2 - 0.001, 0.05 + (h - 0.05) / 2), (w - 0.07, 0.006, h - 0.15), "rack_door", 0.002)
    for k in range(12):
        zc = 0.2 + k * (h - 0.4) / 11
        box(g, (0, -d / 2 - 0.0045, zc), (w - 0.14, 0.004, 0.07), "rack_unit")
    box(g, (w / 2 - 0.07, -d / 2 - 0.02, h * 0.55), (0.02, 0.03, 0.3), "chrome", 0.005)
    for k in range(4):
        box(g, (0, -d / 4 + k * d / 6, h + 0.004), (w - 0.12, 0.03, 0.01), "rack_unit")


def f_headset_stand(g, it, w, h, d):
    cyl(g, (0, 0, 0), w / 2, 0.015, "black_plastic", seg=16)
    cyl(g, (0, 0, 0.015), 0.008, h - 0.035, "chrome", seg=8)
    box(g, (0, 0, h - 0.012), (0.08, 0.026, 0.014), "black_plastic", 0.004)
    R0 = 0.082
    zc = h - 0.005 - R0
    torus(g, (0, 0, 0), R0, 0.009, "black_plastic", seg=14, seg2=5, arc=180, a0=0, M=T(0, 0, zc) @ Rx(90))
    for sx in (-1, 1):
        cyl(g, (0, 0, 0), 0.042, 0.032, "black_plastic", seg=14, M=T(sx * (R0 + 0.016), 0, zc - 0.02) @ Ry(90) @ T(0, 0, -0.016))
        cyl(g, (0, 0, 0), 0.034, 0.006, "headset_cyan", seg=14,
            M=T(sx * (R0 + 0.016 + 0.019), 0, zc - 0.02) @ Ry(90) @ T(0, 0, -0.003))


def f_meeting_table(g, it, w, h, d):
    box(g, (0, 0, h - 0.03), (w, d, 0.06), "table_wood", 0.02)
    for sx in (-1, 1):
        x = sx * (w / 2 - 0.65)
        box(g, (x, 0, (h - 0.06) / 2), (0.14, d * 0.45, h - 0.06), "metal_dark", 0.01)
        box(g, (x, 0, 0.02), (0.18, d * 0.75, 0.04), "metal_dark", 0.01)
    box(g, (0, 0, h + 0.004), (w * 0.4, 0.12, 0.008), "black_plastic", 0.002)


def f_meeting_chair(g, it, w, h, d):
    box(g, (0, -0.01, 0.435), (w * 0.88, d * 0.84, 0.07), "chair_black", 0.025)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(g, (sx * (w / 2 - 0.07), sy * (d / 2 - 0.08), 0), 0.012, 0.4, "chrome", seg=8)
    bh = h - 0.52
    piv = T(0, d / 2 - 0.07, 0.52) @ Rx(-7)
    box(g, (0, 0, bh / 2 + 0.02), (w * 0.84, 0.05, bh - 0.04), "chair_black", 0.02, M=piv)
    for sx in (-1, 1):
        cyl(g, (sx * (w * 0.3), d / 2 - 0.06, 0.4), 0.01, 0.2, "chrome", seg=6)


def f_printer(g, it, w, h, d):
    bh = h - 0.15
    box(g, (0, 0, bh / 2), (w, d, bh), "printer_white", 0.02)
    for k in range(2):
        zc = 0.12 + k * 0.17
        box(g, (0, -d / 2 - 0.004, zc), (w - 0.08, 0.012, 0.14), "printer_white", 0.006)
        box(g, (0, -d / 2 - 0.014, zc + 0.04), (0.18, 0.012, 0.02), "printer_dark", 0.004)
    box(g, (0, -d / 2 + 0.06, bh - 0.12), (w - 0.16, 0.14, 0.05), "printer_dark", 0.006)
    box(g, (0, 0.02, bh + 0.04), (w * 0.96, d * 0.86, 0.08), "printer_dark", 0.012)
    box(g, (0, 0.04, bh + 0.11), (w * 0.8, d * 0.6, 0.06), "printer_white", 0.012)
    box(g, (w / 2 - 0.12, -d / 2 + 0.05, bh + 0.02), (0.18, 0.08, 0.05), "printer_dark", 0.006, R=Rx(18))
    box(g, (-0.08, -d / 2 + 0.11, bh - 0.06), (0.24, 0.16, 0.004), "board_white")


def f_bench(g, it, w, h, d):
    for sx in (-1, 1):
        box(g, (sx * (w / 2 - 0.1), 0, 0.17), (0.05, d - 0.08, 0.34), "metal_dark", 0.008)
    box(g, (0, 0, 0.36), (w, d, 0.05), "table_wood", 0.012)
    box(g, (0, 0, 0.36 + 0.025 + (h - 0.385) / 2), (w - 0.04, d - 0.04, h - 0.385), "bench_fabric", 0.03)
    for sx in (-1, 1):
        box(g, (sx * w * 0.3, d / 2 - 0.12, h + 0.1), (0.38, 0.12, 0.3), "pillow_gold", 0.05, R=Rx(-12))


def f_counter(g, it, w, h, d):
    top = 0.04
    box(g, (0, 0.04, 0.05), (w, d - 0.12, 0.1), "baseboard")
    cd = d - 0.03
    box(g, (0, 0.015, 0.1 + (h - top - 0.1) / 2), (w, cd, h - top - 0.1), "cabinet_navy", 0.006)
    n = max(1, int(round(w / 0.6)))
    dw = w / n
    for k in range(n):
        x = -w / 2 + dw * (k + 0.5)
        box(g, (x, 0.015 - cd / 2 - 0.006, 0.1 + (h - top - 0.1) / 2), (dw - 0.012, 0.012, h - top - 0.13), "cabinet_navy", 0.004)
        box(g, (x, 0.015 - cd / 2 - 0.02, h - top - 0.08), (dw * 0.45, 0.016, 0.016), "alu", 0.004)
    box(g, (0, 0, h - top / 2), (w, d, top), "stone", 0.006)
    sx = min(w / 2 - 0.5, 1.2)
    box(g, (sx, -0.02, h + 0.002), (0.5, 0.38, 0.006), "steel", 0.002)
    cyl(g, (sx, d / 2 - 0.12, h), 0.018, 0.26, "chrome", seg=10)
    torus(g, (0, 0, 0), 0.07, 0.014, "chrome", seg=10, seg2=5, arc=180, a0=0,
          M=T(sx, d / 2 - 0.12 - 0.07, h + 0.26) @ Rz(90) @ Rx(90))


def f_coffee_machine(g, it, w, h, d):
    box(g, (0, d * 0.2, h * 0.5), (w, d * 0.6, h), "black_plastic", 0.015)
    box(g, (0, -d * 0.12, h - 0.06), (w, d * 0.75, 0.12), "black_plastic", 0.015)
    box(g, (0, -d * 0.18, 0.02), (w * 0.85, d * 0.6, 0.04), "steel", 0.006)
    cyl(g, (0, -d * 0.25, h - 0.17), 0.018, 0.05, "chrome", seg=10)
    cyl(g, (0, -d * 0.25, 0.04), 0.035, 0.08, "mug_white", seg=14)
    cyl(g, (-0.05, 0.05, h), 0.075, 0.12, "dark_wood", seg=16, r2=0.09)
    box(g, (0.1, -d / 2 + 0.035, h - 0.06), (0.12, 0.012, 0.05), "rack_door", 0.003)


def f_fridge(g, it, w, h, d):
    box(g, (0, 0, 0.04), (w - 0.04, d - 0.06, 0.08), "black_plastic")
    box(g, (0, 0.01, 0.08 + (h - 0.08) / 2), (w, d - 0.02, h - 0.08), "steel", 0.02)
    split = 0.08 + (h - 0.08) * 0.62
    for z0, z1 in ((0.1, split - 0.012), (split + 0.012, h - 0.02)):
        box(g, (0, -d / 2 + 0.0, (z0 + z1) / 2), (w - 0.02, 0.025, z1 - z0), "steel", 0.008)
        hz0 = z0 + 0.08 if z0 > 0.5 else z1 - 0.45
        hz1 = z0 + 0.48 if z0 > 0.5 else z1 - 0.05
        box(g, (w / 2 - 0.07, -d / 2 - 0.035, (hz0 + hz1) / 2), (0.022, 0.025, hz1 - hz0), "chrome", 0.006)


def f_watercooler(g, it, w, h, d):
    bh = 0.95
    box(g, (0, 0, bh / 2), (w, d, bh), "cooler_white", 0.02)
    box(g, (0, -d / 2 - 0.004, 0.63), (w * 0.62, 0.012, 0.2), "rack_door", 0.004)
    box(g, (0, -d / 2 - 0.02, 0.55), (w * 0.6, 0.06, 0.02), "chrome", 0.004)
    box(g, (-0.06, -d / 2 - 0.02, 0.76), (0.04, 0.04, 0.05), "tap_blue", 0.006)
    box(g, (0.06, -d / 2 - 0.02, 0.76), (0.04, 0.04, 0.05), "tap_red", 0.006)
    br = w * 0.4
    cyl(g, (0, 0, bh), 0.045, 0.05, "bottle_blue", seg=14)
    cyl(g, (0, 0, bh + 0.05), br * 0.6, 0.05, "bottle_blue", seg=20, r2=br, caps=(True, False))
    cyl(g, (0, 0, bh + 0.1), br, h - bh - 0.1 - br * 0.5, "bottle_blue", seg=20, caps=(False, False))
    sphere(g, (0, 0, h - br * 0.5), br, "bottle_blue", seg=20, rings=8, scale=(1, 1, 0.5), cut=0.0)
    for zz in (bh + 0.22, bh + 0.3):
        cyl(g, (0, 0, zz), br + 0.003, 0.012, "bottle_blue", seg=20, caps=(False, False))


def f_couch(g, it, w, h, d):
    fab, cus = "couch_fabric", "couch_cushion"
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(g, (sx * (w / 2 - 0.1), sy * (d / 2 - 0.1), 0.05), (0.06, 0.06, 0.1), "globe_wood", 0.01)
    box(g, (0, 0, 0.1 + 0.125), (w, d, 0.25), fab, 0.03)
    aw = 0.18
    for sx in (-1, 1):
        box(g, (sx * (w / 2 - aw / 2), 0, 0.1 + 0.27), (aw, d, 0.54), fab, 0.04)
    box(g, (0, d / 2 - 0.11, 0.35 + (h - 0.35) / 2), (w, 0.22, h - 0.35), fab, 0.04)
    n = 3
    cw = (w - 2 * aw) / n
    for k in range(n):
        x = -w / 2 + aw + cw * (k + 0.5)
        box(g, (x, -0.06, 0.35 + 0.07), (cw - 0.015, d - 0.32, 0.14), cus, 0.04)
        box(g, (x, d / 2 - 0.3, 0.49 + 0.17), (cw - 0.02, 0.15, 0.34), cus, 0.05, R=Rx(-10))
    for sx in (-1, 1):
        box(g, (sx * (w / 2 - aw - 0.22), d / 2 - 0.4, 0.62), (0.36, 0.11, 0.3), "pillow_gold", 0.05, R=Rz(sx * 12) @ Rx(-14))


def f_coffee_table(g, it, w, h, d):
    box(g, (0, 0, h - 0.02), (w, d, 0.04), "table_wood", 0.012)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(g, (sx * (w / 2 - 0.05), sy * (d / 2 - 0.05), (h - 0.04) / 2), (0.035, 0.035, h - 0.04), "metal_dark", 0.006)
    box(g, (0, 0, 0.12), (w - 0.08, d - 0.08, 0.02), "metal_dark", 0.004)
    box(g, (-w * 0.22, 0.02, h + 0.015), (0.26, 0.2, 0.03), "book_1", 0.004)
    box(g, (-w * 0.22, 0.02, h + 0.04), (0.22, 0.17, 0.02), "book_6", 0.004, R=Rz(8))
    cyl(g, (w * 0.25, -0.05, h), 0.05, 0.12, "pot_ceramic", seg=14, r2=0.035)
    sphere(g, (w * 0.25, -0.05, h + 0.17), 0.07, "leaf_light", seg=10, rings=6)


def f_rug(g, it, w, h, d):
    box(g, (0, 0, 0.001 + h / 2), (w, d, h), "rug_border", 0.004)
    box(g, (0, 0, 0.001 + h / 2 + 0.002), (w - 0.32, d - 0.32, h), "rug_field", 0.003)


def f_bar_table(g, it, w, h, d):
    cyl(g, (0, 0, h - 0.04), w / 2, 0.04, "table_wood", seg=32)
    cyl(g, (0, 0, 0.03), 0.04, h - 0.07, "metal_dark", seg=12)
    cyl(g, (0, 0, 0), 0.26, 0.03, "metal_dark", seg=24)
    torus(g, (0, 0, 0.32), 0.2, 0.011, "chrome", seg=24, seg2=5)
    for k in range(3):
        box(g, (0.11, 0, 0.32), (0.18, 0.016, 0.016), "chrome", M=Rz(30 + 120 * k))


def f_bar_stool(g, it, w, h, d):
    cyl(g, (0, 0, h - 0.06), w / 2 * 0.95, 0.06, "chair_black", seg=24)
    cyl(g, (0, 0, h - 0.075), 0.09, 0.015, "chrome", seg=14)
    cyl(g, (0, 0, 0.025), 0.024, h - 0.1, "chrome", seg=10)
    cyl(g, (0, 0, 0), 0.19, 0.025, "chrome", seg=20)
    torus(g, (0, 0, 0.3), 0.16, 0.01, "chrome", seg=20, seg2=5)
    for k in range(2):
        box(g, (0, 0, 0.3), (0.32, 0.014, 0.014), "chrome", M=Rz(90 * k))


def f_jumbotron(g, it, w, h, d):
    """The war room's hanging four-sided scoreboard: corner posts, top and bottom
    rails and a cap. The four faces are screens (jumbo_E/W/S/N), built with the
    other screens; the beacon sits on the cap; four cables run to the ceiling."""
    t = 0.04
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(g, (sx * (w / 2 - t / 2), sy * (d / 2 - t / 2), h / 2), (t, t, h), "tv_black", 0.004)
    for z in (t / 2, h - t / 2):
        for sx in (-1, 1):
            box(g, (sx * (w / 2 - t / 2), 0, z), (t, d, t), "tv_black", 0.004)
            box(g, (0, sx * (d / 2 - t / 2), z), (w, t, t), "tv_black", 0.004)
    box(g, (0, 0, h - 0.01), (w - 0.06, d - 0.06, 0.02), "metal_dark", 0.004)
    ceiling = float(LAYOUT.get("ceiling", 3.6))
    drop = max(0.05, ceiling - float(it.get("onTop", 0)) - h)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(g, (sx * (w / 2 - 0.12), sy * (d / 2 - 0.12), h), 0.006, drop, "chrome", seg=6)


def f_door_frame(g, it, w, h, d):
    for sx in (-1, 1):
        box(g, (sx * (w / 2 - 0.05), 0, h / 2), (0.1, d, h), "frame_dark", 0.01)
    box(g, (0, 0, h - 0.06), (w, d, 0.12), "frame_dark", 0.01)
    box(g, (0, 0, 0.004), (w - 0.2, d, 0.008), "alu")


BUILDERS = {
    "desk": f_desk, "office_chair": f_office_chair, "keyboard": f_keyboard, "neon_frame": f_neon_frame,
    "punching_bag": f_punching_bag, "energy_cans": f_energy_cans, "bookshelf": f_bookshelf, "plant": f_plant,
    "globe": f_globe, "armchair": f_armchair, "filing_cabinet": f_filing_cabinet, "safe": f_safe,
    "server_rack": f_server_rack, "headset_stand": f_headset_stand, "meeting_table": f_meeting_table,
    "meeting_chair": f_meeting_chair, "printer": f_printer, "bench": f_bench, "counter": f_counter,
    "coffee_machine": f_coffee_machine, "fridge": f_fridge, "watercooler": f_watercooler, "couch": f_couch,
    "coffee_table": f_coffee_table, "rug": f_rug, "bar_table": f_bar_table, "bar_stool": f_bar_stool,
    "door_frame": f_door_frame, "jumbotron": f_jumbotron,
}


def build_furniture():
    for it in FURN:
        w, h, d = it["size"]
        g = Geo()
        BUILDERS[it["kind"]](g, it, w, h, d)
        x, z = it["pos"]
        make_obj(it["id"], g, (x, -z, support_height(it)), it.get("rot", 0))


# --------------------------------------------------------------------------
# screens + housings
# --------------------------------------------------------------------------


def desk_under(px, pz):
    for f in FURN:
        if f["kind"] == "desk":
            lv = local_of(f, px, pz)
            if abs(lv.x) <= f["size"][0] / 2 + 0.05 and abs(lv.y) <= f["size"][2] / 2 + 0.1:
                return f
    return None


def monitor_below(s):
    for o in SCREENS:
        if o is s or o["kind"] != "monitor":
            continue
        if (abs(o["center"][0] - s["center"][0]) < 0.05 and abs(o["center"][2] - s["center"][2]) < 0.05
                and o["center"][1] < s["center"][1]):
            return o
    return None


def housing(s):
    kind = s["kind"]
    w, h = s["size"]
    g = Geo()
    gap = glass_gap_behind(s)

    def depth(want):
        return want if gap is None else max(0.003, min(want, gap - 0.005))

    if kind == "tv":
        b = 0.024
        ring(g, w, h, b, -0.004, 0.005, "tv_black", 0.004)
        dep = depth(0.035)
        box(g, (0, 0.005 + dep / 2, 0), (w + 2 * b, dep, h + 2 * b), "tv_black", 0.006)
    elif kind == "monitor":
        b = 0.012
        ring(g, w, h, b, -0.003, 0.005, "tv_black", 0.002)
        box(g, (0, 0.015, 0), (w + 2 * b, 0.02, h + 2 * b), "tv_black", 0.004)
        box(g, (0, 0.04, 0), (0.15, 0.03, 0.15), "black_plastic", 0.006)
        desk = desk_under(s["center"][0], s["center"][2])
        top = desk["size"][1] if desk else 0.75
        low = monitor_below(s)
        cy = s["center"][1]
        z_from = (low["center"][1] - cy) if low else (top - cy)
        box(g, (0, 0.065, z_from / 2), (0.045, 0.02, abs(z_from)), "metal_dark", 0.004)
        if not low:
            box(g, (0, 0.045, top - cy + 0.006), (0.24, 0.15, 0.012), "metal_dark", 0.004)
    elif kind == "whiteboard":
        box(g, (0, 0.0075, 0), (w + 0.02, 0.005, h + 0.02), "board_white")
        ring(g, w, h, 0.03, -0.012, 0.01, "alu", 0.004)
        tz = -h / 2 - 0.03 - 0.012
        box(g, (0, -0.035, tz), (w * 0.7, 0.07, 0.024), "alu", 0.004)
        for k, m in enumerate(("marker_red", "marker_blue", "tv_black", "marker_green")):
            box(g, (-w * 0.2 + k * 0.16, -0.04, tz + 0.021), (0.12, 0.018, 0.018), m, 0.004)
        box(g, (w * 0.22, -0.04, tz + 0.03), (0.14, 0.05, 0.035), "tv_black", 0.006)
    elif kind == "chalkboard":
        dep = depth(0.04)
        box(g, (0, 0.005 + dep / 2, 0), (w + 0.02, dep, h + 0.02), "board_slate")
        ring(g, w, h, 0.05, -0.015, 0.005 + dep, "frame_wood", 0.006)
        tz = -h / 2 - 0.05 - 0.012
        box(g, (0, -0.03, tz), (w * 0.8, 0.07, 0.024), "frame_wood", 0.004)
        for k in range(3):
            box(g, (-0.2 + k * 0.12, -0.04, tz + 0.016), (0.07, 0.012, 0.012), "chalk")
    elif kind == "clock_bank":
        box(g, (0, 0.005 + 0.015, 0), (w + 0.08, 0.03, h + 0.08), "dark_wood", 0.008)
        box(g, (0, 0.0, h / 2 + 0.035), (w + 0.06, 0.012, 0.012), "brass", 0.003)
    elif kind == "poster":
        dep = depth(0.012)
        box(g, (0, 0.005 + dep / 2, 0), (w, dep, h), "board_white")
        ring(g, w, h, 0.025, -0.006, 0.005 + dep, "frame_black", 0.004)
    elif kind == "plate":
        dep = depth(0.015)
        box(g, (0, 0.005 + dep / 2, 0), (w + 0.03, dep, h + 0.03), "alu", 0.004)
    elif kind == "led_band":
        ext = 0.0
        wt = wall_top_below(s)
        if wt is not None:
            ext = (s["center"][1] - h / 2) - wt
        z0, z1 = -h / 2 - max(ext, 0.03), h / 2 + 0.035
        box(g, (0, 0.005 + 0.04, (z0 + z1) / 2), (w + 0.07, 0.08, z1 - z0), "tv_black", 0.008)
    return g


def build_screens():
    for s in SCREENS:
        cx, cy, cz = s["center"]
        w, h = s["size"]
        mname = "scr_" + s["id"]
        new_mat(mname, "#05070c", 0.4, 0.0)
        g = Geo()
        quad(g, w, h, mname)
        make_obj(s["id"], g, (cx, -cz, cy), s["facing"])
        hg = housing(s)
        if hg.v:
            make_obj("geo_housing_" + s["id"], hg, (cx, -cz, cy), s["facing"])


# --------------------------------------------------------------------------
# emissives
# --------------------------------------------------------------------------


def build_emissives():
    for e in EMISSIVES:
        a, b = B(*e["a"]), B(*e["b"])
        t = e["thickness"]
        kind = e["kind"]
        mname = "mat_rack_leds" if kind == "led_panel" else "mat_" + e["id"]
        new_mat(mname, "#ffffff", 0.4, 0.0, emit="#ffffff", strength=1.0)
        g = Geo()
        if kind == "led_strip":
            size = [abs(b[i] - a[i]) if abs(b[i] - a[i]) > 1e-6 else t for i in range(3)]
            box(g, (0, 0, 0), size, mname)
            make_obj(e["id"], g, tuple((a + b) / 2))
        elif kind == "beacon":
            sphere(g, (0, 0, 0), t, mname, seg=20, rings=8, cut=0.0)
            make_obj(e["id"], g, tuple(a))
            mg = Geo()
            cyl(mg, (0, 0, -0.06), t * 1.18, 0.06, "metal_dark", seg=20)
            make_obj("geo_alarm_mount", mg, tuple(a))
        elif kind == "led_panel":
            rack = None
            for f in FURN:
                if f["kind"] == "server_rack":
                    if rack is None or (Vector((f["pos"][0], -f["pos"][1], 0)) - Vector((a.x, a.y, 0))).length < \
                            (Vector((rack["pos"][0], -rack["pos"][1], 0)) - Vector((a.x, a.y, 0))).length:
                        rack = f
            yaw = rack.get("rot", 0) if rack else 0
            L = (b - a).length
            pw = (rack["size"][0] - 0.24) if rack else 0.36
            rows = 11
            for r in range(rows):
                zc = -L / 2 + 0.03 + r * (L - 0.06) / (rows - 1)
                for k in range(4):
                    x = -pw / 2 + pw * (k + 0.5) / 4
                    ww = 0.05 if k else 0.02
                    box(g, (x, 0, zc), (ww, t, 0.012), mname)
            make_obj(e["id"], g, tuple((a + b) / 2), yaw)


# --------------------------------------------------------------------------
# extra life
# --------------------------------------------------------------------------


def pendant(name, x, z, drop_y, style="dome"):
    g = Geo()
    if style == "dome":
        cyl(g, (0, 0, 0.21), 0.006, CEIL - drop_y - 0.21, "black_plastic", seg=6)
        cyl(g, (0, 0, 0.0), 0.2, 0.2, "lamp_shade", seg=24, r2=0.05, caps=(False, True))
        cyl(g, (0, 0, 0.02), 0.19, 0.005, "lamp_glow", seg=24)
        sphere(g, (0, 0, 0.03), 0.06, "lamp_glow", seg=12, rings=6)
    make_obj(name, g, (x, -z, drop_y))


def build_extras():
    # linear pendant over the war-room table (clear of the beacon above it)
    tbl = next((f for f in FURN if f["kind"] == "meeting_table"), None)
    beacon = next((e for e in EMISSIVES if e["kind"] == "beacon"), None)
    if tbl:
        tx, tz = tbl["pos"]
        g = Geo()
        L = tbl["size"][0] * 0.8
        y0 = 2.3
        box(g, (0, 0, 0.03), (L, 0.12, 0.06), "lamp_shade", 0.01)
        box(g, (0, 0, -0.002), (L - 0.04, 0.08, 0.006), "lamp_glow")
        for sx in (-1, 1):
            cx = sx * (L / 2 - 0.15)
            if beacon and abs(tx + cx - beacon["a"][0]) < 0.35 and abs(tz - beacon["a"][2]) < 0.35:
                cx = sx * (L / 2 - 0.02)
            cyl(g, (cx, 0, 0.06), 0.004, CEIL - y0 - 0.06, "black_plastic", seg=6)
        make_obj("geo_pendant_war", g, (tx, -tz, y0))
    bar = next((f for f in FURN if f["kind"] == "bar_table"), None)
    if bar:
        pendant("geo_pendant_bar", bar["pos"][0], bar["pos"][1], 2.15)
    ct = next((f for f in FURN if f["kind"] == "coffee_table"), None)
    if ct:
        pendant("geo_pendant_lounge_0", ct["pos"][0] - 0.65, ct["pos"][1], 2.2)
        pendant("geo_pendant_lounge_1", ct["pos"][0] + 0.65, ct["pos"][1], 2.2)
    # wall clock above the kitchenette counter (north wall, facing south)
    cnt = next((f for f in FURN if f["kind"] == "counter"), None)
    if cnt:
        g = Geo()
        cyl(g, (0, 0, 0), 0.2, 0.035, "black_plastic", seg=32, M=Rx(-90))
        cyl(g, (0, 0, 0), 0.18, 0.004, "clock_face", seg=32, M=T(0, -0.035, 0) @ Rx(-90))
        box(g, (0, -0.045, 0.05), (0.014, 0.004, 0.1), "black_plastic", M=Ry(-35))
        box(g, (0, -0.048, 0.07), (0.009, 0.004, 0.14), "black_plastic", M=Ry(60))
        for k in range(12):
            box(g, (0, -0.041, 0.155), (0.008, 0.004, 0.025), "black_plastic", M=Ry(30 * k))
        cyl(g, (0, 0, 0), 0.012, 0.012, "red_accent", seg=10, M=T(0, -0.05, 0) @ Rx(-90))
        wall_face = LAYOUT["bounds"]["z"][0] + WALL_T / 2
        make_obj("geo_wall_clock", g, (cnt["pos"][0], -wall_face, 2.35))
    # desk props: mug + notepad + pen on the sitter's side
    for f in FURN:
        if f["kind"] != "desk":
            continue
        w, h, d = f["size"]
        s = sitter_side(f)
        g = Geo()
        y = s * (d / 2 - 0.2)
        cyl(g, (w / 2 - 0.32, y, h), 0.04, 0.095, "mug_white", seg=16)
        cyl(g, (w / 2 - 0.32, y, h + 0.075), 0.034, 0.012, "dark_wood", seg=16, caps=(False, True))
        torus(g, (0, 0, 0), 0.028, 0.007, "mug_white", seg=10, seg2=5, arc=200, a0=-100,
              M=T(w / 2 - 0.32 + 0.04, y, h + 0.048) @ Rx(90))
        box(g, (-w / 2 + 0.38, y, h + 0.005), (0.16, 0.22, 0.01), "paper_yellow", 0.002, R=Rz(-8))
        cyl(g, (0, 0, 0), 0.004, 0.14, "marker_blue", seg=6, M=T(-w / 2 + 0.5, y - 0.07, h + 0.006) @ Rz(70) @ Ry(90))
        x, z = f["pos"]
        make_obj("geo_props_" + f["id"], g, (x, -z, 0.0), f.get("rot", 0))


# --------------------------------------------------------------------------
# office export
# --------------------------------------------------------------------------


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()


def core_ns():
    """The helpers and plan data the feature modules (floor_*.py) build on, as one namespace."""
    return types.SimpleNamespace(**{k: v for k, v in globals().items() if not k.startswith("__")})


def tri_count():
    return sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)


def build_office(opts=frozenset()):
    """opts: switches from the command line (see main). Everything on by default except what is named --no-*."""
    reset_scene()
    for name in ("carpet_red", "carpet_violet", "carpet_green", "carpet_navy", "carpet_slate", "wood", "tile"):
        ensure(name)
    build_rooms()
    build_walls()
    build_furniture()
    build_screens()
    build_emissives()
    build_extras()
    core = core_ns()
    print("base geometry: %d tris" % tri_count())
    if "--no-ao" not in opts:
        import floor_ao
        floor_ao.bake(core)
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH, export_format="GLB", use_selection=False, export_yup=True, export_apply=True,
        export_cameras=False, export_lights=False, export_animations=False, export_skins=False,
        export_morph=False, export_texcoords=True, export_normals=True, export_materials="EXPORT",
        export_extras=True, export_vertex_color="ACTIVE", export_all_vertex_colors=False,
    )
    import floor_pack
    floor_pack.pack(GLB_PATH)
    print("office.glb written: %s  (%d bytes, ~%d tris, %d objects)" % (
        GLB_PATH, os.path.getsize(GLB_PATH), tri_count(), len(bpy.data.objects)))


# --------------------------------------------------------------------------
# verification
# --------------------------------------------------------------------------


def read_glb_json(path):
    with open(path, "rb") as fh:
        data = fh.read()
    magic, ver, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", "not a GLB"
    clen, ctype = struct.unpack_from("<I4s", data, 12)
    return json.loads(data[20:20 + clen].decode("utf-8"))


def verify():
    gj = read_glb_json(GLB_PATH)
    names = [n.get("name", "") for n in gj.get("nodes", [])]
    want = [s["id"] for s in SCREENS] + [e["id"] for e in EMISSIVES] + \
           [f["id"] for f in FURN if f["kind"] == "keyboard"]
    problems = []
    for nme in want:
        c = names.count(nme)
        if c != 1:
            problems.append("%s x%d" % (nme, c))
    dup = sorted({n for n in names if names.count(n) > 1})
    tris = 0
    for m in gj.get("meshes", []):
        for p in m["primitives"]:
            if "indices" in p:
                tris += gj["accessors"][p["indices"]]["count"] // 3
    mats = {m["name"]: m for m in gj.get("materials", [])}
    glass = mats.get("glass", {})
    print("GLB nodes: %d  materials: %d  textures: %d  cameras: %d  lights: %s" % (
        len(names), len(mats), len(gj.get("textures", [])), len(gj.get("cameras", [])),
        "KHR_lights_punctual" in gj.get("extensionsUsed", [])))
    print("triangles: %d   file: %d bytes (%.2f MB)" % (tris, os.path.getsize(GLB_PATH), os.path.getsize(GLB_PATH) / 1e6))
    print("glass alphaMode: %s  baseColorFactor: %s" % (
        glass.get("alphaMode"), glass.get("pbrMetallicRoughness", {}).get("baseColorFactor")))
    print("screens/emissives/keyboards checked: %d  missing-or-duplicate: %s" % (len(want), problems or "none"))
    print("duplicate node names anywhere: %s" % (dup or "none"))
    for f in FURN:
        if f["kind"] == "keyboard":
            mn = "mat_" + f["id"]
            print("  %s material %s present: %s" % (f["id"], mn, mn in mats))
    # Blender round trip (names survive import exactly once)
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=GLB_PATH)
    obn = [o.name for o in bpy.data.objects]
    rt = [n for n in want if obn.count(n) != 1]
    print("re-import in fresh bpy scene: %d objects, wanted names not found exactly once: %s" % (len(obn), rt or "none"))
    return not problems and not rt


# --------------------------------------------------------------------------
# portraits
# --------------------------------------------------------------------------


HEAD = (0.105, 0.115, 0.13)   # head radii (x, y, z)
HZ = 0.30                     # head centre height


def _hair_keep(front, side, back):
    """Keep a sphere face when its direction is above a hairline that runs front -> side -> back."""
    def keep(p):
        f = side + (front - side) * (-p.y) if p.y < 0 else side + (back - side) * p.y
        return p.z > f
    return keep


def shell(name, centre, radii, keep, mat, thick):
    """Partial ellipsoid shell (hair cap / cap crown) with a solidify modifier."""
    seg, rings = 48, 28
    verts = [(0.0, 0.0, 1.0)]
    for k in range(1, rings):
        phi = math.pi * k / rings
        for i in range(seg):
            th = 2 * math.pi * i / seg
            verts.append((math.sin(phi) * math.cos(th), math.sin(phi) * math.sin(th), math.cos(phi)))
    verts.append((0.0, 0.0, -1.0))
    bot = len(verts) - 1
    faces = [[0, 1 + i, 1 + (i + 1) % seg] for i in range(seg)]
    for k in range(rings - 2):
        a0, b0 = 1 + k * seg, 1 + (k + 1) * seg
        faces += [[a0 + i, a0 + (i + 1) % seg, b0 + (i + 1) % seg, b0 + i] for i in range(seg)]
    last = 1 + (rings - 2) * seg
    faces += [[last + i, bot, last + (i + 1) % seg] for i in range(seg)]
    kept = []
    for f in faces:
        p = sum((Vector(verts[i]) for i in f), Vector()).normalized()
        if keep(p):
            kept.append(f)
    used = sorted({i for f in kept for i in f})
    remap = {old: new for new, old in enumerate(used)}
    vs = [(verts[i][0] * radii[0], verts[i][1] * radii[1], verts[i][2] * radii[2]) for i in used]
    g = Geo()
    g.add(vs, [[remap[i] for i in f] for f in kept], mat, True, T(*centre), refs=[(0, 0, 0)] * len(kept))
    ob = make_obj(name, g)
    mod = ob.modifiers.new("thick", "SOLIDIFY")
    mod.thickness = thick
    mod.offset = 1.0
    sub = ob.modifiers.new("smooth", "SUBSURF")
    sub.levels = sub.render_levels = 1
    return ob


def bust(spec):
    col = spec["colors"]
    build = float(spec.get("build", 1.0))
    a, b, c = HEAD
    skin = new_mat("p_skin", col["skin"], 0.48)
    top = new_mat("p_top", col["top"], 0.75)
    hair = new_mat("p_hair", col["hair"], 0.5)
    acc = new_mat("p_acc", col["accent"], 0.35)
    eye = new_mat("p_eye", "#1b130d", 0.12)
    mouth = new_mat("p_mouth", "#5b1f24", 0.45)
    white = new_mat("p_white", "#f3f3f1", 0.55)
    gold = new_mat("p_gold", col["accent"], 0.25, metal=0.9)
    blush = new_mat("p_blush", "#e07a6e", 0.6)

    # shoulders + chest in the top colour, crew collar
    g = Geo()
    sw = 0.24 * build
    sphere(g, (0, 0.015, 0.05), 1.0, top, seg=48, rings=24, scale=(sw, 0.125, 0.115))
    cyl(g, (0, 0.015, -0.5), 1.0, 0.55, top, seg=48, R=S(sw * 0.9, 0.12, 1.0))
    if "acc_tie" not in spec.get("accessories", []):
        torus(g, (0, 0.012, 0.128), 0.056, 0.011, top, seg=32, seg2=8, R=S(1.0, 0.92, 1.0))
    make_obj("bust_torso", g)

    g = Geo()
    cyl(g, (0, 0.01, 0.1), 0.048, 0.15, skin, seg=32)
    sphere(g, (0, 0, HZ), 1.0, skin, seg=48, rings=28, scale=(a, b, c))
    sphere(g, (0, -0.008, HZ - 0.066), 1.0, skin, seg=32, rings=16, scale=(0.074, 0.08, 0.07))
    for sx in (-1, 1):
        sphere(g, (sx * 0.103, 0.006, HZ - 0.005), 1.0, skin, seg=16, rings=10, scale=(0.017, 0.026, 0.034))
    sphere(g, (0, -0.110, HZ - 0.018), 1.0, skin, seg=16, rings=10, scale=(0.015, 0.014, 0.019))
    make_obj("bust_head", g)

    g = Geo()
    for sx in (-1, 1):
        x = sx * 0.042
        yf = -b * math.sqrt(max(0.0, 1 - (x / a) ** 2 - (0.005 / c) ** 2))
        sphere(g, (x, yf + 0.003, HZ + 0.005), 1.0, eye, seg=16, rings=10, scale=(0.0135, 0.008, 0.0175))
        yb = -b * math.sqrt(max(0.0, 1 - (x / a) ** 2 - (0.045 / c) ** 2))
        box(g, (x, yb - 0.002, HZ + 0.045), (0.036, 0.01, 0.0085), hair, 0.003, R=Ry(sx * 8))
        yc = -b * math.sqrt(max(0.0, 1 - (0.062 / a) ** 2 - (0.04 / c) ** 2))
        sphere(g, (sx * 0.062, yc + 0.006, HZ - 0.04), 1.0, blush, seg=12, rings=8, scale=(0.02, 0.006, 0.013))
    sphere(g, (0, -0.104, HZ - 0.047), 1.0, mouth, seg=20, rings=8, scale=(0.026, 0.0065, 0.014), cut=0.0, R=Ry(180))
    make_obj("bust_face", g)

    style = spec.get("hair", "hair_short")
    centre = (0, 0, HZ)
    if style == "hair_buzz":
        shell("bust_hair", centre, (a * 1.03, b * 1.03, c * 1.03), _hair_keep(0.42, 0.12, -0.42), hair, 0.004)
    elif style == "hair_short":
        shell("bust_hair", centre, (a * 1.06, b * 1.06, c * 1.07), _hair_keep(0.36, 0.06, -0.45), hair, 0.008)
        g = Geo()
        sphere(g, (0.012, -b * 0.74, HZ + c * 0.66), 1.0, hair, seg=20, rings=10, scale=(0.075, 0.034, 0.03), R=Rz(-12))
        make_obj("bust_fringe", g)
    elif style == "hair_bun":
        shell("bust_hair", centre, (a * 1.05, b * 1.05, c * 1.05), _hair_keep(0.42, 0.0, -0.5), hair, 0.007)
        g = Geo()
        sphere(g, (0, b * 0.42, HZ + c * 1.0), 0.056, hair, seg=24, rings=14)
        torus(g, (0, b * 0.36, HZ + c * 0.9), 0.034, 0.009, hair, seg=16, seg2=6, R=Rx(-40))
        make_obj("bust_bun", g)
    elif style == "hair_long":
        shell("bust_hair", centre, (a * 1.06, b * 1.06, c * 1.06), _hair_keep(0.4, -0.1, -0.6), hair, 0.008)
        g = Geo()
        sphere(g, (0, b * 0.38, HZ - 0.12), 1.0, hair, seg=32, rings=18, scale=(a * 1.12, b * 0.72, c * 1.55))
        make_obj("bust_hair_back", g)
    elif style == "hair_slick":
        shell("bust_hair", (0, 0.008, HZ + 0.008), (a * 1.06, b * 1.1, c * 1.12), _hair_keep(0.5, 0.14, -0.35), hair, 0.008)
        g = Geo()
        sphere(g, (0, -b * 0.3, HZ + c * 0.98), 1.0, hair, seg=24, rings=12, scale=(0.078, 0.085, 0.034), R=Rx(12))
        make_obj("bust_quiff", g)

    accs = spec.get("accessories", [])
    if "acc_cap" in accs:
        shell("bust_cap", (0, 0.004, HZ + 0.012), (a * 1.12, b * 1.12, c * 1.08), lambda p: p.z > 0.34, acc, 0.006)
        g = Geo()
        cyl(g, (0, b * 1.08 + 0.02, HZ + 0.04), 1.0, 0.01, acc, seg=32, R=Rx(-10) @ S(0.088, 0.085, 1.0))
        sphere(g, (0, 0.004, HZ + 0.012 + c * 1.08 + 0.004), 0.011, acc, seg=12, rings=6)
        box(g, (0, -b * 0.62, HZ + c * 0.86), (0.05, 0.01, 0.02), new_mat("p_logo", "#f5f5f5", 0.5), 0.003, R=Rx(-35))
        make_obj("bust_capbrim", g)
    if "acc_glasses" in accs:
        g = Geo()
        for sx in (-1, 1):
            torus(g, (0, 0, 0), 0.026, 0.0035, acc, seg=24, seg2=6, M=T(sx * 0.043, -0.122, HZ + 0.006) @ Rx(90))
            box(g, (sx * 0.098, -0.06, HZ + 0.012), (0.005, 0.12, 0.005), acc, R=Rz(sx * -8))
            box(g, (sx * 0.082, -0.118, HZ + 0.012), (0.03, 0.006, 0.006), acc)
        box(g, (0, -0.124, HZ + 0.014), (0.03, 0.005, 0.005), acc)
        make_obj("bust_specs", g)
    if "acc_tie" in accs:
        g = Geo()
        tbox(g, (0, -0.112, 0.02), (0.008, 0.016), (0.1, 0.016), 0.112, white, off=(0.0, 0.03))
        for sx in (-1, 1):
            tbox(g, (sx * 0.026, -0.09, 0.106), (0.014, 0.008), (0.04, 0.008), 0.03, white, R=Ry(sx * 30))
        tbox(g, (0, -0.1, 0.096), (0.026, 0.014), (0.036, 0.014), 0.03, acc)
        tbox(g, (0, -0.119, -0.16), (0.062, 0.009), (0.034, 0.009), 0.258, acc, off=(0.0, 0.018))
        make_obj("bust_tie", g)
    if "acc_headset" in accs:
        g = Geo()
        torus(g, (0, 0, 0), 0.127, 0.008, acc, seg=32, seg2=6, arc=180, a0=0, M=T(0, 0.0, HZ) @ S(1, 1, 1.17) @ Rx(90))
        for sx in (-1, 1):
            cyl(g, (0, 0, 0), 0.042, 0.03, new_mat("p_black", "#141518", 0.4), seg=24,
                M=T(sx * 0.118, 0.004, HZ - 0.008) @ Ry(sx * 90))
            cyl(g, (0, 0, 0), 0.03, 0.006, acc, seg=24, M=T(sx * 0.148, 0.004, HZ - 0.008) @ Ry(sx * 90))
        p0, p1 = Vector((-0.13, -0.02, HZ - 0.03)), Vector((-0.05, -0.112, HZ - 0.068))
        v = p1 - p0
        cyl(g, (0, 0, 0), 0.0045, v.length, new_mat("p_black", "#141518", 0.4), seg=8,
            M=T(*p0) @ v.to_track_quat("Z", "Y").to_matrix().to_4x4())
        sphere(g, tuple(p1), 0.012, acc, seg=12, rings=8)
        make_obj("bust_headset", g)
    if "acc_earrings" in accs:
        g = Geo()
        for sx in (-1, 1):
            sphere(g, (sx * 0.1, -0.022, HZ - 0.078), 0.011, gold, seg=14, rings=8)
        make_obj("bust_earrings", g)


def portrait_rig():
    sc = bpy.context.scene
    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = 85
    cam = bpy.data.objects.new("cam", cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    target = Vector((0.0, 0.0, 0.252))
    cam.location = Vector((-0.52, -1.12, 0.45))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()

    def area(name, loc, energy, size, color):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy, ld.size, ld.color = energy, size, color
        ob = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(ob)
        ob.location = Vector(loc)
        ob.rotation_euler = (Vector((0, 0, 0.27)) - ob.location).to_track_quat("-Z", "Y").to_euler()

    area("key", (-0.9, -1.0, 0.95), 70.0, 0.7, (1.0, 0.95, 0.88))
    area("rim", (0.8, 0.85, 0.75), 90.0, 0.5, (0.65, 0.82, 1.0))
    area("fill", (0.9, -0.8, 0.15), 14.0, 0.8, (0.85, 0.9, 1.0))
    w = bpy.data.worlds.new("w")
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = w.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (*hexrgb("#0f172a"), 1.0)
    bg.inputs[1].default_value = 1.0
    r = sc.render
    r.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 40
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    sc.cycles.seed = 7
    r.resolution_x = r.resolution_y = 256
    r.resolution_percentage = 100
    r.film_transparent = True
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "AgX"
    for look in ("AgX - Medium High Contrast", "Medium High Contrast", "None"):
        try:
            sc.view_settings.look = look
            break
        except Exception:
            continue


def composite_png(src, dst, bg_hex="#0f172a"):
    """Flatten a straight-alpha RGBA render onto a solid colour (exact sRGB background)."""
    import numpy as np
    img = bpy.data.images.load(src)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    bg = np.array([int(bg_hex[i:i + 2], 16) / 255.0 for i in (1, 3, 5)], dtype=np.float32)
    a = px[:, 3:4]
    out = np.empty_like(px)
    out[:, :3] = px[:, :3] * a + bg * (1.0 - a)
    out[:, 3] = 1.0
    res = bpy.data.images.new("flat", w, h, alpha=False)
    res.colorspace_settings.name = "Non-Color"
    res.pixels.foreach_set(out.ravel())
    res.filepath_raw = dst
    res.file_format = "PNG"
    res.save()


def build_portraits():
    import tempfile
    os.makedirs(PORTRAIT_DIR, exist_ok=True)
    tmpdir = tempfile.mkdtemp(prefix="floor_portraits_")
    for name in sorted(LAYOUT["crew"]):
        reset_scene()
        bust(LAYOUT["crew"][name])
        portrait_rig()
        tmp = os.path.join(tmpdir, name.lower() + "_rgba.png")
        bpy.context.scene.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        dst = os.path.join(PORTRAIT_DIR, name.lower() + ".png")
        composite_png(tmp, dst)
        os.remove(tmp)
        print("portrait written: %s" % dst)
    os.rmdir(tmpdir)


def main(argv):
    args = set(a for a in argv if a.startswith("--"))
    do_all = not (args & {"--office", "--portraits", "--verify"})
    if do_all or "--office" in args:
        build_office(args)
    if do_all or "--portraits" in args:
        build_portraits()
    if do_all or "--verify" in args:
        ok = verify()
        if not ok:
            sys.exit(1)


if __name__ == "__main__":
    # Under `blender -b -P build_floor.py -- --office` everything before "--" belongs to Blender.
    _argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    main(_argv)
