# Hardened workflows, waiting for a login that may write them

GitHub refuses a push that creates or changes anything under `.github/workflows/` unless the token has the `workflow` scope. The login on the
machine that wrote these has none (2026-10-07: `refusing to allow an OAuth App to create or update workflow ... without workflow scope`).
So the three files below are kept here, where GitHub does not run them, and `main` still has the old workflows in `.github/workflows/`.

| File | What the hardened copy fixes |
|------|------------------------------|
| `pr-agent.yml` | Only an owner, member or collaborator can trigger it (on a public repo any user could comment `/review` and spend `OPENAI_KEY`); the third-party action is pinned to the v0.47.0 release commit instead of `@main`; the dispatch input goes through `env`, not into the script; timeout and concurrency. |
| `brain-intake.yml` | Only an owner, member or collaborator's issue is read; timeout and concurrency. |
| `security.yml` (new) | Gitleaks over the whole history (binary checked against a pinned SHA-256) and Bandit at Medium and above. Read-only, uses no secret. |

## Install (about a minute, your login)

```bash
gh auth refresh -h github.com -s workflow
cp docs/pending-workflows/*.yml .github/workflows/
git add .github/workflows && git commit -m "workflows: install the hardened copies" && git push origin main
```

Then delete this folder, and `scripts/verify-tooling-guards.mjs` goes back to reading `.github/workflows/` by itself. Until you do, that verifier
pins the content of the copies here and prints a `TODO` line for each live workflow that still differs.

Nothing in these files places an order or touches the book.
