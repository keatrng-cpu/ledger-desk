# System map

MNQ/ES desk. TypeScript scores and gates. Grok places the Robinhood ticket. Claude and Grok share `main`.

Do not relocate `src/`. The domain folders are the modules. A new `src/core` tree would break every import for a layout no agent reads.

## Locate a file

Search [docs/code-index.md](../docs/code-index.md). Do not read it whole. Do not walk `src/`.

```
rg -n "raid|entry|floor" docs/code-index.md
```

Regenerate after a file is added or renamed: `node scripts/code-index.mjs` or `make map`.

## What each folder owns

- `src/lib/trading/` — the tape, the grade, the card, the plan
- `src/lib/market/` — Databento, Yahoo, the live gateway
- `src/lib/execution/` — the Robinhood send and the close
- `src/lib/room/` — the floor. Narration. It does not gate a ticket
- `src/lib/desk/` — the wire Grok reads
- `src/lib/aplus/config.ts` — the numbers. Agents do not edit them
- `src/components/` — the screen. It reads the lib. It does not score
- `scripts/` — verifiers and measurements

## Before editing

```
git fetch origin main
node scripts/agent-sync.mjs --agent grok
```

Claude uses `--agent claude`. Exit 2 means pull --rebase and run it again.

## Rules that are not in this file

Numbers and the live loop: `CLAUDE.md`. Cross-model edit style: `.ai/prompt_rules.md`. Who calls whom: `.ai/dependency_graph.md`.
