# Cross-model edit rules

Grok and Claude write the same tree. Style is not a reason to rewrite the other agent's file.

- Search `docs/code-index.md` and open the hit. Do not paste the tree into the prompt.
- Fetch and run `scripts/agent-sync.mjs` before editing. Read the diff of a file you did not write.
- Do not redo a commit already on `main`. Do not revert the other agent's commit to land yours.
- Do not rewrite a file to restyle it. Patch the lines the task needs.
- Do not split a file to hit a line cap during a trading fix. A split is its own change, with the imports updated and the verifier run.
- A public function you add gets one line saying what it returns. Do not add a comment block to code you did not write.
- Numbers live in `src/lib/aplus/config.ts`. Agents do not change them. If a doc disagrees with the code, the code wins.
- Push to `main`. Run `make map` if you added or renamed a file.
