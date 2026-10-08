---
name: code-index
description: Find a file in the Ledger Desk before reading the tree. Use at the start of any code task, and on any other repo that has docs/code-index.md.
---

# Code index

Do not walk `src/` and do not read the code map in CLAUDE.md to locate a file. Search the one-line index, then open only the hit.

```
rg -n "raid|entry|floor" docs/code-index.md
```

Each line is the path, the exported names, and the first sentence of the file header. A miss means the name is not exported or the header does not say it. Then search the symbol in `src/`, still without opening unrelated files.

Regenerate after a file is added or renamed: `node scripts/code-index.mjs`.

The same script is the locator for any other project. Copy `scripts/code-index.mjs` in, run it, and search `docs/code-index.md` the same way. Shared rules stay in AGENTS.md. The index is the map. The long code map is history, not a locator.
