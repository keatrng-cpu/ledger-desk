# Merge-gate review: Floor command center (2D)

**SHA:** `d0d4ccfaad5d9a9358ae361e5adb8b5ab294a8b9`  
**Branch:** `design/floor-command-center`  
**Commits:** `f4c9cba` feed-dot extract → `8b7bade` command center → tsx chore + revert  
**Owner:** Design Atelier  
**Scope:** read-only. Screenshots: `/workspace/ledge-command/`.  
**Date:** Tue Oct 6 2026.  
**Worktree:** `/workspace/ledger-desk-cmd-d0d4` (removed after review).

## Verdict: **CHANGES**

Two blocking honesty/safety gaps on the strip tone and arm display. Lab error copy is the same fail-open *class* as desk-bootstrap B1 (error looks like signed-out). Suites are green; display-only elsewhere looks solid.

---

## Merge geometry

| Item | Result |
|------|--------|
| vs `origin/main` | **0 behind / 4 ahead** (`008cbec`) |
| Diff | 14 files, +1050/−140 — `src/components/floor/command/*`, `feed-dot.ts`, `ai-sync` helpers, session-hud / discuss / floor-tab wiring |
| Overlap with `ee89721` (tabs follow-up) | **`session-hud.tsx`, `discuss-tab.tsx`** — both extract feed tone from the HUD; Design → `feed-dot.ts` / `feedDotTone`, tabs → `feed-tone.ts` / `feedTone`. **merge-tree: changed in both** — rebase/merge must unify on one module |
| Order | Prefer land **`ee89721` first** (stricter unknown→red), then re-point command strip to `feedTone`, **or** fold unknown-fail-closed into `feed-dot` before merge |

---

## Screenshots (local after)

Decision strip: DESK WAIT · MANAGER IDLE · **RH Agentic · BP $0 · arm blocked** + SNAPSHOT · NEXT Discuss · **Y!** yellow (never green). Cards: News/Options/Charts/Brain live; Predict LOADING; Book **Backtest projection**; Lab OFFLINE; Learn EMPTY. Matches claimed UX.

---

## Checks

### Invented numbers / empty states — **PASS**

Cards pull real sources (`use-command-reads.ts`): `getNewsFeed`+`tagItem`, sleeve budgets, `desk.levels`/`quotes`, `runVeteranBrain`+`schoolRings`, `getPredictionMarketFeed`, paper `getPaperAccount`, `getRiskState`, `nextAiSyncCheckpoint`, `MODULES`+localStorage. Empty/offline/loading statuses used; `—` helpers for null nums.

### Same source as tabs — **PASS** (Brain note)

Brain uses `runVeteranBrain(desk)` then `schoolRings(stack)` — same `STEP_FACTORS` map as `SmcPlaybook` (`school-rings.ts:12-19` vs playbook). Aggregate only; not a second brain.

Book labeled **Backtest projection** / “History, not this book” (`:246-248`) — **PASS**.

### Lab / risk fail-open — **CHANGES (blocking class)**

```253:282:src/components/floor/command/use-command-reads.ts
    void getRiskState()
      .then((r) => {
        if (!r) {
          setRead({ status: "offline", primary: "Governor offline — sign in for live PnL." });
          return;
        }
        ...
      })
      .catch(() => {
        if (!cancelled) setRead({ status: "offline", primary: "Governor offline — sign in for live PnL." });
      });
```

`getRiskState` is auth-gated GET (`journal/server.ts:1259+`). **Null and thrown errors share the signed-out line.** That is the B1 pattern: a timeout/DB error looks like “sign in”, not **unknown/blocked**. Command center does not flip `entryAllowed` (display-only) — still must not paint error as a calm offline/sign-in state.

**Fix:** distinguish `offline` (unauthenticated) vs `status: "stale"` / primary `Governor unknown — risk read failed` on catch; never imply clear.

### Arm display fail-closed — **CHANGES (blocking)**

```69:74:src/components/floor/command/decision-strip.tsx
  const armBlocked =
    !rh ||
    !Number.isFinite(rh.optionsBuyingPowerUsd) ||
    rh.optionsBuyingPowerUsd < (rh.envelopeMinUsd || RH_MIN_DEBIT_TOTAL) ||
    !rh.canFillEnvelope;
```

Missing **`rh.isSnapshot`** (and any asOf-age stale). Hard place gate refuses snapshots (`manager-account.ts:218-220`), but the strip can omit “arm blocked” when a snapshot has BP ≥ $150 — only a SNAPSHOT chip. Parent requires fail-closed on **stale BP**.

**Fix:** `armBlocked ||= rh.isSnapshot` (and optionally age > BP max).

Missing account → red “arm blocked” (`:120-134`) — **PASS**.

### `feedDotTone` vs `feed-tone.ts` — **CHANGES (blocking)**

Shared extract is `src/lib/ui/feed-dot.ts` (this branch). Tabs follow-up `ee89721` has `feed-tone.ts` with **unknown/empty → red, never lag-green**. `feedDotTone` has no `KNOWN` / unknown branch — unrecognized sources fall through to `worstLagSec <= 15` → **green** (`feed-dot.ts:68-74`). SYN/Y! never green — **PASS** for those two only.

Parent: same shared tone as `feed-tone.ts` — **not met** until unknown fail-closed is copied or the strip imports `feedTone`.

### No order / arm / POST — **PASS**

Command folder: display + Manager button + drawer “Open full tab” (`ledger:open-tab`). No place/arm handlers; reads use existing GET server fns.

---

## Suites

| Suite | Result |
|-------|--------|
| `tsc --noEmit` | **0** |
| RH autofire / path / manager / floor | **218 / 111 / 58 / 21** |
| `verify-room-exec` | **222** |
| `verify-repo-guards` | **59/0** |
| Dedicated command unit | none in tree |

---

## Blocking vs should-fix

### Blocking

1. **`armBlocked` must include snapshot/stale BP** (`decision-strip.tsx:70-74`).
2. **`feedDotTone` must fail closed on unknown sources** (align with `ee89721` `feedTone`) — or import that module.
3. **Lab risk error/timeout ≠ “sign in / offline”** — show unknown/blocked (`use-command-reads.ts:280-281`).

### Should-fix

1. Unify `feed-dot` / `feed-tone` when merging with `ee89721` (session-hud conflict).
2. Prefer shared `schoolRings` import from one module used by SmcPlaybook too (DRY).

---

## Recommendation

**CHANGES** — fix the three blockers, then re-review. Do not merge past Accuracy until arm + feed unknown + Lab unknown copy are honest.
