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

Preview: `0.0.0.0:8080` via `startup.sh` / `npm run dev`.

Live desk dump for another agent: HUD **Copy for Claude** (`src/lib/trading/claude-handoff.ts`).
