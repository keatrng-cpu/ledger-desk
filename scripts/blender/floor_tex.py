"""
floor_tex.py - the tiling material set (D2): four 512 px tiles, world-space / object-space UVs, embedded in a glB.

Tiles (greyscale JPEG, tileable by construction - filtered periodic noise, so no seam):
  carpet    needle-point grain          -> every carpet_* floor, the rug
  wood      planks with grain and seams -> the wood and walnut floors, desk and table tops, shelves
  concrete  cloud + speckle + pores     -> the tile floor, the slab, the counter stone
  glass     diagonal smudge streaks     -> roughness of the glass only (clean glass stays at 0.05, a smudge reaches 0.35)

One image serves two jobs. As the base-colour map it multiplies the material's colour (the colour factor is divided by
the tile's mean so the overall colour does not move); as the metallic-roughness map its G channel varies the roughness
(the roughness factor is divided by the mean, B stays irrelevant because metallic is 0 on every textured material).
GLTFLoader keys its texture cache on image + sampler, and an sRGB colour map and a linear data map must not share one
texture object, so each tile gets two identical samplers and two texture entries.

The result is NOT written into office.glb: scripts/verify-room.mjs asserts that file carries no images. It goes to
office.tex.glb, a complete second copy of the office with UVs and the images; switching the runtime to it is one URL
(and dropping the `images` clause of that check).
"""

import math
import os

import bpy
import numpy as np

import floor_pack

N = 512

TILES = {
    "carpet": dict(mats=["carpet_red", "carpet_violet", "carpet_green", "carpet_navy", "carpet_slate", "carpet_teal",
                         "carpet_plum", "carpet_charcoal", "rug_field", "rug_border"], floor=0.9, obj=0.5, base=True),
    "wood": dict(mats=["wood", "walnut", "desk_wood", "table_wood", "shelf_wood", "walnut_light", "cap_wood", "dark_wood",
                       "frame_wood", "globe_wood"], floor=1.8, obj=0.6, base=True),
    "concrete": dict(mats=["tile", "slab", "stone"], floor=1.6, obj=1.0, base=True),
    "glass": dict(mats=["glass"], floor=1.2, obj=1.2, base=False, rough_max=0.35),
}


# --------------------------------------------------------------------------
# tiles
# --------------------------------------------------------------------------


def _spec(rng, amp):
    """Periodic noise: white noise filtered in the frequency domain, unit standard deviation."""
    white = rng.standard_normal((N, N))
    F = np.fft.rfft2(white)
    fy = np.fft.fftfreq(N)[:, None]
    fx = np.fft.rfftfreq(N)[None, :]
    out = np.fft.irfft2(F * amp(fx, fy), s=(N, N))
    return out / (out.std() + 1e-9)


def make_tiles():
    """name -> float array (N, N) in 0..1, as the bytes will be (sRGB-encoded grey)."""
    out = {}
    rng = np.random.default_rng(20261007)
    yy, xx = np.mgrid[0:N, 0:N]
    # carpet: fine grain + a faint loop weave (period 8 px divides 512, so it tiles)
    g = _spec(rng, lambda fx, fy: np.exp(-((np.hypot(fx, fy) - 0.22) / 0.16) ** 2))
    m = _spec(rng, lambda fx, fy: np.exp(-(np.hypot(fx, fy) / 0.03) ** 2))
    weave = np.sin(2 * math.pi * xx / 8) * np.sin(2 * math.pi * yy / 8)
    carpet = 0.83 + 0.05 * g + 0.025 * m + 0.018 * weave
    out["carpet"] = np.clip(carpet, 0.55, 1.0)
    # wood: 4 planks (128 px each) with their own tone, long grain along x, seams and butt joints
    grain = _spec(rng, lambda fx, fy: np.exp(-(fx / 0.010) ** 2) * np.exp(-((fy - 0.05) / 0.07) ** 2))
    fine = _spec(rng, lambda fx, fy: np.exp(-(fx / 0.05) ** 2) * np.exp(-((fy - 0.15) / 0.12) ** 2))
    wood = np.empty((N, N))
    for k in range(4):
        sl = slice(k * 128, (k + 1) * 128)
        wood[sl, :] = 0.80 + 0.06 * (rng.random() - 0.5) * 2
    wood += 0.05 * grain + 0.02 * fine
    for k in range(4):
        wood[k * 128:k * 128 + 2, :] = 0.46                         # long seam
        j = int(rng.integers(40, N - 40))
        wood[k * 128 + 2:(k + 1) * 128, j:j + 2] = 0.52             # butt joint
    out["wood"] = np.clip(wood, 0.4, 1.0)
    # concrete: soft clouds, speckle, a few pores
    cloud = _spec(rng, lambda fx, fy: 1.0 / (np.hypot(fx, fy) * N + 3.0) ** 1.6)
    speck = _spec(rng, lambda fx, fy: np.exp(-((np.hypot(fx, fy) - 0.35) / 0.2) ** 2))
    conc = 0.86 + 0.04 * cloud + 0.02 * speck
    for _ in range(46):
        cx, cy = int(rng.integers(0, N)), int(rng.integers(0, N))
        r = float(rng.uniform(0.8, 2.2))
        d2 = ((xx - cx + N / 2) % N - N / 2) ** 2 + ((yy - cy + N / 2) % N - N / 2) ** 2
        conc -= 0.16 * np.exp(-d2 / (2 * r * r))
    out["concrete"] = np.clip(conc, 0.5, 1.0)
    # glass: diagonal streaks of smudge; mostly clean
    th = math.radians(24)
    c, s = math.cos(th), math.sin(th)
    streak = _spec(rng, lambda fx, fy: np.exp(-(((fx * c + fy * s)) / 0.012) ** 2) * np.exp(-(((-fx * s + fy * c) - 0.06) / 0.07) ** 2))
    blot = _spec(rng, lambda fx, fy: np.exp(-(np.hypot(fx, fy) / 0.02) ** 2))
    f = np.clip((streak + 0.6 * blot - 0.5) / 2.5, 0.0, 1.0) ** 1.4
    out["glass"] = np.clip(0.14 + 0.86 * f, 0.0, 1.0)
    return out


def tile_jpegs(tiles, outdir):
    """Write the tiles as greyscale JPEG with Blender's own encoder. Returns name -> (bytes, mean_g, mean_linear)."""
    os.makedirs(outdir, exist_ok=True)
    sc = bpy.context.scene
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.color_mode = "BW"
    sc.render.image_settings.quality = 80
    res = {}
    for name, a in tiles.items():
        img = bpy.data.images.new("tile_" + name, N, N, alpha=False, float_buffer=False)
        img.colorspace_settings.name = "Non-Color"
        rgba = np.empty((N, N, 4), dtype=np.float32)
        rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = a[::-1].astype(np.float32)     # images are stored bottom row first
        rgba[..., 3] = 1.0
        img.pixels.foreach_set(rgba.ravel())
        path = os.path.join(outdir, name + ".jpg")
        img.save_render(path, scene=sc)
        with open(path, "rb") as fh:
            data = fh.read()
        # what a browser will decode (JPEG loss is tiny; use the source values for the means)
        lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
        res[name] = (data, float(a.mean()), float(lin.mean()))
        bpy.data.images.remove(img)
    return res


# --------------------------------------------------------------------------
# UVs
# --------------------------------------------------------------------------


def add_uvs(core, log=print):
    """Box-projected UVs on every mesh that uses a tiled material. Floors and walls project from world position,
    everything else from its own frame (so shared meshes stay shared). Returns the number of meshes given UVs."""
    which = {}
    for tname, t in TILES.items():
        for m in t["mats"]:
            which[m] = tname
    fixed = {r["id"] for r in core.LAYOUT["rooms"]} | {w["id"] for w in core.LAYOUT["walls"]} | {"geo_slab"}
    screens = {s["id"] for s in core.LAYOUT["screens"]}
    done = set()
    n = 0
    for ob in bpy.data.objects:
        if ob.type != "MESH" or ob.name in screens or ob.data.name in done:
            continue
        me = ob.data
        names = [m.name if m else "" for m in me.materials]
        if not any(nm in which for nm in names):
            continue
        world = ob.name in fixed
        off = np.array(ob.location, dtype=np.float64) if world else np.zeros(3)
        co = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3).astype(np.float64) + off
        vi = np.empty(len(me.loops), dtype=np.int32)
        me.loops.foreach_get("vertex_index", vi)
        ls = np.empty(len(me.polygons), dtype=np.int32)
        me.polygons.foreach_get("loop_start", ls)
        lt = np.empty(len(me.polygons), dtype=np.int32)
        me.polygons.foreach_get("loop_total", lt)
        pn = np.empty(len(me.polygons) * 3, dtype=np.float32)
        me.polygons.foreach_get("normal", pn)
        pn = np.abs(pn.reshape(-1, 3))
        mi = np.empty(len(me.polygons), dtype=np.int32)
        me.polygons.foreach_get("material_index", mi)
        uv = np.zeros((len(me.loops), 2), dtype=np.float32)
        loop_poly = np.repeat(np.arange(len(me.polygons)), lt)
        axis = pn.argmax(axis=1)            # 0: face looks along x, 1: along y, 2: along z
        scale = np.ones(len(me.polygons))
        for p in range(len(me.polygons)):
            nm = names[mi[p]] if mi[p] < len(names) else ""
            t = which.get(nm)
            if t:
                scale[p] = TILES[t]["floor" if world else "obj"]
        P = co[vi]
        a = axis[loop_poly]
        u = np.where(a == 0, P[:, 1], P[:, 0])
        v = np.where(a == 2, P[:, 1], P[:, 2])
        sc_l = scale[loop_poly]
        uv[:, 0] = (u / sc_l).astype(np.float32)
        uv[:, 1] = (v / sc_l).astype(np.float32)
        if "UVMap" in me.uv_layers:
            me.uv_layers.remove(me.uv_layers["UVMap"])
        layer = me.uv_layers.new(name="UVMap")
        layer.data.foreach_set("uv", uv.ravel())
        done.add(me.name)
        n += 1
    log("tex: UVs on %d meshes" % n)
    return n


# --------------------------------------------------------------------------
# glB patch
# --------------------------------------------------------------------------


def embed(path, tiles, log=print):
    """Add the images, samplers, textures and material wiring to an exported glB (rewrites the file)."""
    g, bn = floor_pack.read_glb(path)
    bn = bytearray(bn)
    g.setdefault("images", [])
    g.setdefault("textures", [])
    g.setdefault("samplers", [])
    g.setdefault("bufferViews", [])
    entry = {}
    sampler = {"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}
    for name, (data, mean_g, mean_lin) in tiles.items():
        bn.extend(b"\x00" * (-len(bn) % 4))
        g["bufferViews"].append({"buffer": 0, "byteOffset": len(bn), "byteLength": len(data)})
        bn.extend(data)
        g["images"].append({"name": "tile_" + name, "mimeType": "image/jpeg", "bufferView": len(g["bufferViews"]) - 1})
        img = len(g["images"]) - 1
        s0 = len(g["samplers"])
        g["samplers"] += [dict(sampler), dict(sampler)]
        t0 = len(g["textures"])
        g["textures"] += [{"name": "tile_%s_color" % name, "source": img, "sampler": s0},
                          {"name": "tile_%s_rough" % name, "source": img, "sampler": s0 + 1}]
        entry[name] = (t0, t0 + 1, mean_g, mean_lin)
    which = {}
    for tname, t in TILES.items():
        for m in t["mats"]:
            which[m] = tname
    n_mat = 0
    for m in g.get("materials", []):
        t = which.get(m.get("name"))
        if not t:
            continue
        tb, tm, mean_g, mean_lin = entry[t]
        pbr = m.setdefault("pbrMetallicRoughness", {})
        spec = TILES[t]
        if spec["base"]:
            col = pbr.get("baseColorFactor", [1.0, 1.0, 1.0, 1.0])
            pbr["baseColorFactor"] = [min(1.0, col[0] / mean_lin), min(1.0, col[1] / mean_lin), min(1.0, col[2] / mean_lin), col[3]]
            pbr["baseColorTexture"] = {"index": tb}
            pbr["roughnessFactor"] = min(1.0, pbr.get("roughnessFactor", 1.0) / mean_g)
        else:
            pbr["roughnessFactor"] = spec["rough_max"]
        pbr["metallicRoughnessTexture"] = {"index": tm}
        pbr.setdefault("metallicFactor", 0.0)
        n_mat += 1
    # every primitive that uses a textured material must carry TEXCOORD_0
    missing = 0
    textured = {i for i, m in enumerate(g.get("materials", [])) if m.get("name") in which}
    for me in g.get("meshes", []):
        for p in me["primitives"]:
            if p.get("material") in textured and "TEXCOORD_0" not in p["attributes"]:
                missing += 1
    bn = bytes(bn)
    g["buffers"] = [{"byteLength": len(bn)}]
    floor_pack.write_glb(path, g, bn)
    log("tex: %d materials wired to %d tiles, %d textured primitives without TEXCOORD_0, %d bytes" % (
        n_mat, len(tiles), missing, os.path.getsize(path)))
    return missing
