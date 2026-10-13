---
type: community
cohesion: 0.11
members: 31
---

# Community 202

**Cohesion:** 0.11 - loosely connected
**Members:** 31 nodes

## Members
- [[Add the images, samplers, textures and material wiring to an exported glB…]] - rationale - scripts/blender/floor_tex.py
- [[Box-projected UVs on every mesh that uses a tiled material. Floors and walls…]] - rationale - scripts/blender/floor_tex.py
- [[COLOR_n accessors that are normalised unsigned shorts become normalised…]] - rationale - scripts/blender/floor_pack.py
- [[Periodic noise white noise filtered in the frequency domain, unit standard…]] - rationale - scripts/blender/floor_tex.py
- [[Rebuild accessors, bufferViews and the buffer so only referenced data stays.…]] - rationale - scripts/blender/floor_pack.py
- [[Remove COLOR_0 from primitives whose occlusion never drops below `floor` (all…]] - rationale - scripts/blender/floor_pack.py
- [[The accessor's elements as tightly packed bytes (stride removed). Sparse…]] - rationale - scripts/blender/floor_pack.py
- [[Write the tiles as greyscale JPEG with Blender's own encoder. Returns name -…]] - rationale - scripts/blender/floor_tex.py
- [[_primitives()]] - code - scripts/blender/floor_pack.py
- [[_spec()]] - code - scripts/blender/floor_tex.py
- [[accessor_bytes()]] - code - scripts/blender/floor_pack.py
- [[add_uvs()]] - code - scripts/blender/floor_tex.py
- [[add_view()]] - code - scripts/blender/floor_pack.py
- [[bpy]] - concept
- [[colors_u8()]] - code - scripts/blender/floor_pack.py
- [[compact()_1]] - code - scripts/blender/floor_pack.py
- [[embed()]] - code - scripts/blender/floor_tex.py
- [[floor_pack.py]] - code - scripts/blender/floor_pack.py
- [[floor_pack.py - post-process a .glb written by Blender's exporter. Pure Python…]] - rationale - scripts/blender/floor_pack.py
- [[floor_tex.py]] - code - scripts/blender/floor_tex.py
- [[floor_tex.py - the tiling material set (D2) four 512 px tiles, world-space …]] - rationale - scripts/blender/floor_tex.py
- [[make_tiles()]] - code - scripts/blender/floor_tex.py
- [[name - float array (N, N) in 0..1, as the bytes will be (sRGB-encoded grey).]] - rationale - scripts/blender/floor_tex.py
- [[os]] - concept
- [[pack()_1]] - code - scripts/blender/floor_pack.py
- [[prune_flat()]] - code - scripts/blender/floor_pack.py
- [[read_glb()]] - code - scripts/blender/floor_pack.py
- [[struct]] - concept
- [[tile_jpegs()]] - code - scripts/blender/floor_tex.py
- [[want()_1]] - code - scripts/blender/floor_pack.py
- [[write_glb()]] - code - scripts/blender/floor_pack.py

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Community_202
SORT file.name ASC
```

## Connections to other communities
- 7 edges to [[_COMMUNITY_Community 140]]
- 6 edges to [[_COMMUNITY_Community 226]]
- 3 edges to [[_COMMUNITY_Community 120]]
- 2 edges to [[_COMMUNITY_Community 225]]
- 1 edge to [[_COMMUNITY_Community 146]]
- 1 edge to [[_COMMUNITY_Community 306]]
- 1 edge to [[_COMMUNITY_Community 74]]

## Top bridge nodes
- [[os]] - degree 9, connects to 7 communities
- [[floor_pack.py]] - degree 13, connects to 2 communities
- [[floor_tex.py]] - degree 11, connects to 2 communities
- [[make_tiles()]] - degree 5, connects to 2 communities
- [[bpy]] - degree 4, connects to 2 communities