# Graph Report - ledger-desk  (2026-10-07)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 8943 nodes · 22738 edges · 267 communities (249 shown, 18 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 147 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `295bd7f1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 192
- Community 193
- Community 194
- Community 195
- Community 196
- Community 197
- Community 198
- Community 199
- Community 200
- Community 201
- Community 202
- Community 203
- Community 204
- Community 205
- Community 206
- Community 207
- Community 208
- Community 209
- Community 210
- Community 211
- Community 212
- Community 213
- Community 214
- Community 215
- Community 216
- Community 217
- Community 218
- Community 219
- Community 220
- Community 221
- Community 222
- Community 223
- Community 224
- Community 225
- Community 226
- Community 227
- Community 228
- Community 229
- Community 230
- Community 231
- Community 232
- Community 233
- Community 234
- Community 235
- Community 236
- Community 237
- Community 238
- Community 239
- Community 240
- Community 241
- Community 242
- Community 243
- Community 244
- Community 245
- Community 246
- Community 247
- Community 248
- Community 249
- Community 250
- Community 251
- Community 252
- Community 253
- Community 254
- Community 255
- Community 258
- Community 259
- Community 261
- Community 262
- Community 263
- Community 264

## God Nodes (most connected - your core abstractions)
1. `cn()` - 143 edges
2. `MasterplacePage()` - 124 edges
3. `FloorScene` - 98 edges
4. `etWallParts` - 97 edges
5. `react` - 90 edges
6. `getSql()` - 89 edges
7. `Character` - 74 edges
8. `DeskPayload` - 68 edges
9. `line()` - 65 edges
10. `compact()` - 65 edges

## Surprising Connections (you probably didn't know these)
- `order()` --indirect_call--> `compareForBoard()`  [INFERRED]
  scripts/verify-board-rank.mjs → src/lib/trading/scanner.ts
- `malesOnly` --calls--> `voiceGender()`  [EXTRACTED]
  scripts/verify-floor-voice.mjs → src/lib/room/floor-voice.ts
- `at()` --calls--> `etWallToUtc()`  [EXTRACTED]
  scripts/verify-paper-step.mjs → src/lib/journal/risk.ts
- `grokPwaMiddleware()` --calls--> `appNameFromHost()`  [EXTRACTED]
  server/middleware/grok-pwa.ts → scripts/grok-pwa-shared.mjs
- `grokPwaMiddleware()` --calls--> `isInstallQuery()`  [EXTRACTED]
  server/middleware/grok-pwa.ts → scripts/grok-pwa-shared.mjs

## Import Cycles
- 3-file cycle: `src/lib/predict/predict-server.ts -> src/lib/predict/signal-engine.ts -> src/lib/predict/prediction-market-feed.ts -> src/lib/predict/predict-server.ts`

## Communities (267 total, 18 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (105): CycleArgs, FloorScreens, resolveMemories(), buildLadder(), LADDER_MAX_STEPS, LadderCard, LadderInput, ladderSteps() (+97 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (95): RH_EVENT_CONFIDENCE_LIFT, withBudget(), hasDatabentoKey(), budgetedLeg(), BudgetLeg, DESK_BUDGET_MS, DESK_COLD_CAP_MS, DeskBudgetRead (+87 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (91): BTN, c(), CARD, cents(), GameCard(), H3, INPUT, JournalCard() (+83 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (94): funded, shelf, PeopleCards(), lastScored(), rankTitle(), recordLine(), relationWord(), contractName() (+86 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (94): applyVoids(), calendarFor(), cycleWire(), refreshRace(), runLiveCycle(), storyMoved(), loadPulse(), Agenda (+86 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (81): ExposureCard(), techOf(), pct(), Judged, ResearchCard(), Col, COLS, ScreenTable() (+73 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (88): CaseHeader(), Decide(), DrillChart(), ET_DAY, f2(), Framing(), hhmm(), History() (+80 more)

### Community 7 - "Community 7"
Cohesion: 0.04
Nodes (81): BoardGame, buildBoard(), CODE_FIX, dateFromTicker(), disagreement(), EspnGame, EspnTeam, etDate() (+73 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (73): lucide-react, pendingFillToast(), LiquidityPanel(), LiveSaysPanel(), LiveSessionCard(), SnapshotReview(), TfLadderPanel(), TradeLogPanel() (+65 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (80): BookCard(), classTone(), confTone(), MarketNarrativePanel(), LimitBar(), money(), RiskPanel(), SmcPlaybook() (+72 more)

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (77): LAYOUT, TalkBatch, Meeting, Memory, Lens, RaceRunner, allFloorSchoolSeatBundles(), allFloorSchoolSeats() (+69 more)

### Community 11 - "Community 11"
Cohesion: 0.03
Nodes (60): pg, playwright, computeBrandWarnings(), MAX_CARD_BYTES, checkedOutputPath(), checkedUrl(), fail(), LOOPBACK_HOSTNAMES (+52 more)

### Community 12 - "Community 12"
Cohesion: 0.05
Nodes (83): IDLE, MeadFeedOptions, meadStateFrom(), createPredictionMarketFeed(), defaultAllowMock(), FeedStatus, gradeFor(), gradeFromGates() (+75 more)

### Community 13 - "Community 13"
Cohesion: 0.08
Nodes (85): jobsFor(), agoText(), BOARD, clip(), compact(), EvidenceData, exAtEntry(), exBoard() (+77 more)

### Community 14 - "Community 14"
Cohesion: 0.07
Nodes (70): react, recharts, ago(), BridgeStatus(), DOT, Health, LABEL, AplusOps() (+62 more)

### Community 15 - "Community 15"
Cohesion: 0.06
Nodes (73): verifyManagerLiveLoop(), noteRh(), accountPlaceGate(), managerAccountLine(), maskAccount(), num(), RH_AGENTIC_DESK_READ, RH_DESK_ACCOUNT_SNAPSHOT (+65 more)

### Community 16 - "Community 16"
Cohesion: 0.04
Nodes (55): createSignalHallFeed(), crowdLabel(), EMPTY_FEED, HallFeedState, hallStateFromBoard(), hallViewFor(), IDLE_HALL, nextHallState() (+47 more)

### Community 17 - "Community 17"
Cohesion: 0.04
Nodes (45): drawEmote(), EmoteKind, ambientFor(), Anchor, angleLerp(), AnimKey, Avatar, BALCONY (+37 more)

### Community 18 - "Community 18"
Cohesion: 0.05
Nodes (70): LedgerScreen, RaceScreen, eventText(), GoalForm(), money(), OWNER_COLOR, pctSmall(), RacePanel() (+62 more)

### Community 19 - "Community 19"
Cohesion: 0.05
Nodes (66): RFC-8188, RFC-8291, disablePushAlerts(), enablePushAlerts(), EnableResult, keyToBase64Url(), registration(), SERVICE_WORKER_URL (+58 more)

### Community 20 - "Community 20"
Cohesion: 0.03
Nodes (49): history, stride, dayChangePct(), dayKey(), history, rows, top, dayChangePct() (+41 more)

### Community 21 - "Community 21"
Cohesion: 0.07
Nodes (68): hhmm(), recordEvents(), remember(), seenLately(), BrainFuel, fuelBrains(), savePeople(), SLOTS (+60 more)

### Community 22 - "Community 22"
Cohesion: 0.03
Nodes (62): argsQ, atr8, bad, badEv, blind, boardTable, calNeg, cals (+54 more)

### Community 23 - "Community 23"
Cohesion: 0.05
Nodes (64): DisciplinePanel(), money(), SplitCell(), CloseTradeRow(), JournalPanel(), MetricTile(), money(), PnlText() (+56 more)

### Community 24 - "Community 24"
Cohesion: 0.06
Nodes (51): canvasTex(), Ctx, cupTag(), drawBanner(), drawKillzoneClock(), drawManagerBook(), drawManagerCall(), drawScars() (+43 more)

### Community 25 - "Community 25"
Cohesion: 0.10
Nodes (67): BAND_COLOR, C, clear(), CREW_COLOR, CREW_ORDER, Ctx, cuesOfFrame(), drawAnnexMonitor() (+59 more)

### Community 26 - "Community 26"
Cohesion: 0.05
Nodes (52): layers, plan, fails, T0, IncomeGauge(), pct(), ProfitPathPanel(), Tile() (+44 more)

### Community 27 - "Community 27"
Cohesion: 0.05
Nodes (55): lightweight-charts, fails, barTimeSec(), C, CandleHover, CandlestickPane(), paintOverlay(), CandlestickPaneProps (+47 more)

### Community 28 - "Community 28"
Cohesion: 0.07
Nodes (4): fallbackPiece(), FloorScene, screenLabel(), seeThrough()

### Community 29 - "Community 29"
Cohesion: 0.06
Nodes (60): raceScreenOf(), aggregateBars(), boardRankOf(), deliveryLine(), deliveryOfLadder(), FocusCard, FocusPick, pickFocus() (+52 more)

### Community 30 - "Community 30"
Cohesion: 0.03
Nodes (54): again, allVti, aug, big, cap, chart, check(), clean (+46 more)

### Community 31 - "Community 31"
Cohesion: 0.11
Nodes (52): @tanstack/react-router, authorizeCronRequest(), CronAuthResult, CronRunResult, cronSecret(), cronUserId(), envValue(), etWindow (+44 more)

### Community 32 - "Community 32"
Cohesion: 0.03
Nodes (60): name, overrides, nf3, private, sideEffects, type, class-variance-authority, clsx (+52 more)

### Community 33 - "Community 33"
Cohesion: 0.07
Nodes (51): countdown(), NewsChip(), RhAccountStrip(), usd(), devPreview(), ENTRY_FLASH, FLASH, FlashKind (+43 more)

### Community 34 - "Community 34"
Cohesion: 0.09
Nodes (59): Activity(), BookCard(), BuyForm(), DividendForm(), SellForm(), Tab, signed(), usd() (+51 more)

### Community 35 - "Community 35"
Cohesion: 0.06
Nodes (60): ACCUM_LOOKBACK_BARS, ACCUM_MAX_BAR_RANGE_ATR, ACCUM_MAX_RANGE_ATR, ACCUM_MIN_BARS, AccumulationRead, ATR_PERIOD, body(), detectAccumulation() (+52 more)

### Community 36 - "Community 36"
Cohesion: 0.03
Nodes (54): agree, board, cb, cheap, check(), dog, dv, e (+46 more)

### Community 37 - "Community 37"
Cohesion: 0.07
Nodes (11): MeadFeed, canvasTex(), damp(), mat(), MeadScene, Person, woodCanvas(), drawKnotPanel() (+3 more)

### Community 38 - "Community 38"
Cohesion: 0.05
Nodes (50): ManagerRhAccount, RhConnectorAccountRow, RhConnectorPortfolio, ManagerRoomStateAgree, ArmSnap, baseSnaps(), buildState(), CallAction (+42 more)

### Community 39 - "Community 39"
Cohesion: 0.06
Nodes (53): SetupMiniChart, BlockerStrip(), CANON_SORT_BONUS, CanonBadge(), CardPools, CardSequence, CardSession, CardTape (+45 more)

### Community 40 - "Community 40"
Cohesion: 0.06
Nodes (54): assessConditions(), atr(), DEFAULT_ATR_N, DEFAULT_BASELINE_ATR_N, DEFAULT_ER_N, DEFAULT_ER_TREND, DEFAULT_MAX_ATR_RATIO, DEFAULT_MIN_ATR_RATIO (+46 more)

### Community 41 - "Community 41"
Cohesion: 0.08
Nodes (53): ENTRY_STYLE, createMeadFeed(), devBuild(), MeadHallTab(), PaperTicket(), REACT_COLOR, TicketDraft, useMeadFeed() (+45 more)

### Community 42 - "Community 42"
Cohesion: 0.06
Nodes (53): Ctx, drawRaceBoard(), drawScrubberBoard(), fit(), wrap(), cardTile(), contractOf(), feedSourceTag() (+45 more)

### Community 43 - "Community 43"
Cohesion: 0.07
Nodes (51): autofireEnabled(), autofireInput, AutofireResult, boolEnv(), refuse(), tryApexAutofire, APEX_AUTOMATION_CONFIRMED_IN_WRITING, APEX_AUTOMATION_PROHIBITED_REASON (+43 more)

### Community 44 - "Community 44"
Cohesion: 0.09
Nodes (52): PaperBookPanel(), DebriefBody(), pct(), tone(), TradeDebriefPanel(), syncPaperBookToDb(), unmirroredCount(), GhostTrade (+44 more)

### Community 45 - "Community 45"
Cohesion: 0.05
Nodes (48): BARS, byDay, cache, calib, calibration(), cards, causalDaily(), cvLambda() (+40 more)

### Community 46 - "Community 46"
Cohesion: 0.07
Nodes (53): BacktestLayers, formatSkipAsProcessWin(), promotePrimaryStrategy(), analysis, assertCausal(), bestDays, causalAggregate(), causalClosedBars() (+45 more)

### Community 47 - "Community 47"
Cohesion: 0.04
Nodes (53): dependencies, better-auth, class-variance-authority, clsx, cmdk, date-fns, @electric-sql/pglite, @hookform/resolvers (+45 more)

### Community 48 - "Community 48"
Cohesion: 0.09
Nodes (46): CopyClaudeHandoff(), PathAlarmBar(), buildCoachNotes(), TradingCoach(), VoiceCard(), alarmKey(), armPathAlarm(), bookRungs() (+38 more)

### Community 49 - "Community 49"
Cohesion: 0.08
Nodes (48): invThemeNow(), isWeekdayAt(), InvestOfficePanel(), KV(), money(), money2(), OtherIncome(), SectionId (+40 more)

### Community 50 - "Community 50"
Cohesion: 0.07
Nodes (50): Rung, arrivalPmf(), bisect(), Cell, Collision, collisions(), contractsFor(), dateOf() (+42 more)

### Community 51 - "Community 51"
Cohesion: 0.07
Nodes (48): saveSoundPref(), frameIsEvent(), WireStatus, Bar(), BEAT_WORD, beatWord(), CAMERAS, COLOR (+40 more)

### Community 52 - "Community 52"
Cohesion: 0.08
Nodes (45): blackScholes(), BsRead, cents(), decayToStop(), HALF_SPREAD, isoPlusDays(), isWeekendDate(), normCdf() (+37 more)

### Community 53 - "Community 53"
Cohesion: 0.05
Nodes (46): argOf(), argv, BARS, capturedAt, cases, chosen, counts, dayPct() (+38 more)

### Community 54 - "Community 54"
Cohesion: 0.06
Nodes (41): CreatedWithGrokBanner(), fetchRemixEligible(), readEnv(), remixEligibilityUrl(), RemixIcon(), AuthProvider(), AppErrorComponent(), getRouter() (+33 more)

### Community 55 - "Community 55"
Cohesion: 0.06
Nodes (37): ALL_YEARS, anyhour, argv, atrAt(), atrCache, BARS, BASE, chosen (+29 more)

### Community 56 - "Community 56"
Cohesion: 0.08
Nodes (43): book(), desk(), isHighProbPath(), isPathFire(), Snapshot, DeskPayload, reachTier, MarketNarrative (+35 more)

### Community 57 - "Community 57"
Cohesion: 0.07
Nodes (46): emptyCounters(), ledgerOfCounters(), rollCountersOf(), RoomCounters, htfAligned(), entriesOpen(), policyOf(), EntryEval (+38 more)

### Community 58 - "Community 58"
Cohesion: 0.08
Nodes (45): BUCKET_EDGES, CalibrationBucket, dayChangePct(), FLOOR_CANDIDATES, FloorRow, NumericPlan, recentExtreme(), ReplayOptions (+37 more)

### Community 59 - "Community 59"
Cohesion: 0.07
Nodes (46): ApexSimPanel(), CAP_OPTIONS, ConfidenceTag(), DEFAULT_ROOM, diffTone(), Field(), FigureCell(), inputKey() (+38 more)

### Community 60 - "Community 60"
Cohesion: 0.07
Nodes (42): RiskGrade, readBookCounters(), AUTO_PAPER_EVENT, AUTO_PAPER_STORAGE, autoPaperKey(), AutoPaperPick, autoPaperShouldTake(), AutoPaperState (+34 more)

### Community 61 - "Community 61"
Cohesion: 0.04
Nodes (30): baseTrade, chain, dateTyped, deleted, deletedVerdict, doctored, doctoredVerdict, extraField (+22 more)

### Community 62 - "Community 62"
Cohesion: 0.04
Nodes (46): scripts, build, build:dev, capture:intrabar, capture:invest, db:migrate, dev, format (+38 more)

### Community 63 - "Community 63"
Cohesion: 0.08
Nodes (42): board, fixture, binIndex(), CalibrationBucket, calibrationBuckets(), core(), fitRecalibration(), gate() (+34 more)

### Community 64 - "Community 64"
Cohesion: 0.09
Nodes (31): aligned(), assert_figure(), atr(), bear_structure_before(), et(), fig(), find_against(), find_breakout() (+23 more)

### Community 65 - "Community 65"
Cohesion: 0.06
Nodes (38): @tanstack/react-start, assertSameSiteRequest(), CrossSiteRequestError, authMiddleware, authConfigured, databaseConfigured, DEV_USER_ID, getSessionUser() (+30 more)

### Community 66 - "Community 66"
Cohesion: 0.05
Nodes (43): aArr, aDsp, all, armedShort, arrPrinted, aSweep, awaitedAll, bare (+35 more)

### Community 67 - "Community 67"
Cohesion: 0.09
Nodes (36): DrillCall(), commit(), WhyBox(), LearnTab(), liveFacts(), LiveStrip(), ModuleView(), readDone() (+28 more)

### Community 68 - "Community 68"
Cohesion: 0.05
Nodes (41): badModel, base, board, candles, cheap, cheapM, check(), closed (+33 more)

### Community 69 - "Community 69"
Cohesion: 0.10
Nodes (36): Countdown(), EntryHero(), Plain(), PlainToggle(), usePlainEnglish(), usePlainify(), BookCol(), bookForSymbol() (+28 more)

### Community 70 - "Community 70"
Cohesion: 0.06
Nodes (30): args, CACHE, facts, file, ICON, key(), ONLY, pageText() (+22 more)

### Community 71 - "Community 71"
Cohesion: 0.05
Nodes (29): argv, bars, counts, done, fetchMonth(), fetchMonthOnce(), INTERVAL_MIN, iso() (+21 more)

### Community 72 - "Community 72"
Cohesion: 0.08
Nodes (38): ELAPSED, hist, R_MULTIPLES, symbols, atrOf(), biasAlignment(), candidateLevels(), drawOnLiquidity() (+30 more)

### Community 73 - "Community 73"
Cohesion: 0.14
Nodes (42): confidenceFloorFor(), contractsAfterEvent(), etfFromFuture(), afterSecondImpulse(), brakeIsClock(), componentsHint(), contractsWithinRisk(), crossedSpot() (+34 more)

### Community 74 - "Community 74"
Cohesion: 0.08
Nodes (13): front_quarterly(), globex_open(), in_ny_am_window(), LiveGateway, load_env_local(), main(), MinuteAgg, rec_px() (+5 more)

### Community 75 - "Community 75"
Cohesion: 0.07
Nodes (38): again, cast, deskVoices, installed, jax, malesOnly, raid, said (+30 more)

### Community 76 - "Community 76"
Cohesion: 0.07
Nodes (38): ContractKey, accountCloseDay(), accountOpenDay(), accountTrade(), APEX_EVAL_DAYS, ApexContractSizing, ApexMechanic, ApexSimArmStats (+30 more)

### Community 77 - "Community 77"
Cohesion: 0.07
Nodes (37): buildOrderIntent(), buildTargets(), contractKeys, finite(), ORDER_INTENT_VERSION, OrderContext, OrderEntryType, OrderIntent (+29 more)

### Community 78 - "Community 78"
Cohesion: 0.08
Nodes (17): tsx, brainPanel, brainSrc, CLEAN, HALTED, index, synapse, ASIA (+9 more)

### Community 79 - "Community 79"
Cohesion: 0.09
Nodes (31): better-auth, AccountChip(), StorageBanner(), authClient, authEnabled, getBearerToken(), inLivePreview(), openSignInPopup() (+23 more)

### Community 80 - "Community 80"
Cohesion: 0.11
Nodes (35): host(), KillWatchPanel(), go(), emit(), judgeKill(), KILL_STORE_EVENT, KillJudgement, latestJudgement() (+27 more)

### Community 81 - "Community 81"
Cohesion: 0.08
Nodes (39): Activity, ACTIVITY_SPOTS, AgentPlan, baseRel(), chooseFree(), clamp01(), clampRel(), CREW (+31 more)

### Community 82 - "Community 82"
Cohesion: 0.10
Nodes (34): plan, EntryTriggerPanel(), PATH_BANDS, TIER_STYLE, QUOTE_EXECUTION_MAX_LAG_SEC, MANAGEMENT_EVIDENCE, EntryRead, EntryTier (+26 more)

### Community 83 - "Community 83"
Cohesion: 0.07
Nodes (34): armed, dayFlat, disaster, fh, flat, flatten, held(), level (+26 more)

### Community 84 - "Community 84"
Cohesion: 0.09
Nodes (33): fails, near(), NO_BONUS, ok(), CHANNEL_RANK, DRAWN_AS, DriverChannel, heaviest() (+25 more)

### Community 85 - "Community 85"
Cohesion: 0.07
Nodes (29): fails, ROOT, bars, behind, far, farScale, long, noRaid (+21 more)

### Community 86 - "Community 86"
Cohesion: 0.11
Nodes (34): BUTTON, INPUT, LINK, usd0(), VERDICT_CLS, priorMonth(), SweepCard(), contributionPath() (+26 more)

### Community 87 - "Community 87"
Cohesion: 0.09
Nodes (35): zod, backfillPaperTrades, BackfillPaperTradesInput, backfillSchema, clip(), closePayload(), killzoneFromReason(), listMirroredPaperTrades (+27 more)

### Community 88 - "Community 88"
Cohesion: 0.08
Nodes (34): Bar(), Bundle(), CREW, curve(), FloorBrains(), HUB, liveBetween(), Lobe() (+26 more)

### Community 89 - "Community 89"
Cohesion: 0.09
Nodes (36): Cell(), ExitRing(), hm(), LayerPill(), MesVsOptions(), OvernightBoard(), wordTone(), RhSleeve (+28 more)

### Community 90 - "Community 90"
Cohesion: 0.07
Nodes (28): all, card, dayChangePct(), deskAt(), history, rows, t0, history (+20 more)

### Community 91 - "Community 91"
Cohesion: 0.06
Nodes (32): BARS, CURVES, curvesAllSession, diff(), DTES, ETF, exits, H (+24 more)

### Community 92 - "Community 92"
Cohesion: 0.07
Nodes (29): T0, HiAlertPanel(), row(), when(), Delivery, barsAfter(), Call, deliveryOf() (+21 more)

### Community 93 - "Community 93"
Cohesion: 0.14
Nodes (33): arr(), biasCls(), BiasSection(), Block(), CandidateCard(), Chip(), DrawsSection(), DrawTarget() (+25 more)

### Community 94 - "Community 94"
Cohesion: 0.09
Nodes (31): ClosedTrade, computeMetrics(), equityCurve(), maxDrawdown(), Metrics, sharpe(), WEAK_SAMPLE_THRESHOLD, BacktestPayload (+23 more)

### Community 95 - "Community 95"
Cohesion: 0.10
Nodes (32): authorizeBridgeRequest(), BridgeAuthResult, bridgeToken(), bridgeUserId(), DEFAULT_BRIDGE_USER_ID, envValue(), secureEquals(), ENGINE_SOURCE (+24 more)

### Community 96 - "Community 96"
Cohesion: 0.09
Nodes (35): speakable(), ASIDE_WORDS, CAPS_WORDS, chunkSpoken(), CODE_WORD, codeNames(), DIGEST_ABOVE_WORDS, digestOf() (+27 more)

### Community 97 - "Community 97"
Cohesion: 0.11
Nodes (33): RFC-3161, RFC-8785, ATTEST_EVENTS, AttestationRow, ATTESTED_FIELDS, attestedBody(), AttestedField, AttestEvent (+25 more)

### Community 98 - "Community 98"
Cohesion: 0.11
Nodes (34): bars, days, endMs, HIST, mb, out, startMs, aggregateBars() (+26 more)

### Community 99 - "Community 99"
Cohesion: 0.11
Nodes (30): esShort, byKey(), EvidenceTiles(), MiniBar(), Row, signedR(), EvidenceTable(), r() (+22 more)

### Community 100 - "Community 100"
Cohesion: 0.13
Nodes (33): InvestPanel(), readMarksCache(), writeMarksCache(), HabitCard(), LimitsCard(), BENCHMARK, BOOK_MEANINGFUL_USD, buildBook() (+25 more)

### Community 101 - "Community 101"
Cohesion: 0.10
Nodes (34): Book(), Rungs(), TIERS, tone(), submit(), buildTfLadder(), byTier(), CalTf (+26 more)

### Community 102 - "Community 102"
Cohesion: 0.07
Nodes (31): BiasRead, BRIEF_AS_OF, BRIEF_SOURCE, BriefFacet, CheckState, Def, DEFS, Dir (+23 more)

### Community 103 - "Community 103"
Cohesion: 0.12
Nodes (35): investLooks(), allowed(), bookCands(), calendarCands(), cardIn(), clone(), etfUsd(), feedCands() (+27 more)

### Community 104 - "Community 104"
Cohesion: 0.10
Nodes (32): bookScreen(), etClockLabel(), frameFromCycle(), ledgerScreenOf(), Argument, challengeFor(), clamp(), consensus() (+24 more)

### Community 105 - "Community 105"
Cohesion: 0.08
Nodes (24): emailAndPasswordEnabled, emailAndPasswordOptions, signUpOpen, completionHtml(), completionResponse(), handleAuthPopupRequest(), PopupMessage, readCookie() (+16 more)

### Community 106 - "Community 106"
Cohesion: 0.11
Nodes (34): best(), Bucket, bucketOf(), buildAnalytics(), buildEquityCurve(), buildReadout(), buildRegimeMatrix(), byPrescore() (+26 more)

### Community 107 - "Community 107"
Cohesion: 0.06
Nodes (33): allRestore, balanced, baseIn, bigBook, blankCeo, blankKill, blankMoat, cc (+25 more)

### Community 108 - "Community 108"
Cohesion: 0.12
Nodes (25): RULES, TRADE, money(), PropFirmPanel(), RoomBar(), Stat(), DailyResult, derivePropAccount() (+17 more)

### Community 109 - "Community 109"
Cohesion: 0.10
Nodes (30): addDays(), ago(), EventRow(), Filter, IMPACT, isSports(), NewsTab(), sessionsAhead() (+22 more)

### Community 110 - "Community 110"
Cohesion: 0.11
Nodes (10): json(), num(), PgExecStore, rowOf(), ExecState, execStep(), ExecStore, RunCtx (+2 more)

### Community 111 - "Community 111"
Cohesion: 0.09
Nodes (33): add(), Bucket, CI_ALPHA, emptyBucket(), ENTRY_EVIDENCE, entryEvidenceLine(), FeatureLift, featureLifts() (+25 more)

### Community 112 - "Community 112"
Cohesion: 0.13
Nodes (29): box(), bust(), f_bar_stool(), f_bar_table(), f_bench(), f_bookshelf(), f_couch(), f_counter() (+21 more)

### Community 113 - "Community 113"
Cohesion: 0.11
Nodes (12): FloorEvent, BED_LAYERS, BedLayer, BedState, englishVoices(), FloorSound, loadBedMutes(), loadCast() (+4 more)

### Community 114 - "Community 114"
Cohesion: 0.10
Nodes (29): COMPONENT_WEIGHTS, ComponentWeight, CONFLUENCE_KNOWLEDGE, ConfluenceKnowledge, STRATEGY_CATALOG, COMPONENT_KEYS, ComponentKey, RAW_WEIGHTS (+21 more)

### Community 115 - "Community 115"
Cohesion: 0.10
Nodes (30): buildCases(), BuildOptions, buildSteps(), CaseStep, CaseSymbol, chasePlan(), classifyLoss(), dayChangePct() (+22 more)

### Community 116 - "Community 116"
Cohesion: 0.09
Nodes (29): clip(), decodeEntities(), ENTITIES, FeedItem, FEEDS, FeedSource, Horizon, KILL_WORDS (+21 more)

### Community 117 - "Community 117"
Cohesion: 0.08
Nodes (23): BARS, bucket(), claim(), claims, clustered(), clusteredDiff(), H, IDX (+15 more)

### Community 118 - "Community 118"
Cohesion: 0.08
Nodes (25): all, broke, clean, conceptModules, drifted, empties, moduleIds, mustAppear (+17 more)

### Community 119 - "Community 119"
Cohesion: 0.09
Nodes (24): verifyManagerAccount(), verifyManagerAgree(), ARMED_FLAGS, FUNDED, KEATON_LIVE, MANAGER_OK, NOW, QUALIFIED (+16 more)

### Community 120 - "Community 120"
Cohesion: 0.11
Nodes (21): build_portraits(), composite_png(), desk_under(), f_desk(), f_keyboard(), f_neon_frame(), f_server_rack(), hexrgb() (+13 more)

### Community 121 - "Community 121"
Cohesion: 0.07
Nodes (25): { attribution, lesson }, contracts, doc, entryFill, exitFill, exitReason, expectation, f (+17 more)

### Community 122 - "Community 122"
Cohesion: 0.17
Nodes (27): BridgeHooks, deviceId(), execAfterCycle(), execFlatten(), ExecUi, runStep(), schedulePoll(), useExecStore (+19 more)

### Community 123 - "Community 123"
Cohesion: 0.13
Nodes (29): anthropicKey(), askDeskCoach, askDeskDiscuss, buildLoopContext(), buildUserMessage(), callClaude(), callClaudeWithSearch(), callGrok() (+21 more)

### Community 124 - "Community 124"
Cohesion: 0.14
Nodes (14): getFigure(), againstScenarios(), BIAS_TAPES, biasScenarios(), conflictScenarios(), fig(), rangeScenarios(), retraceScenarios() (+6 more)

### Community 125 - "Community 125"
Cohesion: 0.17
Nodes (27): MindState, WorldInput, RoomBook, afterPush(), freshPushMemory(), isSnapshot(), MAX_SNAPSHOT_BYTES, mayPush() (+19 more)

### Community 126 - "Community 126"
Cohesion: 0.12
Nodes (24): T0, analyzeShadow(), applyRange(), bucket(), close(), etTime(), MAX_PER_SYMBOL_DAY, openShadows() (+16 more)

### Community 127 - "Community 127"
Cohesion: 0.09
Nodes (23): MetRing(), SCHOOL_ORDER, STEP_FACTORS, stepStates(), BOOK, BrainJobs, CANON_RULES, CanonFactor (+15 more)

### Community 128 - "Community 128"
Cohesion: 0.11
Nodes (26): BookRead, DRIFT_BAND, RebalanceRead, concentrationWarning(), WASH_SALE_BANNED, buildInvest(), CATALYST_WINDOW_DAYS, catalystsFor() (+18 more)

### Community 129 - "Community 129"
Cohesion: 0.14
Nodes (25): fundProfile, dedupe(), orderItems(), tagItem(), buildThesisInput(), parseThesis(), repairJson(), addDays() (+17 more)

### Community 130 - "Community 130"
Cohesion: 0.17
Nodes (28): analyze(), AnalyzeCtx, analyzeExpired(), analyzeMissed(), bookOf(), dayKeyEt(), emit(), GhostAnalysis (+20 more)

### Community 131 - "Community 131"
Cohesion: 0.15
Nodes (22): bias_asof(), bias_series(), closed_candles(), collect(), day_key(), dt(), fvg_15(), gap_events() (+14 more)

### Community 132 - "Community 132"
Cohesion: 0.07
Nodes (23): alias, file, hit, miss, take, wordOnly, LearnModule, MODULE_ORDER (+15 more)

### Community 133 - "Community 133"
Cohesion: 0.07
Nodes (25): bears, check(), cpi, cpiEv, cut, dossiers, dup, fed (+17 more)

### Community 134 - "Community 134"
Cohesion: 0.12
Nodes (25): BookCol(), DayRow(), px(), WeekAheadPanel(), addDays(), barDateKey(), barInWeek(), isEs() (+17 more)

### Community 135 - "Community 135"
Cohesion: 0.20
Nodes (23): INSTALL_PAGE_PATH, renderInstallPage(), requestHost(), sendHtml(), serveGrokPwa(), wrapHtmlResponses(), acceptsHtml(), appNameFromHost() (+15 more)

### Community 136 - "Community 136"
Cohesion: 0.09
Nodes (18): BARS, bucket(), clustered(), dispCache, dispsFor(), H, IS_YEARS, mainDisplacementAt() (+10 more)

### Community 137 - "Community 137"
Cohesion: 0.09
Nodes (19): all, at(), bookOf(), clockAt(), etMinOf(), frameFor(), INV, LAYOUT (+11 more)

### Community 138 - "Community 138"
Cohesion: 0.09
Nodes (26): allDown, allUp, bad, bar(), check(), down(), e, es (+18 more)

### Community 139 - "Community 139"
Cohesion: 0.14
Nodes (24): ChartLegend(), GROUPS, Mark, Swatch(), Cell(), ExpectedPath(), Key(), LayerPill() (+16 more)

### Community 140 - "Community 140"
Cohesion: 0.12
Nodes (25): ANIM, GoalLite, SeatEventLite, SeatRowLite, WeekLite, NEUTRAL, AUDIT_OFFICE, CouncilData (+17 more)

### Community 141 - "Community 141"
Cohesion: 0.11
Nodes (23): BAND, BARS, baseFills, cards, clusteredMean(), gate, H, halves() (+15 more)

### Community 142 - "Community 142"
Cohesion: 0.12
Nodes (18): at(), BASE, clockAt(), CREW5, levelsFor(), lv(), mkBook(), mkMinds() (+10 more)

### Community 143 - "Community 143"
Cohesion: 0.11
Nodes (23): at(), body, db, iCas, iDue, iFeed, iLease, imports (+15 more)

### Community 144 - "Community 144"
Cohesion: 0.09
Nodes (24): a, book, broke, check(), clean3, current, d, dLose (+16 more)

### Community 145 - "Community 145"
Cohesion: 0.13
Nodes (21): short, T0, etTime(), OUTCOME_LABEL, TakeMomentsPanel(), isWatchable(), dayKey(), LedgerSummary (+13 more)

### Community 146 - "Community 146"
Cohesion: 0.15
Nodes (23): LogMode, AnalysisCard(), BiasPill(), ChatMessage, downloadDataUrl(), QUICK, Role, TradezellaChat() (+15 more)

### Community 147 - "Community 147"
Cohesion: 0.17
Nodes (22): DataCard(), Card(), InvestEntry, appendInvestLedger, LedgerPull, LedgerPush, listInvestLedger, emit() (+14 more)

### Community 148 - "Community 148"
Cohesion: 0.13
Nodes (21): buildScale(), LearnFigure(), placeLevelLabels(), Scale, toneColor(), Figure, FigureBar, FigureMark (+13 more)

### Community 149 - "Community 149"
Cohesion: 0.14
Nodes (23): isTerminal(), loadShadowsLocal(), mergeShadows(), observeShadows(), saveShadowsLocal(), listSchema, listShadowTrades, shadowSchema (+15 more)

### Community 150 - "Community 150"
Cohesion: 0.14
Nodes (23): PATCHABLE, Query, checkEntry(), checkExit(), clockOf(), GateCtx, GateResult, hhmm() (+15 more)

### Community 151 - "Community 151"
Cohesion: 0.09
Nodes (23): arr, bars, base, bd, c, card, chart, check() (+15 more)

### Community 152 - "Community 152"
Cohesion: 0.14
Nodes (23): BookCol(), LiqLine(), MonthAheadPanel(), PhaseRow(), px(), addDays(), barDateKey(), barInMonth() (+15 more)

### Community 153 - "Community 153"
Cohesion: 0.15
Nodes (23): OptionsSwingPanel(), QuoteSheet(), SleeveBudgetBar(), StrategyCard(), usd(), verdictClass(), optionsDeskPlaybook(), RhStrategyCard (+15 more)

### Community 154 - "Community 154"
Cohesion: 0.09
Nodes (13): RFC-3339, ALPACA_DATA, ALPACA_TRADING, alpacaBroker(), call(), AlpacaConfig, AlpacaError, brokerFromEnv() (+5 more)

### Community 155 - "Community 155"
Cohesion: 0.12
Nodes (21): MIN_STRATEGY_N, BACKTEST_WEIGHT, BacktestPrior, clamp(), computeDiscretion(), DEMOTE_EFFECTIVE_N, DEMOTE_EXPECTANCY_R, DiscretionVerdict (+13 more)

### Community 156 - "Community 156"
Cohesion: 0.21
Nodes (19): atr_at(), Book, choose_target(), collect(), day_key(), et(), find_flaws(), half() (+11 more)

### Community 157 - "Community 157"
Cohesion: 0.09
Nodes (16): BARS, bucket(), CALENDAR, clustered(), H, HIGH_IMPACT_EPOCHS, inducementAt(), IS_YEARS (+8 more)

### Community 158 - "Community 158"
Cohesion: 0.12
Nodes (18): CardGeometry, firstLevel(), GeometryVerdict, readCardGeometry(), THIN_RR, zoneMid(), DEFAULT_MAX_RISK_PTS, hitStop() (+10 more)

### Community 159 - "Community 159"
Cohesion: 0.11
Nodes (21): bad, early, good, small, stay, two, up, clamp() (+13 more)

### Community 160 - "Community 160"
Cohesion: 0.10
Nodes (18): T0, ALIGN_MAX_GAP_SEC, alignRatio(), CrossBook, crossBoth(), crossProxy(), CrossRead, DEFAULT_RATIO (+10 more)

### Community 161 - "Community 161"
Cohesion: 0.16
Nodes (22): agree(), BIAS_STYLE, calm(), DiscussTab(), Entry, ExchangeCard(), fmtCountdown(), nextCheckpoint() (+14 more)

### Community 162 - "Community 162"
Cohesion: 0.10
Nodes (24): CardRead, LevelRef, PositionRead, TapeBook, BoardData, CalData, DealingData, DrawData (+16 more)

### Community 163 - "Community 163"
Cohesion: 0.13
Nodes (20): fails, m15, minute, autoTf(), AutoTfInput, AutoTfRead, CHART_TFS, DEFAULT_TF (+12 more)

### Community 164 - "Community 164"
Cohesion: 0.09
Nodes (19): agree, agreeing, blind, card, check(), clash, clashing, clock (+11 more)

### Community 165 - "Community 165"
Cohesion: 0.10
Nodes (20): a, agreed, base, fill, gone, late, raid, syn (+12 more)

### Community 166 - "Community 166"
Cohesion: 0.09
Nodes (20): base, changed, check(), d1, daily, down, earlier, et() (+12 more)

### Community 167 - "Community 167"
Cohesion: 0.24
Nodes (22): AnalyticsPanel(), BookCoverage(), BucketTable(), EquitySpark(), expCls(), kzLabel(), MatrixValue(), Mode (+14 more)

### Community 168 - "Community 168"
Cohesion: 0.09
Nodes (22): devDependencies, eslint, eslint-config-prettier, @eslint/js, eslint-plugin-prettier, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals (+14 more)

### Community 169 - "Community 169"
Cohesion: 0.10
Nodes (16): BARS, curves(), DIST, fills, H, headline(), IS_YEARS, median() (+8 more)

### Community 170 - "Community 170"
Cohesion: 0.10
Nodes (15): BARS, bucket(), by(), clustered(), DAYIDX, elapsed, H, IS_YEARS (+7 more)

### Community 171 - "Community 171"
Cohesion: 0.13
Nodes (14): account(), ctx(), db, exitIntent(), has(), intent(), k1, makeSim() (+6 more)

### Community 172 - "Community 172"
Cohesion: 0.13
Nodes (18): OptionsDesk, RhTicket, UnderlierQuote, clampSleeve(), loadRhSleeve(), RH_SLEEVE_EVENT, RH_SLEEVE_STORAGE, rhRiskBudgetUsd() (+10 more)

### Community 173 - "Community 173"
Cohesion: 0.20
Nodes (19): bar(), C, hailBanner(), helm(), here, ironFrame(), jumbotron(), label() (+11 more)

### Community 174 - "Community 174"
Cohesion: 0.20
Nodes (17): fails, near(), ok(), CalibrationPanel(), rOf(), Bucket, CalibrationVerdict, compare() (+9 more)

### Community 175 - "Community 175"
Cohesion: 0.10
Nodes (19): bar(), bars, behind, check(), dead, draw, es, fresh (+11 more)

### Community 176 - "Community 176"
Cohesion: 0.17
Nodes (19): LayerRow, OverrideRecord, overrideScorecard(), OverrideSummary, RefusingLayer, round2(), summarise(), fingerprint() (+11 more)

### Community 177 - "Community 177"
Cohesion: 0.16
Nodes (19): blankRow(), ExecDeps, msg(), rowPatchFromBroker(), StepRequest, checkRun(), clientOrderId(), desiredOf() (+11 more)

### Community 178 - "Community 178"
Cohesion: 0.13
Nodes (20): ALL_FEATURES, b(), clamp(), CONTINUOUS, FEATURE_LABEL, FeatureKey, FIT_RANGE, Geometry (+12 more)

### Community 179 - "Community 179"
Cohesion: 0.18
Nodes (20): monthPhaseFor(), BookSlice, buildPath(), buildSessionBrief(), classifyDay(), DayKind, DayVerdict, etDateKey() (+12 more)

### Community 180 - "Community 180"
Cohesion: 0.16
Nodes (14): B(), build_emissives(), build_extras(), build_furniture(), build_office(), build_rooms(), build_screens(), ensure() (+6 more)

### Community 181 - "Community 181"
Cohesion: 0.12
Nodes (13): barAtOrBefore(), BARS, bucket(), clustered(), cut(), driftAt(), H, IS_YEARS (+5 more)

### Community 182 - "Community 182"
Cohesion: 0.12
Nodes (17): argv, atrAt(), CHUNK, H, HIST, layerIds(), LIMIT, medianVol() (+9 more)

### Community 183 - "Community 183"
Cohesion: 0.11
Nodes (15): BARS, cards, externalT2(), gate, H, halves(), inBand, IS_YEARS (+7 more)

### Community 184 - "Community 184"
Cohesion: 0.18
Nodes (17): IpoCard(), STAGE, addDays(), DOC, ipoCapturedAt(), IpoDoc, ipoEvidence, ipoRead (+9 more)

### Community 185 - "Community 185"
Cohesion: 0.13
Nodes (10): bookOf(), clockAt(), drain(), mkWorld(), MORNING, numbersOf(), SPOKEN, textOf() (+2 more)

### Community 186 - "Community 186"
Cohesion: 0.18
Nodes (18): buildMiniScale(), finite(), MARK_PRIORITY, markColor(), MINI_BARS, pickRows(), Scale, SetupMiniChartImpl() (+10 more)

### Community 187 - "Community 187"
Cohesion: 0.26
Nodes (18): liveR(), px(), ReasonRow(), Row(), ShadowBookPanel(), statusTone(), Totals(), StripRow (+10 more)

### Community 188 - "Community 188"
Cohesion: 0.16
Nodes (19): apexContracts(), apexRulesFor(), binomCdf(), calibrateThinning(), dllFor(), effectiveMeanR(), expectedPerSession(), fmtNum() (+11 more)

### Community 189 - "Community 189"
Cohesion: 0.16
Nodes (13): createNeonSql(), createPgliteSql(), createSql(), ensureDbReady(), getPglite(), globalBoot, globalRef, identity() (+5 more)

### Community 190 - "Community 190"
Cohesion: 0.14
Nodes (6): @electric-sql/pglite, kysely, Client, LazyPGliteDriver, PGliteConnection, pgliteDialect()

### Community 191 - "Community 191"
Cohesion: 0.12
Nodes (11): at, id, marker, root, target, G, mutants, n (+3 more)

### Community 192 - "Community 192"
Cohesion: 0.27
Nodes (14): already_swept(), atr_at(), bias(), bucket_close(), collect(), day_key(), drift(), equal_in_front() (+6 more)

### Community 193 - "Community 193"
Cohesion: 0.16
Nodes (10): damp(), drawBubble(), drawPlate(), makeBubble(), makePlate(), makeTag(), ManagerAvatar, mat() (+2 more)

### Community 194 - "Community 194"
Cohesion: 0.20
Nodes (15): meanOf(), poissonCI(), pts(), RND_BARS, RND_REGISTERED, RndExperiment, rndRead, RndStatus (+7 more)

### Community 195 - "Community 195"
Cohesion: 0.16
Nodes (16): RFC-4180, AnalyticsReport, ANALYTICS_RISK_PCT, analyticsInput, AnalyticsPayload, CSV_COLUMNS, csvCell(), DisciplineStats (+8 more)

### Community 196 - "Community 196"
Cohesion: 0.14
Nodes (6): three, Bell, Confetti, textSprite(), TicketFlight, V3

### Community 197 - "Community 197"
Cohesion: 0.12
Nodes (13): annotated, bare, both, check(), many, mem, now, numbered (+5 more)

### Community 199 - "Community 199"
Cohesion: 0.15
Nodes (9): BOOKS, etMin(), hist, med(), r3(), report(), shadows, simulate() (+1 more)

### Community 200 - "Community 200"
Cohesion: 0.13
Nodes (12): check(), keepAlive, ok(), ps1, ps1Code, py, pyEnd, pyStart (+4 more)

### Community 201 - "Community 201"
Cohesion: 0.12
Nodes (15): compilerOptions, baseUrl, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+7 more)

### Community 202 - "Community 202"
Cohesion: 0.16
Nodes (11): cyl(), f_armchair(), f_coffee_machine(), f_coffee_table(), f_energy_cans(), f_jumbotron(), f_plant(), f_watercooler() (+3 more)

### Community 203 - "Community 203"
Cohesion: 0.14
Nodes (7): captions, dayChangePct(), dayKey(), FIGS, found, HIST, missing

### Community 204 - "Community 204"
Cohesion: 0.14
Nodes (14): byId, check(), fixture, fresh, here, live, longshot, noAsk1 (+6 more)

### Community 205 - "Community 205"
Cohesion: 0.18
Nodes (14): anticipate(), AnticipatedMark, AnticipationInput, EntryState, MARKUP_MIN_ENGINE, MARKUP_MIN_PROGRESS, pct(), SequenceRead (+6 more)

### Community 206 - "Community 206"
Cohesion: 0.16
Nodes (6): book(), fails, L(), NOW, R(), store

### Community 207 - "Community 207"
Cohesion: 0.15
Nodes (11): bars, etMin(), firstT, kb, { key, from: keyFrom }, lastT, out, parse() (+3 more)

### Community 209 - "Community 209"
Cohesion: 0.25
Nodes (12): ChartJson, InvestMarks, MARKS_MAX_TICKERS, parseDailyChart(), Range, rangeFor(), fetchChart(), getInvestMarks (+4 more)

### Community 210 - "Community 210"
Cohesion: 0.18
Nodes (13): BookShock, detectBookShock(), fmtPts(), minPts(), NONE, readShock(), SHOCK_LOCK_MS, SHOCK_MIN_PTS (+5 more)

### Community 211 - "Community 211"
Cohesion: 0.17
Nodes (11): base, card, check(), closeThrough, fh, ok(), pm, sbase (+3 more)

### Community 212 - "Community 212"
Cohesion: 0.18
Nodes (8): brute(), startDay(), tickets(), EVID, pickOf(), rnd(), ROOM_EV, TIMES

### Community 213 - "Community 213"
Cohesion: 0.17
Nodes (11): a, capped, check(), huge, ok(), oneDte, over, sevenDte (+3 more)

### Community 214 - "Community 214"
Cohesion: 0.32
Nodes (10): StateWord(), SYNAPSE_TABS, SynapseChip(), SynapseRail(), TAB_LABEL, SynapseTab, displayLead(), displayWord (+2 more)

### Community 215 - "Community 215"
Cohesion: 0.27
Nodes (12): banReason(), banReasonFrom(), recentUnderliersFrom(), RH_JOURNAL_CAP, rhMonth(), rhMonthFrom(), RhMonthRead, round2() (+4 more)

### Community 216 - "Community 216"
Cohesion: 0.23
Nodes (11): attribute(), Attributed, Attribution, compliant(), disciplineRead, MIN_N_FOR_LESSON, recallFor(), recallShapes() (+3 more)

### Community 218 - "Community 218"
Cohesion: 0.18
Nodes (8): cagr(), companies, doc, only, round4(), tickers, TYPES, universe

### Community 219 - "Community 219"
Cohesion: 0.18
Nodes (10): args, bIdx, captureEtfProfiles(), doc, ETF_MODE, { key, from }, num(), only (+2 more)

### Community 220 - "Community 220"
Cohesion: 0.18
Nodes (10): base, check(), desk, dual, month, ok(), p, q (+2 more)

### Community 221 - "Community 221"
Cohesion: 0.17
Nodes (6): frames, GOAL, league, RICH, without, withSeats

### Community 222 - "Community 222"
Cohesion: 0.27
Nodes (10): contractLabel(), etTime(), ExecCard(), OrderRow(), PHASES, STATUS_COLOR, flattenBroker(), OccParts (+2 more)

### Community 224 - "Community 224"
Cohesion: 0.17
Nodes (3): FloorSceneOptions, ManagerFeed, StubManagerFeed

### Community 226 - "Community 226"
Cohesion: 0.36
Nodes (6): bs(), build(), ncdf(), npdf(), render(), same_fixture()

### Community 227 - "Community 227"
Cohesion: 0.20
Nodes (7): bandOf(), all(), BARS, check(), FILE, H, ROOT

### Community 228 - "Community 228"
Cohesion: 0.29
Nodes (9): atrAt(), dayKey(), etMin(), H, line(), measure(), pct(), weekday() (+1 more)

### Community 229 - "Community 229"
Cohesion: 0.20
Nodes (9): MARKUP_MIN_PROGRESS, SetupStep, SetupWalkthrough, statusFor(), StepStatus, walkthrough(), ShadowTrade, SmcLayer (+1 more)

### Community 230 - "Community 230"
Cohesion: 0.20
Nodes (5): nitro, @tailwindcss/vite, vite, @vitejs/plugin-react, grokPwaPlugin()

### Community 231 - "Community 231"
Cohesion: 0.24
Nodes (7): bare, line, missing, on, SCHOOL_GATE, px(), schoolPlanPrices()

### Community 232 - "Community 232"
Cohesion: 0.40
Nodes (8): Bullets(), host(), ThesisCard(), ThesisView(), getNewsThesis, isConfigGap(), scrubEnv(), SETUP_URL

### Community 233 - "Community 233"
Cohesion: 0.22
Nodes (7): react-dom, bars, entryArray, markup, plan, T0, themed

### Community 234 - "Community 234"
Cohesion: 0.22
Nodes (5): glass_gap_behind(), housing(), monitor_below(), ring(), wall_top_below()

### Community 235 - "Community 235"
Cohesion: 0.22
Nodes (3): auditSrc, empty, lab()

### Community 236 - "Community 236"
Cohesion: 0.25
Nodes (3): outcome(), rec(), store

### Community 237 - "Community 237"
Cohesion: 0.31
Nodes (6): account(), armed(), fills, quote(), run(), steps

### Community 238 - "Community 238"
Cohesion: 0.22
Nodes (6): BIG, FRI, goodTicket, MORNING, SLEEVE, WED

### Community 239 - "Community 239"
Cohesion: 0.25
Nodes (4): control, H, results, SYMS

### Community 240 - "Community 240"
Cohesion: 0.29
Nodes (5): H, rows, VARIANTS, yearOf(), YEARS

### Community 241 - "Community 241"
Cohesion: 0.25
Nodes (6): base, empty, once, peers, people, twice

### Community 242 - "Community 242"
Cohesion: 0.25
Nodes (6): ConflictLedgerRow, ConflictLevel, ConflictRead, GATE_N_REQUIRED, LADDER_EVIDENCE, SEPARATION_R

### Community 243 - "Community 243"
Cohesion: 0.33
Nodes (3): FIX, fixture(), weekdays()

### Community 244 - "Community 244"
Cohesion: 0.38
Nodes (3): long(), short(), stay0()

### Community 245 - "Community 245"
Cohesion: 0.29
Nodes (3): runawayPrice, stoppedPrice, store

### Community 246 - "Community 246"
Cohesion: 0.40
Nodes (5): build_walls(), P(), wb(), door_frame_at(), screens_on_wall()

### Community 247 - "Community 247"
Cohesion: 0.40
Nodes (4): check(), firstDue, ok(), tuesdayDue

### Community 248 - "Community 248"
Cohesion: 0.40
Nodes (4): check(), minute, ok(), shell

### Community 249 - "Community 249"
Cohesion: 0.53
Nodes (5): acceptsHtmlDocument(), CacheEvent, isImmutableAsset(), noCacheMiddleware(), withNoStore()

### Community 250 - "Community 250"
Cohesion: 0.47
Nodes (5): GapBar, gapBias(), gapDirection, GapSide, resample()

### Community 252 - "Community 252"
Cohesion: 0.60
Nodes (5): canonOf(), card(), longAt(), seq(), shortAt()

### Community 253 - "Community 253"
Cohesion: 0.40
Nodes (3): PERFECT_STANDARD, PerfectGrade, PerfectInput

### Community 255 - "Community 255"
Cohesion: 0.50
Nodes (3): crons, headers, $schema

## Knowledge Gaps
- **2607 isolated node(s):** `config`, `config`, `name`, `private`, `sideEffects` (+2602 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 3269 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Community 14` to `Community 2`, `Community 5`, `Community 6`, `Community 8`, `Community 9`, `Community 139`, `Community 16`, `Community 145`, `Community 146`, `Community 147`, `Community 18`, `Community 149`, `Community 23`, `Community 153`, `Community 26`, `Community 27`, `Community 32`, `Community 161`, `Community 33`, `Community 34`, `Community 39`, `Community 167`, `Community 41`, `Community 44`, `Community 174`, `Community 48`, `Community 49`, `Community 51`, `Community 54`, `Community 186`, `Community 187`, `Community 59`, `Community 67`, `Community 69`, `Community 79`, `Community 80`, `Community 82`, `Community 214`, `Community 86`, `Community 88`, `Community 89`, `Community 92`, `Community 93`, `Community 222`, `Community 99`, `Community 100`, `Community 101`, `Community 232`, `Community 233`, `Community 108`, `Community 109`, `Community 118`, `Community 127`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **What connects `config`, `config`, `name` to the rest of the system?**
  _2607 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.047665847665847666 - nodes in this community are weakly interconnected._
- **Why does `lucide-react` connect `Community 8` to `Community 2`, `Community 5`, `Community 134`, `Community 9`, `Community 14`, `Community 16`, `Community 146`, `Community 18`, `Community 23`, `Community 152`, `Community 153`, `Community 26`, `Community 32`, `Community 161`, `Community 33`, `Community 34`, `Community 39`, `Community 167`, `Community 41`, `Community 44`, `Community 48`, `Community 49`, `Community 51`, `Community 54`, `Community 59`, `Community 69`, `Community 79`, `Community 82`, `Community 214`, `Community 86`, `Community 89`, `Community 93`, `Community 222`, `Community 100`, `Community 232`, `Community 108`, `Community 109`, `Community 127`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.04761065067889261 - nodes in this community are weakly interconnected._
- **Why does `FloorScene` connect `Community 28` to `Community 224`, `Community 193`, `Community 196`, `Community 37`, `Community 38`, `Community 10`, `Community 42`, `Community 17`, `Community 18`, `Community 51`, `Community 24`, `Community 223`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.0516404581634634 - nodes in this community are weakly interconnected._