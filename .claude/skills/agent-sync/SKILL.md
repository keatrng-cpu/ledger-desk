---
name: agent-sync
description: Read before editing the Ledger Desk repo. Grok and Claude share main. Use at the start of any coding session, before a commit, and after a pull, so you see commits and files the other agent added.
---

# Agent sync

Grok and Claude share one `main`. There is no private branch. A commit you have not read is code you have not seen.

Before editing:

```
git fetch origin main
node scripts/agent-sync.mjs --agent claude
```

Grok runs the same command with `--agent grok`.

- If the script exits 2, origin is ahead. `git pull --rebase origin main`, then run it again.
- Read the diff of any file in the brief before you change it: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to make yours apply.
- Push to `main` when the change is done, then run the script once more so your bookmark matches what you pushed.

The brief is `docs/agent-sync.md`. The bookmark is `docs/agent-sync.json`. The git log is the source of truth.
