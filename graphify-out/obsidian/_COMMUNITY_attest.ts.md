---
type: community
cohesion: 0.12
members: 34
---

# attest.ts

**Cohesion:** 0.12 - loosely connected
**Members:** 34 nodes

## Members
- [[ATTESTED_FIELDS]] - code - src/lib/journal/attest.ts
- [[ATTEST_EVENTS]] - code - src/lib/journal/attest.ts
- [[AppendResult]] - code - src/lib/journal/attest-server.ts
- [[AttestEvent]] - code - src/lib/journal/attest.ts
- [[AttestationRow]] - code - src/lib/journal/attest.ts
- [[AttestedField]] - code - src/lib/journal/attest.ts
- [[ChainGap]] - code - src/lib/journal/attest-server.ts
- [[ChainVerdict]] - code - src/lib/journal/attest.ts
- [[GENESIS_HASH]] - code - src/lib/journal/attest.ts
- [[RFC-3161]] - concept - src/lib/journal/attest.ts
- [[RFC-8785]] - concept - src/lib/journal/attest.ts
- [[Seal]] - code - src/lib/journal/attest.ts
- [[TIMESTAMP_FIELDS]] - code - src/lib/journal/attest.ts
- [[appendAttestation()]] - code - src/lib/journal/attest-server.ts
- [[attest-server.ts]] - code - src/lib/journal/attest-server.ts
- [[attest.ts]] - code - src/lib/journal/attest.ts
- [[attestedBody()]] - code - src/lib/journal/attest.ts
- [[bodyHash()]] - code - src/lib/journal/attest.ts
- [[buildLink()]] - code - src/lib/journal/attest.ts
- [[canonicalNumber()]] - code - src/lib/journal/attest.ts
- [[canonicalString()]] - code - src/lib/journal/attest.ts
- [[canonicalize()]] - code - src/lib/journal/attest.ts
- [[chainHealth]] - code - src/lib/journal/attest-server.ts
- [[currentTip()]] - code - src/lib/journal/attest-server.ts
- [[findUnattestedTrades()]] - code - src/lib/journal/attest-server.ts
- [[isUniqueViolation()]] - code - src/lib/journal/attest-server.ts
- [[linkHash()]] - code - src/lib/journal/attest.ts
- [[normalizeTimestamp()]] - code - src/lib/journal/attest.ts
- [[readChain()]] - code - src/lib/journal/attest-server.ts
- [[sealTip()]] - code - src/lib/journal/attest.ts
- [[sealUserChain()]] - code - src/lib/journal/attest-server.ts
- [[sha256Hex()]] - code - src/lib/journal/attest.ts
- [[verifyChain()]] - code - src/lib/journal/attest.ts
- [[verifyUserChain()]] - code - src/lib/journal/attest-server.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/attestts
SORT file.name ASC
```

## Connections to other communities
- 5 edges to [[_COMMUNITY_journalserver.ts]]
- 3 edges to [[_COMMUNITY_getSql]]
- 2 edges to [[_COMMUNITY_@tanstackreact-start]]
- 2 edges to [[_COMMUNITY_card-journal.ts]]
- 2 edges to [[_COMMUNITY_verify-attestation.mjs]]
- 1 edge to [[_COMMUNITY_ref_node_url]]
- 1 edge to [[_COMMUNITY_rh-oauth.ts]]

## Top bridge nodes
- [[attest-server.ts]] - degree 24, connects to 4 communities
- [[attest.ts]] - degree 26, connects to 3 communities
- [[appendAttestation()]] - degree 9, connects to 2 communities
- [[chainHealth]] - degree 9, connects to 2 communities
- [[readChain()]] - degree 5, connects to 1 community