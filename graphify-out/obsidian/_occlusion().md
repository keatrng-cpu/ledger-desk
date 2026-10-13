---
source_file: "scripts/blender/floor_ao.py"
type: "code"
community: "floor_ao.py"
location: "L180"
tags:
  - graphify/code
  - graphify/EXTRACTED
  - community/floor_aopy
---

# _occlusion()

## Connections
- [[0 = open sky, 1 = buried. Close hits count fully, far hits fade out.]] - `rationale_for` [EXTRACTED]
- [[_bake_mesh()]] - `calls` [EXTRACTED]
- [[_frame()]] - `calls` [EXTRACTED]
- [[_hemisphere()]] - `calls` [EXTRACTED]
- [[floor_ao.py]] - `contains` [EXTRACTED]
- [[refine_rect()]] - `calls` [EXTRACTED]

#graphify/code #graphify/EXTRACTED #community/floor_aopy