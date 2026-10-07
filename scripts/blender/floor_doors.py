"""
floor_doors.py - sliding glass door panels for every door gap in a glass wall.

One node per gap, named  door_<wallId>_<index>  (index = the position of the gap in the wall's "doors" list in
src/data/floor-layout.json). The node's ORIGIN is the centre of the CLOSED panel, so the runtime opens it by
translating the node along the slide axis:

    panel.position = closedPosition + slide_axis * slide_distance * openness      (openness 0..1)

glTF extras on the node (three / layout axes, metres):
    slide_axis      [x, y, z]  unit vector, [+-1,0,0] for a wall that runs along x, [0,0,+-1] for one along z
    slide_distance  number     how far the panel travels to be fully open (never more than the glass beside the gap)
    width           number     the clear width of the gap (the panel is 2 cm wider than this to overlap the jambs)
    height          number     the panel height
    wall            string     the wall id
    index           number     the gap's index in that wall's doors list

The panel sits 3.4 cm off the wall plane (on the side away from anything mounted on the glass) so that, open, it slides in
front of the fixed glass and its mullions without touching them. Nothing here changes the plan, the nav grid or any
node the runtime already looks up; the walls themselves are untouched (the gap stays a gap, the panel fills it).
"""

import math

from mathutils import Vector

PANEL_OFFSET = 0.034      # distance of the panel's mid-plane from the wall's mid-plane
FRAME_T = 0.02            # aluminium frame thickness (glass is core.PANE = 0.012)
STILE = 0.04
RAIL_TOP = 0.04
RAIL_BOTTOM = 0.09
OVERLAP = 0.01            # the panel is wider than the gap by this much on each side


def _along_range(s, horiz):
    """Extent of a screen along the wall axis."""
    cx, cy, cz = s["center"]
    w = s["size"][0]
    c = cx if horiz else cz
    return (c - w / 2, c + w / 2)


def build(core, log=print):
    LAYOUT = core.LAYOUT
    made = []
    for wl in LAYOUT["walls"]:
        if wl["kind"] != "glass" or not wl.get("doors"):
            continue
        (ax, az), (bx, bz) = wl["a"], wl["b"]
        horiz = abs(az - bz) < 1e-6
        u0, u1 = sorted((ax, bx)) if horiz else sorted((az, bz))
        c = az if horiz else ax
        doors = [tuple(sorted(d)) for d in wl["doors"]]
        for k, (d0, d1) in enumerate(doors):
            width = d1 - d0
            before = [e for (s, e) in doors if s < d0 - 1e-6]
            after = [s for (s, e) in doors if s > d1 + 1e-6]
            left = d0 - (max(before) if before else u0)
            right = (min(after) if after else u1) - d1
            direction = 1.0 if right >= left else -1.0
            room = right if direction > 0 else left
            dist = round(max(0.3, min(width + 0.03, room - 0.06)), 3)
            # which face of the wall carries screens or plates in the slide path (so the panel goes on the other)
            lo = d0 - (dist if direction < 0 else 0.0)
            hi = d1 + (dist if direction > 0 else 0.0)
            load = {1: 0, -1: 0}
            for s in core.SCREENS:
                cx, cy, cz = s["center"]
                across = cz if horiz else cx
                if abs(across - c) > 0.2 or cy - s["size"][1] / 2 >= core.DOOR_H:
                    continue
                a0, a1 = _along_range(s, horiz)
                if a1 > lo and a0 < hi:
                    load[1 if across >= c else -1] += 1
            side = 1.0 if load[1] <= load[-1] else -1.0
            off = side * PANEL_OFFSET
            hp = core.DOOR_H - 0.01
            zc = 0.006 + hp / 2
            lp = width + 2 * OVERLAP
            um = (d0 + d1) / 2

            g = core.Geo()

            def bar(la_c, z_c, la, lh, th, mat, t_off=0.0):
                """Box centred la_c along the wall axis (three direction) and z_c up, t_off across the wall."""
                if horiz:
                    core.box(g, (la_c, -t_off, z_c), (la, th, lh), mat)
                else:
                    core.box(g, (t_off, -la_c, z_c), (th, la, lh), mat)

            bar(0.0, 0.0, lp, hp, core.PANE, "glass")
            bar(0.0, hp / 2 - RAIL_TOP / 2, lp, RAIL_TOP, FRAME_T, "alu")
            bar(0.0, -hp / 2 + RAIL_BOTTOM / 2, lp, RAIL_BOTTOM, FRAME_T, "alu")
            for sx in (-1, 1):
                bar(sx * (lp / 2 - STILE / 2), 0.0, STILE, hp - RAIL_TOP - RAIL_BOTTOM, FRAME_T, "alu")
            # pull handles on the closing edge (the one away from the slide direction), both faces
            hx = -direction * (lp / 2 - STILE - 0.03)
            for sd in (-1, 1):
                bar(hx, 0.0, 0.022, 0.5, 0.014, "chrome", t_off=sd * (FRAME_T / 2 + 0.007))

            name = "door_%s_%d" % (wl["id"], k)
            if horiz:
                loc = (um, -(c + off), zc)
            else:
                loc = (c + off, -um, zc)
            ob = core.make_obj(name, g, loc)
            axis = (direction, 0.0, 0.0) if horiz else (0.0, 0.0, direction)
            ob["slide_axis"] = [float(v) for v in axis]
            ob["slide_distance"] = float(dist)
            ob["width"] = round(float(width), 3)
            ob["height"] = round(float(hp), 3)
            ob["wall"] = wl["id"]
            ob["index"] = int(k)
            made.append(name)
    tris = sum(len(p.vertices) - 2 for n in made for p in core.bpy.data.objects[n].data.polygons)
    log("doors: %d sliding panels, %d triangles" % (len(made), tris))
    return made
