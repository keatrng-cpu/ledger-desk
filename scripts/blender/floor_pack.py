"""
floor_pack.py - post-process a .glb written by Blender's exporter. Pure Python (no bpy), so it also runs from a shell:

    python scripts/blender/floor_pack.py in.glb [out.glb]

What it does, each step on its own so a failure names the step
  colors_u8        COLOR_0 as unsigned bytes (Blender writes unsigned shorts): half the bytes, the same look
  prune_flat       drop COLOR_0 from a primitive whose occlusion is all but 1.0 (nothing to multiply, nothing to store)
  compact          renumber accessors / bufferViews so only what a mesh, image or sparse accessor still uses is stored
  textures         (optional) add tiling images and wire them into named materials (see floor_tex.py)

Everything a runtime looks up by name (nodes, materials, extras) is left untouched.
"""

import json
import struct
import sys

CT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


def read_glb(path):
    with open(path, "rb") as fh:
        data = fh.read()
    magic, ver, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF" and length == len(data), "not a whole GLB: " + path
    pos = 12
    gj, bn = None, b""
    while pos < len(data):
        clen, ctype = struct.unpack_from("<I4s", data, pos)
        chunk = data[pos + 8:pos + 8 + clen]
        if ctype == b"JSON":
            gj = json.loads(chunk.decode("utf-8"))
        elif ctype == b"BIN\x00":
            bn = bytes(chunk)
        pos += 8 + clen
    return gj, bn


def write_glb(path, gj, bn):
    js = json.dumps(gj, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)
    bn = bn + b"\x00" * (-len(bn) % 4)
    total = 12 + 8 + len(js) + (8 + len(bn) if bn else 0)
    out = struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js
    if bn:
        out += struct.pack("<I4s", len(bn), b"BIN\x00") + bn
    with open(path, "wb") as fh:
        fh.write(out)


def accessor_bytes(g, bn, ai):
    """The accessor's elements as tightly packed bytes (stride removed). Sparse accessors are not handled here."""
    a = g["accessors"][ai]
    bv = g["bufferViews"][a["bufferView"]]
    fmt, size = CT[a["componentType"]]
    n = NCOMP[a["type"]]
    el = size * n
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", el)
    if stride == el:
        return bn[base:base + a["count"] * el]
    out = bytearray()
    for i in range(a["count"]):
        o = base + i * stride
        out += bn[o:o + el]
    return bytes(out)


def _primitives(g):
    for m in g.get("meshes", []):
        for p in m["primitives"]:
            yield p


def colors_u8(g, bn):
    """COLOR_n accessors that are normalised unsigned shorts become normalised unsigned bytes. Returns new bn."""
    pieces = {}
    done = set()
    for p in _primitives(g):
        for k, ai in p["attributes"].items():
            if not k.startswith("COLOR_") or ai in done:
                continue
            a = g["accessors"][ai]
            if a["componentType"] != 5123 or not a.get("normalized"):
                continue
            n = NCOMP[a["type"]]
            raw = accessor_bytes(g, bn, ai)
            vals = struct.unpack("<%dH" % (a["count"] * n), raw)
            out = bytes(min(255, (v * 255 + 32767) // 65535) for v in vals)
            pieces[ai] = out
            a["componentType"] = 5121
            a.pop("min", None)
            a.pop("max", None)
            done.add(ai)
    return pieces


def prune_flat(g, bn, floor=0.985):
    """Remove COLOR_0 from primitives whose occlusion never drops below `floor` (all channels). Returns count."""
    removed = 0
    cache = {}
    for p in _primitives(g):
        ai = p["attributes"].get("COLOR_0")
        if ai is None:
            continue
        if ai not in cache:
            a = g["accessors"][ai]
            n = NCOMP[a["type"]]
            fmt, size = CT[a["componentType"]]
            raw = accessor_bytes(g, bn, ai)
            vals = struct.unpack("<%d%s" % (a["count"] * n, fmt), raw)
            top = 255.0 if a["componentType"] == 5121 else 65535.0
            lo = min(vals[i] for i in range(len(vals)) if i % n < 3) / top
            cache[ai] = lo
        if cache[ai] >= floor:
            del p["attributes"]["COLOR_0"]
            removed += 1
    return removed


def compact(g, bn, replace=None):
    """Rebuild accessors, bufferViews and the buffer so only referenced data stays. `replace` maps accessor index to
    new tightly packed bytes. Returns the new buffer bytes."""
    replace = replace or {}
    used = []

    def want(ai):
        if ai is not None and ai not in used:
            used.append(ai)

    for p in _primitives(g):
        for ai in p["attributes"].values():
            want(ai)
        if "indices" in p:
            want(p["indices"])
        for t in p.get("targets", []):
            for ai in t.values():
                want(ai)
    for sk in g.get("skins", []):
        want(sk.get("inverseBindMatrices"))
    for an in g.get("animations", []):
        for s in an.get("samplers", []):
            want(s["input"])
            want(s["output"])
    used = sorted(set(used))
    amap = {old: i for i, old in enumerate(used)}
    new_acc, new_bv, out = [], [], bytearray()

    def add_view(data, target=None):
        out.extend(b"\x00" * (-len(out) % 4))
        v = {"buffer": 0, "byteOffset": len(out), "byteLength": len(data)}
        if target:
            v["target"] = target
        out.extend(data)
        new_bv.append(v)
        return len(new_bv) - 1

    index_users = set()
    for p in _primitives(g):
        if "indices" in p:
            index_users.add(p["indices"])
    for old in used:
        a = dict(g["accessors"][old])
        if "sparse" in a:
            sp = a["sparse"]
            ib = g["bufferViews"][sp["indices"]["bufferView"]]
            vb = g["bufferViews"][sp["values"]["bufferView"]]
            ioff = ib.get("byteOffset", 0) + sp["indices"].get("byteOffset", 0)
            voff = vb.get("byteOffset", 0) + sp["values"].get("byteOffset", 0)
            isz = CT[sp["indices"]["componentType"]][1] * sp["count"]
            vsz = CT[a["componentType"]][1] * NCOMP[a["type"]] * sp["count"]
            a["sparse"] = {
                "count": sp["count"],
                "indices": {"bufferView": add_view(bn[ioff:ioff + isz]), "componentType": sp["indices"]["componentType"]},
                "values": {"bufferView": add_view(bn[voff:voff + vsz])},
            }
            a.pop("bufferView", None)
            a.pop("byteOffset", None)
            if "bufferView" in g["accessors"][old]:
                data = replace.get(old) or accessor_bytes(g, bn, old)
                a["bufferView"] = add_view(data)
        else:
            data = replace.get(old)
            if data is None:
                data = accessor_bytes(g, bn, old)
            a["bufferView"] = add_view(data, 34963 if old in index_users else 34962)
            a.pop("byteOffset", None)
        new_acc.append(a)
    # images keep their own bufferViews
    for im in g.get("images", []):
        if "bufferView" in im:
            bv = g["bufferViews"][im["bufferView"]]
            off = bv.get("byteOffset", 0)
            im["bufferView"] = add_view(bn[off:off + bv["byteLength"]])
    for p in _primitives(g):
        p["attributes"] = {k: amap[v] for k, v in p["attributes"].items()}
        if "indices" in p:
            p["indices"] = amap[p["indices"]]
        if "targets" in p:
            p["targets"] = [{k: amap[v] for k, v in t.items()} for t in p["targets"]]
    for sk in g.get("skins", []):
        if "inverseBindMatrices" in sk:
            sk["inverseBindMatrices"] = amap[sk["inverseBindMatrices"]]
    g["accessors"] = new_acc
    g["bufferViews"] = new_bv
    g["buffers"] = [{"byteLength": len(out)}]
    return bytes(out)


def pack(path, out=None, log=print, flat_floor=0.985):
    g, bn = read_glb(path)
    before = len(open(path, "rb").read())
    n_prune = prune_flat(g, bn, flat_floor)
    pieces = colors_u8(g, bn)
    bn2 = compact(g, bn, pieces)
    write_glb(out or path, g, bn2)
    after = len(open(out or path, "rb").read())
    log("pack: COLOR_0 -> u8 on %d accessors, %d flat primitives lost COLOR_0, %d -> %d bytes" % (len(pieces), n_prune, before, after))
    return after


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    pack(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
