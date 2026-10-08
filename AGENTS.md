# Agent notes (Grok / Claude / Cursor)

**Ledger Desk** — private MNQ/ES SMC/ICT masterplace.

Full protocol, numbers, live SOP, and code map: **[CLAUDE.md](./CLAUDE.md)**  
Follow that file. If it conflicts with this note, CLAUDE.md wins. If CLAUDE.md conflicts with `src/lib/aplus/config.ts`, **code wins**.

**Shared tree.** Grok and Claude both commit to `main`. Before editing, fetch and read what the other just shipped:

```
git fetch origin main
node scripts/agent-sync.mjs --agent grok
```

Claude uses `--agent claude`. If the script exits 2, `git pull --rebase origin main` and run it again. Do not edit a file in that brief until you have read its diff. Brief: [docs/agent-sync.md](./docs/agent-sync.md).

**Find code by search, not by reading.** Start at [.ai/locator.md](./.ai/locator.md). It names the function. On a miss, search the one-line index. Do not open `CLAUDE.md`'s code map or walk `src/`.

```
rg -n "raid|entry|floor" docs/code-index.md
```

Regenerate after a file is added or renamed: `node scripts/code-index.mjs`. The same script drops into any other repo.

Preview: `0.0.0.0:8080` via `startup.sh` / `npm run dev`.

Live desk dump for another agent: HUD **Copy for Claude** (`src/lib/trading/claude-handoff.ts`).

---

## The shared gate (added 2026-10-08, after measuring what the tree actually cost us)

Both agents push to `main` and the site deploys from it, so a break is live. The only check was a LOCAL pre-push hook, and both of us skip it with `--no-verify`. On 2026-10-08 that had cost: **two TypeScript errors sitting on `main` and deployed** (Vite does not typecheck, so the Netlify build stayed green), **a constant lowered 150 → 50 without its three tests**, a CLAUDE.md row naming the wrong live gate knobs, and **nine verifiers red at once** — which is the real damage, because a gate nobody can pass is a gate nobody runs.

**`node scripts/verify-all.mjs --baseline`** fixes that. `scripts/verify-baseline.json` records what is already red *and why*. The run blocks on a **new** break or a **worse** failing count, and reports the rest. The pre-push hook now uses it.

| Do this | Why |
|---|---|
| `npm run typecheck` before every push | The build does not typecheck. This is the check that was missing. |
| `node scripts/verify-all.mjs --baseline` | Blocks only on what *you* broke. |
| Record the baseline **before** a big change | Afterwards you cannot tell your break from an old one. I skipped this on wave 1 and had to re-measure on a scratch worktree to clear my own name. |
| Change a constant → change its tests **in the same commit** | `RH_MIN_DEBIT_TOTAL` 150 → 50 left three red checks that still encode the old envelope. |
| A verifier goes green → delete its baseline entry **in the same commit** | Otherwise the list rots and starts hiding real breaks. The gate fails if you forget. |
| Never widen the baseline to go green | It is an inventory of debt, not a mute button. Shrink it. |

**`--no-verify` is allowed** — the suite is ~4.5 minutes and the hook is local — **but say so in the commit body and say what you skipped.** Server-side CI is the real backstop: `docs/pending-workflows/desk-gate.yml` runs the typecheck and the baseline gate on every push to `main`, and no flag skips it. It is not installed yet; it needs a login with the `workflow` scope (see the README beside it).

### Copy and code disagree? Code wins — and fix the copy in the same commit

Three cases found in one day: `CLAUDE.md` said `sameBarDisplacement` was live when `GATE` ships it `false` (the real pair is `sideFromRaid` + `dealingRange: "impulse"`); `scanner.ts` labels a target "clamped 1–3R" when CLAUDE.md records that clamp as measured −0.12R/t and **not applied**; `manager-account.ts` still says the envelope is $150. A wrong line in `CLAUDE.md` is worse than no line, because the other agent plans from it.

### Hand work over the way the other agent can use it

When you finish a piece, say in the commit body: what you **refused** and why, every **number** you changed (old → new, file:line, why), and the exact edit you need in a file you did not own. A refusal with a reason is a result. Silently implementing a weaker version is not.
