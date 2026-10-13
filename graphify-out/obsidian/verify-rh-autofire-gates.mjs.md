---
source_file: "scripts/verify-rh-autofire-gates.mjs"
type: "code"
community: "rh-autofire.ts"
location: "L1"
tags:
  - graphify/code
  - graphify/EXTRACTED
  - community/rh-autofirets
---

# verify-rh-autofire-gates.mjs

## Connections
- [[ARMED_FLAGS]] - `contains` [EXTRACTED]
- [[FUNDED]] - `contains` [EXTRACTED]
- [[KEATON_LIVE]] - `contains` [EXTRACTED]
- [[MANAGER_OK]] - `contains` [EXTRACTED]
- [[NOW_2]] - `contains` [EXTRACTED]
- [[QUALIFIED]] - `contains` [EXTRACTED]
- [[ROOT_3]] - `contains` [EXTRACTED]
- [[aplusconfig.ts]] - `dynamic_import` [EXTRACTED]
- [[check()_13]] - `indirect_call` [INFERRED]
- [[manager-account.ts]] - `dynamic_import` [EXTRACTED]
- [[nodefs]] - `dynamic_import` [EXTRACTED]
- [[read()_1]] - `contains` [EXTRACTED]
- [[ref_node_fs]] - `imports_from` [EXTRACTED]
- [[ref_node_path]] - `imports_from` [EXTRACTED]
- [[ref_node_url]] - `imports_from` [EXTRACTED]
- [[rh-autofire-gates.ts]] - `dynamic_import` [EXTRACTED]
- [[rh-autofire.ts]] - `dynamic_import` [EXTRACTED]
- [[verify-manager-account.mjs]] - `dynamic_import` [EXTRACTED]
- [[verify-manager-agree.mjs]] - `dynamic_import` [EXTRACTED]
- [[verify-manager-live-loop.mjs]] - `dynamic_import` [EXTRACTED]
- [[word()]] - `indirect_call` [INFERRED]

#graphify/code #graphify/EXTRACTED #community/rh-autofirets