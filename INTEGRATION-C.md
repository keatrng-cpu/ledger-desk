# Phase B integration notes — B4 alerts, B5 schedules, B6 snapshot review

Everything below is **additive**. No existing exported symbol, type, or field was
renamed or removed, and `src/lib/journal/snapshots.ts` was **not modified** — it
did not need to be. `listSnapshots` / `getSnapshot` were already correct; they
simply had no caller. They have one now.

Verified locally before writing this:

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors (39 pre-existing warnings, none in these files) |
| `npx vite build` | succeeds, Nitro/Vercel output included |
| Migrations on PGLite | `0001`–`0009` apply clean; re-applying is a no-op |
| Cron endpoints via curl | 503 / 401 / 200 all confirmed — see §5 |
| Web Push crypto | VAPID JWT verifies; payload decrypts round-trip — see §4 |

---

## 1. Mount the snapshot review (B6) — `src/routes/index.tsx`

`captureSnapshot` has been writing decision-time context on every logged trade
since Phase 5 and **nothing has ever read it**. This is the reader.

```tsx
import { SnapshotReview } from "@/components/desk/snapshot-review";
```

It is **self-fetching and takes no props**. Drop it into the `lab` category,
which the page already frames as "Use during review, not mid-killzone" — the
correct place, because reviewing snapshots mid-killzone is exactly the habit the
screen exists to replace:

```tsx
{cat === "lab" && (
  <div className="space-y-6">
    <SectionHead n="L" title="Deep lab" sub="Rules catalog · replay · bridge — not for session noise" />
    {/* … existing banner … */}
    <SnapshotReview />          {/* <- add here, above AplusOps */}
    <AplusOps />
    <ReplayReport />
    <BridgeStatus />
  </div>
)}
```

Alternative placement, if you would rather it sit next to the record it explains:
the `path` category, immediately after `<JournalPanel />`. Do not put it in
`trade` — a screen whose whole purpose is retrospective does not belong on the
live decision surface.

Notes:

- It requires a session (`authMiddleware`, like `AnalyticsPanel`). Signed out it
  renders the thrown message rather than an empty list, so the "why is this
  blank" question answers itself.
- The stored payload is `jsonb` typed `JsonValue`. Every field read goes through
  narrowing helpers, so a snapshot captured by an **older build** renders the
  sections it can and omits the rest instead of crashing. You can change
  `DeskPayload` without breaking the review of trades taken before the change.
- Retention is 500 per user (`SNAPSHOT_RETENTION`, pruned on write). The list
  says so on screen; opening a pruned id shows a specific message, not an error.

### Optional: an alerts on/off control

There is deliberately **no alerts component** — that would have meant a second
new component file, and the placement decision is yours. `src/lib/alerts/client.ts`
exports the three functions a button needs:

```tsx
import { enablePushAlerts, disablePushAlerts, isPushEnabled, pushSupport } from "@/lib/alerts/client";

const res = await enablePushAlerts();
if (!res.ok) toast(res.reason);   // reasons are written to be shown verbatim
```

`pushSupport()` returns a specific reason when push cannot work here (no HTTPS,
no Push API, iOS-not-installed-to-home-screen) so the control can explain itself
instead of silently failing.

---

## 2. Environment variables to set in Vercel

Added to `.env.example` (appended; `.env` and `.env.*` are gitignored, confirmed
via `git check-ignore`). **No key is hardcoded anywhere in the repo.**

| Variable | Required for | Notes |
|---|---|---|
| `CRON_SECRET` | B5 schedules | Vercel sends it as `Authorization: Bearer <value>` automatically once set on the project. **Unset ⇒ every `/api/cron/*` returns 503.** Use ≥16 random chars. |
| `CRON_USER_ID` | B5 (optional) | User id the jobs write rows against. Falls back to `ENGINE_BRIDGE_USER_ID`, then `dev-user`. |
| `VAPID_PUBLIC_KEY` | B4 push | Public by design — it is served to the browser. |
| `VAPID_PRIVATE_KEY` | B4 push | Server-only. Never prefix it for the client. |
| `VAPID_SUBJECT` | B4 push | `mailto:you@…` or `https://…`. Falls back to `https://$VERCEL_PROJECT_PRODUCTION_URL` when unset. |

Set `CRON_SECRET` in the **Production** environment specifically: crons only run
against production deployments, so a secret scoped to Preview only produces a
project whose schedules all 503.

### Generating the VAPID pair (zero dependencies)

```bash
node -e "const{createECDH}=require('crypto');const k=createECDH('prime256v1');k.generateKeys();console.log('VAPID_PUBLIC_KEY='+k.getPublicKey('base64url'));console.log('VAPID_PRIVATE_KEY='+k.getPrivateKey('base64url'))"
```

Rotate **both halves together**. The send path derives the public key from the
private one and refuses to send on a mismatch with a named error, rather than
letting every push fail as an opaque 403 at the push service.

---

## 3. Migration

`migrations/0007_alerts.sql` — `push_subscriptions` and `alert_log`. Applied
automatically (PGLite on boot, Neon via `npm run db:migrate` inside
`npm run build`). Nothing to run by hand.

`alert_log`'s unique index on `(user_id, kind, dedupe_key)` **is** the
"never send the same alert twice" guarantee. Sending is
`insert … on conflict do nothing returning id`; zero rows means "already
raised", not "failed". Verified on PGLite: second claim returns 0 rows, a
different user's identical key still returns 1, and an unknown `kind` is
rejected by the CHECK constraint.

---

## 4. Web Push (B4) — zero new dependencies

`package.json` is unchanged. The usual `web-push` package was not added: VAPID
(RFC 8292), message encryption (RFC 8291) and the aes128gcm framing (RFC 8188)
are implemented directly on `node:crypto` in `src/lib/alerts/push-server.ts`.

**This is not "implemented and untested".** A throwaway harness (since deleted)
generated a VAPID pair and a synthetic subscriber, pointed `sendPush` at a local
capture server, and confirmed:

- the `Authorization: vapid t=…, k=…` header parses, `alg: ES256`, `aud` equals
  the push origin, `exp` in the future, and the **signature verifies** against
  the public key via `crypto.verify(… dsaEncoding: "ieee-p1363")`;
- framing is `salt(16) ‖ rs=4096 ‖ idlen=65 ‖ as_public(65) ‖ AEAD`;
- the body **decrypts back to the exact original JSON** using the subscriber's
  private key — a true RFC 8291 round trip, not a self-consistency check;
- `410` maps to `gone: true` (the row is then deleted);
- a mismatched VAPID pair fails with a named error containing **no key material**.

What is **not** runtime-verifiable here and needs one real device to confirm:

- that Apple/Google/Mozilla push services accept these messages in production
  (they follow the same RFCs, but only a live subscription proves it);
- `public/sw.js` rendering — needs HTTPS and a real permission grant. On iOS the
  Push API only exists after the app is added to the Home Screen.

### Raising alerts from the trading path

`src/lib/alerts/send-server.ts` exports `sendAlert(userId, spec)` plus four
builders that own their dedupe keys. `sendAlert` **never throws** — safe to
`void` from a hot path. The call sites live in files owned by B1/B2, so they are
listed here rather than edited:

| Alert | Where it belongs | Call |
|---|---|---|
| Halt hit | `openTrade` in `src/lib/journal/server.ts`, where the three halt errors are thrown | `void sendAlert(context.userId, haltHitAlert({ scope: "daily", detail: … }))` |
| Position auto-flattened | the B2 time/context-stop routine | `positionFlattenedAlert({ tradeId, symbol, side, reason, r })` |
| Setup armed | wherever the scanner marks the sequence complete | `setupArmedAlert({ symbol, side, candidateId, grade, confluence, killzone })` |
| News blackout in 15 min | the poller that already computes `newsRead` | `newsBlackoutAlert({ startsAt, event, impact })` |

Each builder's dedupe key is chosen so that calling it on **every 30s poll** is
correct and produces exactly one notification (per day for a halt, per candidate
for an arm, per trade for a flatten, per news instant for a blackout).

---

## 5. Scheduled jobs (B5) and the DST caveat

Routes: `/api/cron/checklist`, `/api/cron/review`, `/api/cron/weekly` — TanStack
Start server routes with `GET` handlers (Vercel Cron issues a GET; `vercel.json`
has no method field). Each authenticates, then records an `alert_log` row rather
than assuming a browser is open.

### Measured responses (`npm run dev`, curl)

```
CRON_SECRET unset
  GET /api/cron/{checklist,review,weekly}        -> 503 {"ok":false,"error":"Cron unavailable"}
  …even with a well-formed bearer header         -> 503        (fails closed)

CRON_SECRET set
  no header                                      -> 401 {"ok":false,"error":"Unauthorized"}  (www-authenticate: Bearer)
  wrong secret                                   -> 401
  correct secret, no "Bearer " scheme            -> 401
  a correct *prefix* of the secret               -> 401        (constant-time compare)
  correct secret                                 -> 200

  200, outside the ET window (real run at 21:13 ET):
    {"ok":true,"job":"checklist","ran":false,"skipped":"outside ET window (target 9:xx ET)",
     "etDay":"2026-08-11","etTime":"21:13"}

  200, forced (?force=1) — first call does the work:
    {"ok":true,"job":"review","ran":true,"etDay":"2026-08-11","etTime":"21:13",
     "dedupeKey":"review:2026-08-11","recorded":true,"delivered":0,
     "detail":{…,"pushDisabledReason":"push not configured (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)"}}

  200, forced a second time — idempotent:
    {"ok":true,"job":"review","ran":false,"skipped":"already ran for this ET day",
     "recorded":false,…}

  ?force=1 with no/bad auth                      -> 401        (not a bypass)
```

`?force=1` skips only the ET-window guard, never the auth check, and idempotency
still applies. It is the way to test a job outside its hour.

### DST — stated honestly

**Vercel Cron schedules are UTC and do not shift with daylight saving.** There is
no timezone field. One UTC expression therefore cannot mean "09:15
America/New_York" all year: it is 09:15 ET for roughly eight months and 08:15 ET
for the other four.

Rather than pick a season to be wrong in, **each job is scheduled twice** — once
at its EDT-correct UTC time, once at its EST-correct UTC time — and every handler
checks the real ET wall clock before doing anything. Exactly one of the two lands
in the target ET hour on any given day; the other returns `ran: false` having
touched nothing. `alert_log`'s unique key is the backstop if both ever passed.

| Job | ET target | UTC (EDT, ~Mar–Nov) | UTC (EST, ~Nov–Mar) |
|---|---|---|---|
| checklist | 09:15 Mon–Fri | `15 13 * * 1-5` | `15 14 * * 1-5` |
| review | 16:15 Mon–Fri | `15 20 * * 1-5` | `15 21 * * 1-5` |
| weekly | Sun 18:00 | `0 22 * * 0` | `0 23 * * 0` |

`vercel.json` carries all six with **no comments**: Vercel's docs never state
whether the file tolerates `//`, and Vercel's own published schema sets
`additionalProperties: false` at the top level, so a `"comment"` key risks
failing validation. The caveat lives here and in the docblock of every cron route
instead. Both plan limits are satisfied — Vercel allows 100 cron jobs per project
on Hobby, Pro and Enterprise, and each of the six expressions runs once per day.

**Two consequences worth knowing before you rely on this:**

1. **Hobby invokes a cron anywhere within the scheduled hour (±59 min).** The
   09:15 ET checklist can therefore actually arrive as late as 09:59 ET — after
   the 09:30 open. The ET-window guard is hour-granular precisely so those
   invocations still run rather than being discarded, but the lateness is real.
   On Pro it lands within the minute. If the checklist must precede the open,
   move it to the 08:xx ET hour (`15 12`/`15 13`) and change `TARGET_ET_HOUR` to
   `8` in `src/routes/api/cron/checklist.ts`.
2. Crons only fire on **production** deployments.

### Deliberately not done

ROADMAP B5 also wants the Sunday slot to run a week-backtest → brain update.
`weekly.ts` does **not** do that, and the reason is in the file: `session-backtest`
is heavy and network-dependent, and wiring it into a serverless cron would make
the one scheduled job that produces the weekly evidence the flakiest thing in the
repo. The endpoint records the measured week from the database — the part that
must never be missed. The backtest hook is a follow-up; the natural shape is a
separate `/api/cron/backtest` on its own schedule, so a Yahoo outage cannot take
the weekly record down with it.

---

## 6. Files added

```
migrations/0007_alerts.sql              push_subscriptions + alert_log
public/sw.js                            service worker: push + notificationclick only
vercel.json                             crons (six entries, two per job — DST)
src/lib/alerts/types.ts                 alert kinds, labels, urgency (isomorphic)
src/lib/alerts/push-server.ts           VAPID + RFC 8291/8188 on node:crypto
src/lib/alerts/store-server.ts          subscription CRUD + the idempotency claim
src/lib/alerts/send-server.ts           sendAlert() + the four B4 builders
src/lib/alerts/server.ts                subscribe/unsubscribe/status server fns
src/lib/alerts/client.ts                browser: register SW, subscribe, unsubscribe
src/lib/alerts/cron.ts                  cron bearer auth + ET-window guard
src/lib/alerts/cron-stats-server.ts     windowed aggregates for the reviews
src/routes/api/cron/checklist.ts        09:15 ET premarket
src/routes/api/cron/review.ts           16:15 ET forced review
src/routes/api/cron/weekly.ts           Sun 18:00 ET week close
src/components/desk/snapshot-review.tsx B6 review screen
```

`src/lib/alerts/cron.ts` and `cron-stats-server.ts` sit under `alerts/` because a
cron run and an alert are the same object here — one idempotent fact in
`alert_log` — and because this phase's file ownership was scoped to
`src/lib/alerts/*`. If a `src/lib/cron/` is ever created, both move verbatim.

## 7. Security posture

- Every cron endpoint authenticates before any I/O; unset secret ⇒ 503, never open.
- Constant-time secret comparison over SHA-256 digests (copied from
  `bridge/auth-server.ts`), so neither length nor a shared prefix leaks.
- All SQL is parameterized and scoped by `user_id`. No string interpolation of
  values anywhere in `src/lib/alerts/`.
- Errors returned to callers are generic (`"Checklist job failed"`); detail goes
  to `console.error` server-side. `pushDisabledReason` names missing env
  **variables**, never values.
- `subscribeToAlerts` rejects any non-`https:` endpoint, so a stored subscription
  cannot become an SSRF primitive against an arbitrary host on a schedule.
- `public/sw.js` has **no `fetch` handler** and does no caching — on a desk that
  shows live prices, a caching service worker is a data-integrity bug. It also
  only ever opens same-origin paths.
