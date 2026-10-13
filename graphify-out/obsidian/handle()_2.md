---
source_file: "src/routes/api/cron/exec-flatten.ts"
type: "code"
community: "jsonResponse"
location: "L23"
tags:
  - graphify/code
  - graphify/EXTRACTED
  - community/jsonResponse
---

# handle()

## Connections
- [[dot-markNet()]] - `calls` [INFERRED]
- [[dot-state()]] - `calls` [INFERRED]
- [[PgExecStore]] - `calls` [EXTRACTED]
- [[authorizeCronRequest()]] - `calls` [EXTRACTED]
- [[etWindow_1]] - `calls` [EXTRACTED]
- [[exec-flatten.ts]] - `indirect_call` [INFERRED]
- [[execStep()]] - `calls` [EXTRACTED]
- [[getSql()]] - `calls` [EXTRACTED]
- [[isForced()]] - `calls` [EXTRACTED]
- [[jsonResponse()]] - `calls` [EXTRACTED]
- [[rh-dispatch.ts]] - `imports_from` [EXTRACTED]
- [[rh-ledger.ts]] - `imports_from` [EXTRACTED]
- [[rh-mcp.ts]] - `imports_from` [EXTRACTED]
- [[rhAutofireEnabled()]] - `calls` [EXTRACTED]
- [[rhLiveArmed()]] - `calls` [EXTRACTED]
- [[safetyNetDue()]] - `calls` [EXTRACTED]

#graphify/code #graphify/EXTRACTED #community/jsonResponse