"""
floor_dress.py - restrained set dressing for the office, in the existing stylised look (flat PBR colours, a few
neon accents). Everything is derived from src/data/floor-layout.json and seeded from ids, so a rebuild is identical.

What it adds (all node names start geo_dress_ or geo_decal_; none contains an emissive id or "key_<Name>")
  cables     two cables per desk (monitor stand -> down the back of the desk -> along the floor), a power strip;
             cable bundles on the server racks
  clutter    per desk a seeded pick of: pen cup, sticky pads, notebook, phone, headphones, a cactus
  plants     leaf blades around every plant, so the blobs read as foliage
  shelf      small objects on and in the bookshelf
  posters    framed stylised posters on free stretches of interior solid wall (a candle chart, a skyline, ...)
  decals     door mats, school-colour zone discs outside each office door, entrance chevrons, a cyan outline around the
             war-room table. Raised 6 mm, no ambient occlusion baked.

Budget: at most MAX_TRIS triangles in total; build() prints the real number and fails above it.
"""

import json
import math
import random

from mathutils import Matrix, Vector

MAX_TRIS = 15000

NEW_MATS = {
    "cable_black": ("#101114", 0.55, 0.0), "cable_white": ("#d7d9de", 0.5, 0.0), "cable_grey": ("#4b5058", 0.55, 0.0),
    "cable_cyan": ("#22d3ee", 0.4, 0.0), "strip_white": ("#e6e7e4", 0.5, 0.0),
    "sticky_yellow": ("#f5d76e", 0.7, 0.0), "sticky_pink": ("#f28bb0", 0.7, 0.0), "sticky_cyan": ("#79d6e8", 0.7, 0.0),
    "phone_black": ("#0c0d10", 0.25, 0.3), "cactus": ("#3f8f54", 0.7, 0.0), "pot_slate": ("#39414d", 0.6, 0.0),
    "poster_bg": ("#10131a", 0.6, 0.0), "poster_green": ("#2fbf6f", 0.5, 0.0), "poster_red": ("#e04b5a", 0.5, 0.0),
    "poster_cyan": ("#22d3ee", 0.4, 0.0), "poster_amber": ("#f5a524", 0.5, 0.0), "poster_magenta": ("#d946ef", 0.5, 0.0),
    "poster_white": ("#e9ecf1", 0.6, 0.0), "poster_navy": ("#1b2540", 0.6, 0.0), "rubber": ("#1a1b1e", 0.9, 0.0),
    "neon_cyan": ("#0e3a44", 0.4, 0.0, {"emit": "#22d3ee", "strength": 1.5}),
    "neon_amber": ("#4a3207", 0.4, 0.0, {"emit": "#f59e0b", "strength": 1.3}),
    "zone_jax": ("#3a1b12", 0.5, 0.0, {"emit": "#e4572e", "strength": 0.7}),
    "zone_nova": ("#1f1040", 0.5, 0.0, {"emit": "#6d28d9", "strength": 0.9}),
    "zone_gemma": ("#0c2a17", 0.5, 0.0, {"emit": "#15803d", "strength": 0.8}),
    "zone_sterling": ("#2a0d0d", 0.5, 0.0, {"emit": "#b91c1c", "strength": 0.8}),
    "zone_vince": ("#0b3038", 0.5, 0.0, {"emit": "#22d3ee", "strength": 0.9}),
    "zone_other": ("#1c2433", 0.5, 0.0, {"emit": "#7c8aa6", "strength": 0.6}),
}

SCHOOL_ZONE = {"office_Jax": "zone_jax", "office_Nova": "zone_nova", "office_Gemma": "zone_gemma",
               "office_Sterling": "zone_sterling", "office_Vince": "zone_vince"}


class Dress:
    def __init__(self, core):
        self.core = core
        self.tris = 0
        self.names = []
        with open(core.LAYOUT_PATH) as fh:
            self.raw = json.load(fh)         # unfiltered: the runtime's procedural pieces occupy walls too
        for k, v in NEW_MATS.items():
            core.PAL[k] = v
        self.foot = self._footprints()

    # ---- plan helpers -------------------------------------------------

    def _footprints(self):
        out = []
        for f in self.raw["furniture"]:
            if f["kind"] in ("rug", "door_frame", "neon_frame", "jumbotron", "keyboard", "coffee_machine",
                             "headset_stand", "energy_cans") or f.get("onTop") is not None:
                continue
            w, h, d = f["size"]
            th = math.radians(f.get("rot", 0))
            hx = abs(w / 2 * math.cos(th)) + abs(d / 2 * math.sin(th))
            hz = abs(w / 2 * math.sin(th)) + abs(d / 2 * math.cos(th))
            x, z = f["pos"]
            out.append((x - hx, x + hx, z - hz, z + hz, h, f["id"]))
        return out

    def free_floor(self, x, z, r):
        """True if a disc of radius r at three (x, z) touches no furniture footprint."""
        for (x0, x1, z0, z1, h, i) in self.foot:
            if x0 - r < x < x1 + r and z0 - r < z < z1 + r:
                return False
        return True

    def room_at(self, x, z, rooms=None):
        for r in (rooms or self.raw["rooms"]):
            if r["x"][0] < x < r["x"][1] and r["z"][0] < z < r["z"][1]:
                return r
        return None

    # ---- object helpers -----------------------------------------------

    # metres beyond which the runtime may hide a piece (glTF extras "cull_distance"): small things go first
    CULL = {"geo_dress_cables": 11.0, "geo_dress_clutter": 13.0, "geo_dress_leaves": 18.0, "geo_dress_shelf": 15.0,
            "geo_dress_wall": 26.0, "geo_decal": 34.0}

    def finish(self, name, g, x, z, y=0.0, yaw=0.0):
        if not g.v:
            return None
        ob = self.core.make_obj(name, g, (x, -z, y), yaw)
        for pre, dist in self.CULL.items():
            if name.startswith(pre):
                ob["cull_distance"] = float(dist)
                break
        self.names.append(name)
        self.tris += sum(len(p.vertices) - 2 for p in ob.data.polygons)
        return ob

    def tube(self, g, pts, r, mat, seg=5):
        """A cable: a thin prism along a polyline (each segment its own, joints are covered by the next start)."""
        c = self.core
        for a, b in zip(pts[:-1], pts[1:]):
            v = Vector(b) - Vector(a)
            if v.length < 1e-4:
                continue
            rot = v.to_track_quat("Z", "Y").to_matrix().to_4x4()
            c.cyl(g, (0, 0, 0), r, v.length, mat, seg=seg, caps=(False, False), M=c.T(*a) @ rot, smooth=False)

    # ---- cables -------------------------------------------------------

    def cables(self):
        c = self.core
        rnd_all = random.Random("cables")
        for f in c.FURN:
            if f["kind"] != "desk":
                continue
            w, h, d = f["size"]
            s = c.sitter_side(f)
            rnd = random.Random("cab_" + f["id"])
            back = -s * (d / 2 + 0.012)
            g = c.Geo()
            n = 2 + (1 if w > 2.0 else 0)
            for k in range(n):
                x = (-0.5 + k / max(1, n - 1)) * (w * 0.55) if n > 1 else 0.0
                x += rnd.uniform(-0.05, 0.05)
                mat = rnd.choice(["cable_black", "cable_black", "cable_white", "cable_grey"])
                tail = rnd.uniform(0.12, 0.26)
                pts = [(x, -s * (d / 2 - 0.16), h + 0.004), (x, -s * (d / 2 - 0.02), h + 0.004),
                       (x, back, h - 0.03), (x, back, 0.03), (x, back, 0.008),
                       (x + rnd.uniform(-0.25, 0.25), back - s * tail * 0.6, 0.008),
                       (x + rnd.uniform(-0.4, 0.4), back - s * tail, 0.008)]
                self.tube(g, pts, 0.0065, mat, seg=5)
            # power strip on the floor behind the desk
            px = rnd.uniform(-w * 0.3, w * 0.3)
            c.box(g, (px, back - s * 0.1, 0.02), (0.3, 0.06, 0.035), "strip_white", 0.004)
            c.box(g, (px, back - s * 0.1 - s * 0.031, 0.022), (0.2, 0.004, 0.012), "cable_black")
            x0, z0 = f["pos"]
            ob = self.finish("geo_dress_cables_" + f["id"], g, x0, z0, 0.0, f.get("rot", 0))
        # server racks: a bundle up from the top, over to the wall side
        for f in c.FURN:
            if f["kind"] != "server_rack":
                continue
            w, h, d = f["size"]
            g = c.Geo()
            rnd = random.Random("rk_" + f["id"])
            for k in range(5):
                x = -w / 2 + 0.1 + k * (w - 0.2) / 4
                pts = [(x, 0.1, h), (x, 0.12, h + 0.12 + rnd.uniform(0, 0.08)), (x + rnd.uniform(-0.1, 0.1), d / 2 + 0.1, h + 0.14),
                       (x + rnd.uniform(-0.1, 0.1), d / 2 + 0.18, h - 0.1)]
                self.tube(g, pts, 0.008, rnd.choice(["cable_black", "cable_cyan", "cable_grey"]), seg=5)
            x0, z0 = f["pos"]
            self.finish("geo_dress_cables_" + f["id"], g, x0, z0, 0.0, f.get("rot", 0))

    # ---- desk clutter -------------------------------------------------

    def desk_rects(self, f):
        """Rectangles (x, y, half-x, half-y) already taken on a desk top, in the desk's own frame."""
        c = self.core
        w, h, d = f["size"]
        s = c.sitter_side(f)
        ys0 = s * (d / 2 - 0.2)
        rects = [(0.0, s * (d / 2 - 0.3), 0.3, 0.2),                       # keyboard and wrists
                 (-w / 2 + 0.38, ys0, 0.1, 0.13), (-w / 2 + 0.5, ys0 - 0.07, 0.09, 0.04),   # paper, pen
                 (w / 2 - 0.32, ys0, 0.08, 0.07)]                          # mug
        for sc in self.raw["screens"]:
            if sc["kind"] != "monitor":
                continue
            lv = c.local_of(f, sc["center"][0], sc["center"][2])
            if abs(lv.x) <= w / 2 + 0.05 and abs(lv.y) <= d / 2 + 0.1:
                rects.append((lv.x, lv.y, 0.37, 0.22))
        return rects

    def clutter(self):
        c = self.core
        items = {"cup": (0.05, 0.05, "b"), "sticky": (0.13, 0.05, "s"), "book": (0.1, 0.13, "s"), "phone": (0.05, 0.09, "s"),
                 "phones": (0.12, 0.09, "s"), "cactus": (0.05, 0.05, "b")}
        for f in c.FURN:
            if f["kind"] != "desk":
                continue
            w, h, d = f["size"]
            s = c.sitter_side(f)
            rnd = random.Random("clu_" + f["id"])
            g = c.Geo()
            taken = self.desk_rects(f)
            ys = s * (d / 2 - 0.26)
            yb = -s * (d / 2 - 0.12)
            for p in rnd.sample(list(items), 4):
                hx, hy, side = items[p]
                y = ys if side == "s" else yb
                xs = [-w / 2 + 0.15 + k * (w - 0.3) / 13 for k in range(14)]
                rnd.shuffle(xs)
                x = None
                for cx in xs:
                    if all(abs(cx - tx) > hx + thx or abs(y - ty) > hy + thy for (tx, ty, thx, thy) in taken):
                        x = cx
                        break
                if x is None:
                    continue
                taken.append((x, y, hx, hy))
                if p == "cup":
                    c.cyl(g, (x, y, h), 0.04, 0.095, "pot_slate", seg=8)
                    for q in range(3):
                        a = rnd.uniform(0, 6.28)
                        c.cyl(g, (x + 0.012 * math.cos(a), y + 0.012 * math.sin(a), h + 0.09), 0.0035, 0.07,
                              rnd.choice(["marker_red", "marker_blue", "tv_black"]), seg=4, R=Rx(rnd.uniform(-10, 10)))
                elif p == "sticky":
                    for q, m in enumerate(("sticky_yellow", "sticky_pink", "sticky_cyan")):
                        c.box(g, (x - 0.075 + 0.075 * q, y + rnd.uniform(-0.02, 0.02), h + 0.004 + 0.002 * q), (0.065, 0.065, 0.008),
                              m, R=Rz(rnd.uniform(-14, 14)))
                elif p == "book":
                    c.box(g, (x, y, h + 0.012), (0.15, 0.21, 0.024), "book_%d" % rnd.randrange(8), 0.002, R=Rz(rnd.uniform(-18, 18)))
                    c.box(g, (x + 0.02, y + 0.002, h + 0.026), (0.1, 0.17, 0.004), "board_white")
                elif p == "phone":
                    c.box(g, (x, y, h + 0.004), (0.07, 0.145, 0.008), "phone_black", 0.003, R=Rz(rnd.uniform(-25, 25)))
                elif p == "phones":
                    c.torus(g, (0, 0, 0), 0.075, 0.007, "black_plastic", seg=10, seg2=4, arc=180, a0=0,
                            M=c.T(x, y, h + 0.07) @ Rx(90))
                    for sx in (-1, 1):
                        c.cyl(g, (0, 0, 0), 0.04, 0.03, "black_plastic", seg=8,
                              M=c.T(x + sx * 0.075, y, h + 0.02) @ Ry(90) @ c.T(0, 0, -0.015))
                elif p == "cactus":
                    c.cyl(g, (x, y, h), 0.035, 0.06, "pot_ceramic", seg=8, r2=0.04)
                    c.sphere(g, (x, y, h + 0.1), 0.036, "cactus", seg=8, rings=5, scale=(1, 1, 1.5))
                    c.sphere(g, (x + 0.03, y, h + 0.09), 0.018, "cactus", seg=6, rings=4)
            x0, z0 = f["pos"]
            self.finish("geo_dress_clutter_" + f["id"], g, x0, z0, 0.0, f.get("rot", 0))

    # ---- plants and shelf ---------------------------------------------

    def plants(self):
        c = self.core
        for f in c.FURN:
            if f["kind"] != "plant":
                continue
            w, h, d = f["size"]
            rnd = random.Random("leaf_" + f["id"])
            ph = max(0.24, min(0.42, 0.3 * h))
            R = min(w, d) / 2 * 0.72
            g = c.Geo()
            n = 9 if h >= 1.2 else 7
            for k in range(n):
                a = 2 * math.pi * k / n + rnd.uniform(-0.25, 0.25)
                ln = (h - ph) * rnd.uniform(0.55, 0.9) if h < 1.2 else (h - ph) * rnd.uniform(0.28, 0.55)
                tilt = rnd.uniform(25, 55)
                base = 0.022
                m = "leaf_dark" if k % 2 else "leaf_light"
                # a flat blade, wide at the base, tapering, leaning outward
                c.tbox(g, (R * 0.25 * math.cos(a), R * 0.25 * math.sin(a), ph - 0.02), (0.07, 0.012), (0.012, 0.006), ln, m,
                       R=Rz(math.degrees(a) + 90) @ Rx(-tilt))
            x0, z0 = f["pos"]
            self.finish("geo_dress_leaves_" + f["id"], g, x0, z0, 0.0, f.get("rot", 0))

    def shelf(self):
        c = self.core
        for f in c.FURN:
            if f["kind"] != "bookshelf":
                continue
            w, h, d = f["size"]
            rnd = random.Random("sh_" + f["id"])
            g = c.Geo()
            # on top: a small pot plant, a frame, a trophy
            c.cyl(g, (-w * 0.3, 0.0, h), 0.06, 0.1, "pot_terracotta", seg=10, r2=0.075)
            c.sphere(g, (-w * 0.3, 0.0, h + 0.18), 0.09, "leaf_light", seg=8, rings=5)
            c.box(g, (w * 0.05, 0.02, h + 0.11), (0.22, 0.02, 0.22), "frame_dark", 0.004, R=Rz(-6))
            c.box(g, (w * 0.05, -0.0, h + 0.11), (0.18, 0.004, 0.18), "poster_amber", R=Rz(-6))
            c.cyl(g, (w * 0.32, 0.0, h), 0.04, 0.03, "brass", seg=8)
            c.cyl(g, (w * 0.32, 0.0, h + 0.03), 0.012, 0.09, "brass", seg=6)
            c.sphere(g, (w * 0.32, 0.0, h + 0.15), 0.035, "brass", seg=8, rings=5)
            x0, z0 = f["pos"]
            self.finish("geo_dress_shelf_" + f["id"], g, x0, z0, 0.0, f.get("rot", 0))

    # ---- posters ------------------------------------------------------

    def poster_content(self, g, kind, w, h, rnd):
        c = self.core
        y = -0.009
        c.box(g, (0, -0.002, 0), (w, 0.01, h), "poster_bg")
        if kind == "candles":
            n = 9
            x0 = -w / 2 + 0.07
            step = (w - 0.14) / (n - 1)
            price = 0.0
            for i in range(n):
                up = rnd.random() < 0.55
                bh = rnd.uniform(0.05, 0.16)
                top = price + (bh if up else -bh * 0.7)
                lo, hi = min(price, top), max(price, top)
                m = "poster_green" if up else "poster_red"
                zc = -h * 0.12 + (lo + hi) / 2
                c.box(g, (x0 + i * step, y, zc), (0.026, 0.006, hi - lo), m)
                c.box(g, (x0 + i * step, y - 0.001, zc), (0.004, 0.006, hi - lo + 0.07), m)
                price = top * 0.8
        elif kind == "skyline":
            c.box(g, (0, y, -h * 0.5 + 0.05), (w - 0.1, 0.006, 0.01), "poster_cyan")
            x = -w / 2 + 0.07
            while x < w / 2 - 0.1:
                bw = rnd.uniform(0.05, 0.1)
                bh = rnd.uniform(0.12, h * 0.6)
                c.box(g, (x + bw / 2, y, -h / 2 + 0.06 + bh / 2), (bw, 0.006, bh), "poster_navy")
                c.box(g, (x + bw / 2, y - 0.002, -h / 2 + 0.06 + bh - 0.02), (bw * 0.5, 0.004, 0.012), "poster_cyan")
                x += bw + 0.012
            c.sphere(g, (w * 0.22, y, h * 0.28), 0.06, "poster_amber", seg=10, rings=6, scale=(1, 0.15, 1))
        elif kind == "steps":
            for i in range(6):
                bh = 0.08 + i * 0.07
                c.box(g, (-w / 2 + 0.08 + i * (w - 0.16) / 5, y, -h / 2 + 0.07 + bh / 2), (0.07, 0.006, bh),
                      ["poster_cyan", "poster_magenta"][i % 2])
        elif kind == "target":
            for i, (r, m) in enumerate(((0.2, "poster_white"), (0.15, "poster_red"), (0.1, "poster_white"), (0.05, "poster_red"))):
                c.cyl(g, (0, 0, 0), r, 0.004, m, seg=16, M=c.T(0, y - i * 0.0012, 0.02) @ Rx(90) @ c.T(0, 0, -0.002))
        else:   # grid
            for i in range(4):
                for j in range(5):
                    if rnd.random() < 0.7:
                        c.box(g, (-w / 2 + 0.09 + i * 0.1, y, -h / 2 + 0.09 + j * 0.1), (0.07, 0.006, 0.07),
                              rnd.choice(["poster_magenta", "poster_cyan", "poster_amber", "poster_white"]))

    def posters(self, limit=9):
        c = self.core
        raw = self.raw
        kinds = ["candles", "skyline", "steps", "target", "grid"]
        placed = []
        for wl in raw["walls"]:
            if wl["kind"] != "solid":
                continue
            (ax, az), (bx, bz) = wl["a"], wl["b"]
            horiz = abs(az - bz) < 1e-6
            u0, u1 = sorted((ax, bx)) if horiz else sorted((az, bz))
            cc = az if horiz else ax
            for sd in (1, -1):
                probe = (lambda u: (u, cc + sd * 0.6)) if horiz else (lambda u: (cc + sd * 0.6, u))
                mid = probe((u0 + u1) / 2)
                if self.room_at(*mid) is None:
                    continue
                # candidate centres every 0.2 m; free if nothing mounted, no tall furniture, no door within
                cand = []
                u = u0 + 0.5
                while u < u1 - 0.5:
                    pw, ph = 0.62, 0.86
                    ok = True
                    for s in raw["screens"]:
                        sx, sy, sz = s["center"]
                        across, along = (sz, sx) if horiz else (sx, sz)
                        if abs(across - cc) < 0.8 and abs(along - u) < s["size"][0] / 2 + pw / 2 + 0.25 and \
                                sy + s["size"][1] / 2 > 1.05 and sy - s["size"][1] / 2 < 2.1:
                            ok = False
                            break
                    if ok:
                        for (x0, x1, z0, z1, hh, fid) in self.foot:
                            if hh < 1.0:
                                continue
                            a0, a1 = (x0, x1) if horiz else (z0, z1)
                            b0, b1 = (z0, z1) if horiz else (x0, x1)
                            if a0 - pw / 2 - 0.15 < u < a1 + pw / 2 + 0.15 and b0 < cc + 0.5 and b1 > cc - 0.5:
                                ok = False
                                break
                    if ok:
                        for d0, d1 in wl.get("doors", []):
                            if d0 - 0.5 < u < d1 + 0.5:
                                ok = False
                    if ok:
                        # keep clear of other walls meeting this one
                        for o in raw["walls"]:
                            for (px, pz) in (o["a"], o["b"]):
                                along, across = (px, pz) if horiz else (pz, px)
                                if o is not wl and abs(across - cc) < 0.05 and abs(along - u) < pw / 2 + 0.3:
                                    ok = False
                    if ok:
                        cand.append(u)
                    u += 0.2
                rnd = random.Random("post_" + wl["id"] + str(sd))
                rnd.shuffle(cand)
                chosen = []
                for u in cand:
                    if all(abs(u - v) > 3.4 for v in chosen):
                        chosen.append(u)
                    if len(chosen) >= 2:
                        break
                for u in chosen:
                    placed.append((wl["id"], sd, horiz, cc, u))
        rnd = random.Random("posters")
        rnd.shuffle(placed)
        made = 0
        for (wid, sd, horiz, cc, u) in placed[:limit]:
            kind = kinds[made % len(kinds)]
            pw, ph = 0.62, 0.86
            g = c.Geo()
            r2 = random.Random("poster_%s_%d" % (wid, made))
            self.poster_content(g, kind, pw, ph, r2)
            c.ring(g, pw, ph, 0.025, -0.006, 0.006, "frame_black", 0.003)
            face = cc + sd * (c.WALL_T / 2 + 0.007)
            yaw = {(True, 1): 0, (True, -1): 180, (False, 1): 90, (False, -1): 270}[(horiz, sd)]
            if horiz:
                self.finish("geo_dress_wall_poster_%d" % made, g, u, face, 1.6, yaw)
            else:
                self.finish("geo_dress_wall_poster_%d" % made, g, face, u, 1.6, yaw)
            made += 1
        return made

    # ---- floor graphics -----------------------------------------------

    def decals(self):
        c = self.core
        raw = self.raw
        z6 = 0.006
        door_n = 0
        zone_n = 0
        chosen_doors = []
        for wl in raw["walls"]:
            if wl["kind"] != "glass" or wl.get("procedural") or not wl.get("doors"):
                continue
            (ax, az), (bx, bz) = wl["a"], wl["b"]
            horiz = abs(az - bz) < 1e-6
            cc = az if horiz else ax
            for (d0, d1) in wl["doors"]:
                um = (d0 + d1) / 2
                # the side with the bigger room is the hall, the other is the office
                P = (lambda sd: (um, cc + sd * 0.7)) if horiz else (lambda sd: (cc + sd * 0.7, um))
                ra, rb = self.room_at(*P(1)), self.room_at(*P(-1))
                if ra is None or rb is None:
                    continue
                area = lambda r: (r["x"][1] - r["x"][0]) * (r["z"][1] - r["z"][0])
                hall, office, sd = (ra, rb, 1) if area(ra) >= area(rb) else (rb, ra, -1)
                chosen_doors.append((wl, horiz, cc, um, sd, hall, office, d1 - d0))
        for (wl, horiz, cc, um, sd, hall, office, width) in chosen_doors:
            g = c.Geo()
            # a rubber mat, 3 cm proud of nothing: 6 mm thick, on the hall side
            off = 0.36
            pos = (um, cc + sd * off) if horiz else (cc + sd * off, um)
            if self.free_floor(pos[0], pos[1], 0.1):
                size = (width - 0.1, 0.5, 0.008) if horiz else (0.5, width - 0.1, 0.008)
                bs = (size[0], size[1], size[2])
                c.box(g, (0, 0, 0.004), bs, "rubber", 0.002)
                self.finish("geo_decal_mat_%s_%d" % (wl["id"], door_n), g, pos[0], pos[1], 0.0, 0)
                door_n += 1
            # a zone disc for the office behind the door, further out on the hall side
            zmat = SCHOOL_ZONE.get(office["id"])
            if zmat is None and office["id"] in ("office_RnD", "office_Ops", "office_Goal"):
                zmat = "zone_other"
            if zmat:
                dpos = (um, cc + sd * 1.15) if horiz else (cc + sd * 1.15, um)
                if self.free_floor(dpos[0], dpos[1], 0.25):
                    g = c.Geo()
                    c.cyl(g, (0, 0, 0), 0.19, z6, "rubber", seg=20)
                    c.cyl(g, (0, 0, z6), 0.15, 0.002, zmat, seg=20)
                    c.cyl(g, (0, 0, z6 + 0.002), 0.05, 0.002, "poster_white", seg=12)
                    self.finish("geo_decal_zone_%d" % zone_n, g, dpos[0], dpos[1], 0.0, 0)
                    zone_n += 1
        # entrance chevrons: from the front door north along the hall
        g = c.Geo()
        ent = next((f for f in raw["furniture"] if f["id"] == "doorframe_main"), None)
        n_ch = 0
        if ent:
            x0 = ent["pos"][0]
            z = ent["pos"][1] - 0.9
            for k in range(7):
                zz = z - k * 0.8
                if not self.free_floor(x0, zz, 0.3):
                    continue
                for sx in (-1, 1):
                    c.box(g, (0, 0, 0), (0.34, 0.07, 0.006), "neon_amber", 0.001,
                          M=c.T(x0 + sx * 0.12, -zz, 0.003) @ Rz(-sx * 42))
                n_ch += 1
            self.finish("geo_decal_chevrons", g, 0.0, 0.0, 0.0, 0)
        # the war-room table: a cyan outline on the floor
        tw = next((f for f in raw["furniture"] if f["id"] == "table_war"), None)
        if tw:
            g = c.Geo()
            hw, hd = tw["size"][0] / 2 + 0.55, tw["size"][2] / 2 + 0.55
            t = 0.035
            c.box(g, (0, -hd, 0.003), (2 * hw + t, t, 0.006), "neon_cyan")
            c.box(g, (0, hd, 0.003), (2 * hw + t, t, 0.006), "neon_cyan")
            c.box(g, (-hw, 0, 0.003), (t, 2 * hd - t, 0.006), "neon_cyan")
            c.box(g, (hw, 0, 0.003), (t, 2 * hd - t, 0.006), "neon_cyan")
            self.finish("geo_decal_warroom_ring", g, tw["pos"][0], tw["pos"][1], 0.0, 0)
        return door_n, zone_n, n_ch


def build(core, log=print):
    d = Dress(core)
    d.cables()
    d.clutter()
    d.plants()
    d.shelf()
    np_ = d.posters()
    door_n, zone_n, n_ch = d.decals()
    log("dress: %d objects, %d triangles (posters %d, mats %d, zone discs %d, chevrons %d)" % (
        len(d.names), d.tris, np_, door_n, zone_n, n_ch))
    if d.tris > MAX_TRIS:
        raise RuntimeError("set dressing is %d triangles, budget %d" % (d.tris, MAX_TRIS))
    return d.names


def Rz(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def Rx(deg):
    return Matrix.Rotation(math.radians(deg), 4, "X")


def Ry(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Y")
