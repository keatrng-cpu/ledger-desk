---
type: community
cohesion: 0.08
members: 51
---

# send-server.ts

**Cohesion:** 0.08 - loosely connected
**Members:** 51 nodes

## Members
- [[4. Web Push (B4) — zero new dependencies]] - document - INTEGRATION-C.md
- [[ALERT_KINDS]] - code - src/lib/alerts/types.ts
- [[ALERT_LABELS]] - code - src/lib/alerts/types.ts
- [[ALERT_URGENCY]] - code - src/lib/alerts/types.ts
- [[AlertKind]] - code - src/lib/alerts/types.ts
- [[AlertNotification]] - code - src/lib/alerts/types.ts
- [[AlertRecord]] - code - src/lib/alerts/types.ts
- [[AlertResult]] - code - src/lib/alerts/send-server.ts
- [[AlertRow]] - code - src/lib/alerts/store-server.ts
- [[AlertSpec]] - code - src/lib/alerts/send-server.ts
- [[MAX_PUSH_PLAINTEXT]] - code - src/lib/alerts/push-server.ts
- [[PushConfigState]] - code - src/lib/alerts/push-server.ts
- [[PushSendResult]] - code - src/lib/alerts/push-server.ts
- [[PushTarget]] - code - src/lib/alerts/push-server.ts
- [[RFC-8188]] - concept - src/lib/alerts/push-server.ts
- [[RFC-8291]] - concept - src/lib/alerts/push-server.ts
- [[RFC-8292]] - concept - src/lib/alerts/push-server.ts
- [[Raising alerts from the trading path]] - document - INTEGRATION-C.md
- [[StoredSubscription]] - code - src/lib/alerts/store-server.ts
- [[SubRow]] - code - src/lib/alerts/store-server.ts
- [[alertstypes.ts]] - code - src/lib/alerts/types.ts
- [[b64url()]] - code - src/lib/alerts/push-server.ts
- [[claimAlert()]] - code - src/lib/alerts/store-server.ts
- [[deleteDeadEndpoint()]] - code - src/lib/alerts/store-server.ts
- [[encryptPayload()]] - code - src/lib/alerts/push-server.ts
- [[envValue()]] - code - src/lib/alerts/push-server.ts
- [[etDay()_1]] - code - src/lib/alerts/send-server.ts
- [[fromB64url()]] - code - src/lib/alerts/push-server.ts
- [[haltHitAlert()]] - code - src/lib/alerts/send-server.ts
- [[isAlertKind()]] - code - src/lib/alerts/types.ts
- [[listSubscriptions()]] - code - src/lib/alerts/store-server.ts
- [[markDelivered()]] - code - src/lib/alerts/store-server.ts
- [[newsBlackoutAlert()]] - code - src/lib/alerts/send-server.ts
- [[positionFlattenedAlert()]] - code - src/lib/alerts/send-server.ts
- [[push-server.ts]] - code - src/lib/alerts/push-server.ts
- [[pushConfig()]] - code - src/lib/alerts/push-server.ts
- [[raiseDeskAlerts()]] - code - src/routes/index.tsx
- [[raiseNewsBlackoutAlert]] - code - src/lib/alerts/trigger-server.ts
- [[raisePositionFlattenedAlert]] - code - src/lib/alerts/trigger-server.ts
- [[raiseSetupArmedAlert]] - code - src/lib/alerts/trigger-server.ts
- [[recordDeliveryOutcome()]] - code - src/lib/alerts/store-server.ts
- [[send-server.ts]] - code - src/lib/alerts/send-server.ts
- [[sendAlert()]] - code - src/lib/alerts/send-server.ts
- [[sendPush()]] - code - src/lib/alerts/push-server.ts
- [[setupArmedAlert()]] - code - src/lib/alerts/send-server.ts
- [[store-server.ts]] - code - src/lib/alerts/store-server.ts
- [[vapidHeader()]] - code - src/lib/alerts/push-server.ts
- [[vapidKeyPair()]] - code - src/lib/alerts/push-server.ts
- [[vapidPrivateKey()]] - code - src/lib/alerts/push-server.ts
- [[vapidPublicKey()]] - code - src/lib/alerts/push-server.ts
- [[vapidSubject()]] - code - src/lib/alerts/push-server.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/send-serverts
SORT file.name ASC
```

## Connections to other communities
- 21 edges to [[_COMMUNITY_jsonResponse]]
- 10 edges to [[_COMMUNITY_alertsserver.ts]]
- 7 edges to [[_COMMUNITY_getSql]]
- 6 edges to [[_COMMUNITY_index.tsx]]
- 5 edges to [[_COMMUNITY_journalserver.ts]]
- 3 edges to [[_COMMUNITY_react]]
- 2 edges to [[_COMMUNITY_rh-oauth.ts]]
- 1 edge to [[_COMMUNITY_options-desk.ts]]
- 1 edge to [[_COMMUNITY_use-entry-state.ts]]
- 1 edge to [[_COMMUNITY_verify-audit.mjs]]

## Top bridge nodes
- [[raiseDeskAlerts()]] - degree 7, connects to 4 communities
- [[claimAlert()]] - degree 6, connects to 3 communities
- [[send-server.ts]] - degree 26, connects to 2 communities
- [[push-server.ts]] - degree 24, connects to 2 communities
- [[sendAlert()]] - degree 24, connects to 2 communities