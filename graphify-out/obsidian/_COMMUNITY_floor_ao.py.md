---
type: community
cohesion: 0.06
members: 50
---

# floor_ao.py

**Cohesion:** 0.06 - loosely connected
**Members:** 50 nodes

## Members
- [[0 = open sky, 1 = buried. Close hits count fully, far hits fade out.]] - rationale - scripts/blender/floor_ao.py
- [[AO over a rectangle (origin org, unit axes du and dv, size w x h, outward…]] - rationale - scripts/blender/floor_ao.py
- [[Cosine-weighted directions about +Z (Hammersley).]] - rationale - scripts/blender/floor_ao.py
- [[Delete polygons nobody can see down-facing faces at floor level, and faces…]] - rationale - scripts/blender/floor_opt.py
- [[Extent of a screen along the wall axis.]] - rationale - scripts/blender/floor_doors.py
- [[Merge every large vertical face of the solid  low  window walls by the kd…]] - rationale - scripts/blender/floor_ao.py
- [[Names - category for every mesh object 'floor', 'wall', 'obj' or None.]] - rationale - scripts/blender/floor_ao.py
- [[One scr_blank for every scr_id material.]] - rationale - scripts/blender/floor_opt.py
- [[Orthonormal frame about normal n, rotated by ang.]] - rationale - scripts/blender/floor_ao.py
- [[Point in a 2D polygon after dropping axis `drop` (crossing number).]] - rationale - scripts/blender/floor_opt.py
- [[Re-mesh every room floor from the kd merge and bake it. Returns the triangle…]] - rationale - scripts/blender/floor_ao.py
- [[Rectangles (i0, i1, j0, j1) over lattice vertices whose corner-bilinear fit…]] - rationale - scripts/blender/floor_ao.py
- [[Share one mesh datablock between objects with identical geometry. Returns…]] - rationale - scripts/blender/floor_opt.py
- [[Triangles (lattice index pairs) for one rectangle, using every neighbour-…]] - rationale - scripts/blender/floor_ao.py
- [[Write the AO colour attribute for every loop of me. Returns the number of…]] - rationale - scripts/blender/floor_ao.py
- [[_along_range()]] - code - scripts/blender/floor_doors.py
- [[_bake_mesh()]] - code - scripts/blender/floor_ao.py
- [[_build_bvh()]] - code - scripts/blender/floor_ao.py
- [[_frame()]] - code - scripts/blender/floor_ao.py
- [[_hemisphere()]] - code - scripts/blender/floor_ao.py
- [[_inside()]] - code - scripts/blender/floor_opt.py
- [[_kd_leaves()]] - code - scripts/blender/floor_ao.py
- [[_mesh_key()]] - code - scripts/blender/floor_opt.py
- [[_mesh_world()]] - code - scripts/blender/floor_ao.py
- [[_newell()_1]] - code - scripts/blender/floor_opt.py
- [[_occlusion()]] - code - scripts/blender/floor_ao.py
- [[_rect_tris()]] - code - scripts/blender/floor_ao.py
- [[_shade()]] - code - scripts/blender/floor_ao.py
- [[bake()]] - code - scripts/blender/floor_ao.py
- [[bar()_1]] - code - scripts/blender/floor_doors.py
- [[bmesh]] - concept
- [[build()_1]] - code - scripts/blender/floor_doors.py
- [[build_floors()]] - code - scripts/blender/floor_ao.py
- [[build_walls()_1]] - code - scripts/blender/floor_ao.py
- [[classify()_1]] - code - scripts/blender/floor_ao.py
- [[dedupe_meshes()]] - code - scripts/blender/floor_opt.py
- [[floor_ao.py]] - code - scripts/blender/floor_ao.py
- [[floor_ao.py - baked ambient occlusion for the office, written as vertex colours…]] - rationale - scripts/blender/floor_ao.py
- [[floor_doors.py]] - code - scripts/blender/floor_doors.py
- [[floor_doors.py - sliding glass door panels for every door gap in a glass wall.…]] - rationale - scripts/blender/floor_doors.py
- [[floor_opt.py]] - code - scripts/blender/floor_opt.py
- [[floor_opt.py - size passes run on the finished scene, before the glTF export.…]] - rationale - scripts/blender/floor_opt.py
- [[half()]] - code - scripts/blender/floor_ao.py
- [[hashlib]] - concept
- [[hidden_faces()]] - code - scripts/blender/floor_opt.py
- [[mathutils]] - concept
- [[mathutils_bvhtree]] - concept
- [[merge_screen_materials()]] - code - scripts/blender/floor_opt.py
- [[numpy]] - concept
- [[refine_rect()]] - code - scripts/blender/floor_ao.py

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/floor_aopy
SORT file.name ASC
```

## Connections to other communities
- 7 edges to [[_COMMUNITY_floor_pack.py]]
- 5 edges to [[_COMMUNITY_json]]
- 4 edges to [[_COMMUNITY_smoke_live.py]]
- 2 edges to [[_COMMUNITY_fills.py]]
- 1 edge to [[_COMMUNITY_build_floor.py]]
- 1 edge to [[_COMMUNITY_selfcheck.py]]
- 1 edge to [[_COMMUNITY_smc_ref.py]]

## Top bridge nodes
- [[numpy]] - degree 17, connects to 5 communities
- [[floor_ao.py]] - degree 23, connects to 3 communities
- [[mathutils]] - degree 5, connects to 2 communities
- [[floor_opt.py]] - degree 12, connects to 1 community
- [[bake()]] - degree 8, connects to 1 community