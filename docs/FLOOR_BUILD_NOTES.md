# Floor build notes (Run 3, Track B: Blender)

Branch `floor/blender`, from `fc9560c`. Presentation assets only; nothing under `src/` was touched.

## Rebuild

```
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P scripts/blender/build_floor.py -- --office --verify
```
Flags after `--`: `--office`, `--portraits`, `--verify`, `--no-ao --no-doors --no-dress --no-opt --no-compress --no-textures`, `--keep-meshopt`, `--tex-draco`.
Env: `FLOOR_OUT_DIR` (write elsewhere), `FLOOR_AO_LATTICE`, `FLOOR_AO_TOL`, `FLOOR_HOOK` / `FLOOR_HOOK_ONLY` (debug script against the finished scene).
A full office build takes about 1 minute. Blender 5.2.2 produced a structurally identical GLB to the committed one before any change (279 nodes, 90,228 triangles, 3,646,248 vs 3,646,080 bytes).

Tools: `scripts/blender/glb-stats.mjs` (sizes, nodes, extras, `--against`), `preview-glb.mjs` (plain GLTFLoader + Draco/Meshopt in headless Chromium, runtime-like lights, `--open-doors`, `--novc`), `png-diff.mjs` (pixel diff / side-by-side crop).

## Measured

| | nodes | triangles drawn (unique) | bytes |
|---|---|---|---|
| start (committed) | 279 | 90,228 | 3,646,080 |
| D1 AO | 279 | 99,658 | 4,339,816 (+19.0%) |
| D4 doors | 290 | 100,582 | 4,403,100 |
| D3 dressing (+10,564 tris) | 355 | 111,814 | 5,044,080 |
| D5 final `office.glb` | 355 | 107,193 (79,095) | 3,484,844 |
| `office.draco.glb` | 355 | same | 1,215,108 (34.9% of plain) |
| `office.tex.glb` | 355 | same | 4,033,684 |

Meshopt through Blender's exporter: 2,314,376 bytes, not shipped. Pixel diff of the D5 size passes against the D3 build on 12 cameras: under 0.12% of pixels differ by more than 12 levels (counter-edge line, nothing else).

## What was built

- **D1 AO** (`floor_ao.py`): COLOR_0, deterministic. Floors and large wall faces are sampled on a 0.15 m lattice and merged by a kd-tree (a gradient along a wall costs a few long rectangles). Furniture gets self-AO in its own frame (identical pieces stay identical, so they can share mesh data). Skipped: screens, emissives, keyboards, slab, glass walls, doors, decals. `floor_pack.py` packs COLOR_0 to bytes and drops it where it multiplies by about 1.
- **D4 doors** (`floor_doors.py`): see below.
- **D3 dressing** (`floor_dress.py`): cables, desk clutter, foliage blades, shelf objects, 4 posters, door mats, zone discs, entrance chevrons, a cyan outline round the war-room table. 10,564 triangles (cap 15,000 is enforced). Small pieces carry extras `cull_distance` (metres) for runtime distance culling.
- **D5** (`floor_opt.py`): hidden faces removed (1,554 polygons), 64 `scr_<id>` materials merged into `scr_blank` (the runtime swaps a screen's material by node name; node ids unchanged), 132 objects share mesh data. Draco variant through Blender's exporter.
- **D2** (`floor_tex.py`): four 512 px greyscale JPEG tiles (carpet, wood, concrete, glass smear; about 150 KB together), periodic by construction, box-projected UVs (world space for floors and walls, object space otherwise). One image per tile serves as colour map and, through G, as roughness map (two samplers per tile so GLTFLoader does not share one texture object between an sRGB and a linear use). It is a **separate file**, `office.tex.glb`, because `scripts/verify-room.mjs` asserts that `office.glb` carries no images and that script is outside my paths. To make it the default: load `/floor/office.tex.glb` and drop the `images` clause of that check.

## Door nodes (D4)

11 nodes, `door_<wallId>_<index>` (index = position in the wall's `doors` list): `door_front_back_row_0..2`, `door_front_front_row_0..1`, `door_part_sterling_vince_0`, `door_lab_north_0`, `door_ops_east_0`, `door_goal_west_0`, `door_inv_board_north_0`, `door_inv_chair_north_0`.
Origin = centre of the CLOSED panel. Extras (three axes, metres): `slide_axis [x,y,z]` (unit, along the wall, toward the longer glass span), `slide_distance`, `width`, `height`, `wall`, `index`. Open: `node.position += slide_axis * slide_distance * openness`. The panel sits 3.4 cm off the wall plane so it passes in front of the fixed glass. Nav grid untouched. The ext_south entrance (a low wall with `doorframe_main`) has no panel (the brief said glass walls).

## For the runtime author

- GLTFLoader sets `vertexColors` itself when COLOR_0 is present; no code change needed for AO.
- Nodes now share meshes (cloned per node by GLTFLoader); keep reading by node name, not mesh name.
- `office.draco.glb` needs `DRACOLoader` (decoders in `three/examples/jsm/libs/draco/gltf/`).
- Name contract unchanged; new nodes use `geo_dress_*`, `geo_decal_*`, `door_*`; none contains an emissive id or `key_<Name>`. New neon-ish materials are emissive and could feed the L2 bloom.

## Not done

- **C1 characters (`crew.glb`, `crew-manifest.json`, morph targets) was not started**: the budget ran out first. The portraits are unchanged (the busts still build with the same script; not re-run in this branch).
- D2 textures are not in the default `office.glb` (see above); D2 was checked by eye on the war-room floor and desks only.
- Normals stay float32 in the plain file (dropping them would remove the shadow normal-bias effect); quantisation lives in the Draco file.
