---
type: community
cohesion: 0.19
members: 18
---

# alerts/server.ts

**Cohesion:** 0.19 - loosely connected
**Members:** 18 nodes

## Members
- [[AlertStatus]] - code - src/lib/alerts/server.ts
- [[EnableResult]] - code - src/lib/alerts/client.ts
- [[SERVICE_WORKER_URL]] - code - src/lib/alerts/client.ts
- [[alertsclient.ts]] - code - src/lib/alerts/client.ts
- [[alertsserver.ts]] - code - src/lib/alerts/server.ts
- [[countSubscriptions()]] - code - src/lib/alerts/store-server.ts
- [[deleteSubscription()]] - code - src/lib/alerts/store-server.ts
- [[enablePushAlerts()]] - code - src/lib/alerts/client.ts
- [[getAlertStatus]] - code - src/lib/alerts/server.ts
- [[keyToBase64Url()]] - code - src/lib/alerts/client.ts
- [[listAlerts()]] - code - src/lib/alerts/store-server.ts
- [[listRecentAlerts]] - code - src/lib/alerts/server.ts
- [[registration()]] - code - src/lib/alerts/client.ts
- [[saveSubscription()]] - code - src/lib/alerts/store-server.ts
- [[subscribeToAlerts]] - code - src/lib/alerts/server.ts
- [[subscriptionSchema]] - code - src/lib/alerts/server.ts
- [[unsubscribeFromAlerts]] - code - src/lib/alerts/server.ts
- [[urlBase64ToUint8Array()]] - code - src/lib/alerts/client.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/alerts/serverts
SORT file.name ASC
```

## Connections to other communities
- 12 edges to [[_COMMUNITY_react]]
- 10 edges to [[_COMMUNITY_send-server.ts]]
- 4 edges to [[_COMMUNITY_getSql]]
- 4 edges to [[_COMMUNITY_@tanstackreact-start]]

## Top bridge nodes
- [[alertsserver.ts]] - degree 21, connects to 3 communities
- [[getAlertStatus]] - degree 7, connects to 2 communities
- [[countSubscriptions()]] - degree 4, connects to 2 communities
- [[deleteSubscription()]] - degree 4, connects to 2 communities
- [[listAlerts()]] - degree 4, connects to 2 communities