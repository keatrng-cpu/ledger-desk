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

**Find code by search, not by reading.** Do not open `CLAUDE.md`'s code map or walk `src/` to locate a file. Search the one-line index, then open only the hit:

```
rg -n "raid|entry|floor" docs/code-index.md
```

Regenerate after a file is added or renamed: `node scripts/code-index.mjs`. The same script drops into any other repo.

Preview: `0.0.0.0:8080` via `startup.sh` / `npm run dev`.

Live desk dump for another agent: HUD **Copy for Claude** (`src/lib/trading/claude-handoff.ts`).
