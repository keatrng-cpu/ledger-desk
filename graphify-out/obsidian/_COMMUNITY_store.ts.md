---
type: community
cohesion: 0.08
members: 72
---

# store.ts

**Cohesion:** 0.08 - loosely connected
**Members:** 72 nodes

## Members
- [[Activity()]] - code - src/components/invest/book-card.tsx
- [[BookCard()]] - code - src/components/invest/book-card.tsx
- [[BuyEntry]] - code - src/lib/invest/ledger.ts
- [[BuyForm()]] - code - src/components/invest/book-card.tsx
- [[BuySource]] - code - src/lib/invest/ledger.ts
- [[DividendEntry]] - code - src/lib/invest/ledger.ts
- [[DividendForm()]] - code - src/components/invest/book-card.tsx
- [[EntryBase]] - code - src/lib/invest/ledger.ts
- [[InvestEntry]] - code - src/lib/invest/ledger.ts
- [[InvestExport]] - code - src/lib/invest/store.ts
- [[LedgerPull]] - code - src/lib/invest/ledger-server.ts
- [[Note()]] - code - src/components/invest/ui.tsx
- [[Relief]] - code - src/lib/invest/ledger.ts
- [[SaleRead]] - code - src/lib/invest/ledger.ts
- [[SellEntry]] - code - src/lib/invest/ledger.ts
- [[SellForm()]] - code - src/components/invest/book-card.tsx
- [[SweepEntry]] - code - src/lib/invest/ledger.ts
- [[SweepVerdict]] - code - src/lib/invest/policy.ts
- [[Tab_1]] - code - src/components/invest/book-card.tsx
- [[TaxYearRead]] - code - src/lib/invest/ledger.ts
- [[VoidEntry]] - code - src/lib/invest/ledger.ts
- [[WASH_WINDOW_DAYS]] - code - src/lib/invest/ledger.ts
- [[WashFlag]] - code - src/lib/invest/ledger.ts
- [[WriteResult]] - code - src/lib/invest/store.ts
- [[addDays()_5]] - code - src/lib/invest/ledger.ts
- [[addShares()]] - code - src/lib/invest/store.ts
- [[anniversary()]] - code - src/lib/invest/ledger.ts
- [[append()]] - code - src/lib/invest/store.ts
- [[appendInvestLedger]] - code - src/lib/invest/ledger-server.ts
- [[book-card.tsx]] - code - src/components/invest/book-card.tsx
- [[buyWashWarning()]] - code - src/lib/invest/ledger.ts
- [[closedMonths()]] - code - src/lib/invest/store.ts
- [[emit()_1]] - code - src/lib/invest/store.ts
- [[etToday()]] - code - src/lib/invest/store.ts
- [[heldPositions()]] - code - src/lib/invest/ledger.ts
- [[importLedger()]] - code - src/lib/invest/store.ts
- [[isDate()]] - code - src/lib/invest/ledger.ts
- [[isEntry()]] - code - src/lib/invest/store.ts
- [[isLongTerm()]] - code - src/lib/invest/ledger.ts
- [[ledger.ts]] - code - src/lib/invest/ledger.ts
- [[listInvestLedger]] - code - src/lib/invest/ledger-server.ts
- [[loadEntries()]] - code - src/lib/invest/store.ts
- [[loadLedger()]] - code - src/lib/invest/store.ts
- [[loadPositions()]] - code - src/lib/invest/store.ts
- [[loadSweeps()]] - code - src/lib/invest/store.ts
- [[longTermFrom()]] - code - src/lib/invest/ledger.ts
- [[mergeEntries()]] - code - src/lib/invest/store.ts
- [[migrateV1()]] - code - src/lib/invest/store.ts
- [[newId()]] - code - src/lib/invest/store.ts
- [[num()_14]] - code - src/lib/invest/store.ts
- [[order()]] - code - src/lib/invest/ledger.ts
- [[previewSale()]] - code - src/lib/invest/ledger.ts
- [[readRaw()]] - code - src/lib/invest/store.ts
- [[recordBuy()]] - code - src/lib/invest/store.ts
- [[recordDividend()]] - code - src/lib/invest/store.ts
- [[recordSell()]] - code - src/lib/invest/store.ts
- [[replaceEntries()]] - code - src/lib/invest/store.ts
- [[replay()]] - code - src/lib/invest/ledger.ts
- [[round2()_10]] - code - src/lib/invest/ledger.ts
- [[run()_4]] - code - src/lib/invest/sync.ts
- [[same()_1]] - code - src/lib/invest/sync.ts
- [[signed()_3]] - code - src/components/invest/format.ts
- [[store.ts]] - code - src/lib/invest/store.ts
- [[sync.ts]] - code - src/lib/invest/sync.ts
- [[syncInvestLedger()]] - code - src/lib/invest/sync.ts
- [[taxYear()]] - code - src/lib/invest/ledger.ts
- [[totalSwept()]] - code - src/lib/invest/store.ts
- [[usd()_4]] - code - src/components/invest/format.ts
- [[voidEntry()]] - code - src/lib/invest/store.ts
- [[washFamily()]] - code - src/lib/invest/universe.ts
- [[washFor()]] - code - src/lib/invest/ledger.ts
- [[writeEntries()]] - code - src/lib/invest/store.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/storets
SORT file.name ASC
```

## Connections to other communities
- 35 edges to [[_COMMUNITY_invest-panel.tsx]]
- 31 edges to [[_COMMUNITY_policy.ts]]
- 22 edges to [[_COMMUNITY_book.ts]]
- 15 edges to [[_COMMUNITY_universe.ts]]
- 15 edges to [[_COMMUNITY_invest-firm.ts]]
- 8 edges to [[_COMMUNITY_@tanstackreact-start]]
- 6 edges to [[_COMMUNITY_invest-office.ts]]
- 3 edges to [[_COMMUNITY_news-tab.tsx]]
- 2 edges to [[_COMMUNITY_getSql]]
- 2 edges to [[_COMMUNITY_live-world.ts]]
- 2 edges to [[_COMMUNITY_verify-invest-book.mjs]]
- 2 edges to [[_COMMUNITY_react]]
- 1 edge to [[_COMMUNITY_verify-invest-office.mjs]]

## Top bridge nodes
- [[store.ts]] - degree 60, connects to 9 communities
- [[ledger.ts]] - degree 46, connects to 9 communities
- [[book-card.tsx]] - degree 49, connects to 7 communities
- [[etToday()]] - degree 19, connects to 5 communities
- [[Note()]] - degree 23, connects to 4 communities