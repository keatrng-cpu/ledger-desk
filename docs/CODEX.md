# Codex on the Ledger Desk

How to put OpenAI's **Codex** to work on this desk — connected to the live state over
MCP, working the repo through PRs, and standing in when Claude or Grok usage drains.

## 1. The desk is an MCP server

`POST /api/mcp` (`src/lib/desk/mcp-server.ts`) — streamable HTTP, JSON-RPC 2.0,
protocol `2025-03-26`. **Read-only: it never sees the account and never places.**

Tools:

| tool | what it returns |
|---|---|
| `read_desk` | the whole live card: tape + lag, strategy, levels, brain word, floor ticket, Grok's last report |
| `read_scanner` | top setup-scanner cards + the shared wire (entry/stop/draw/tape source) |
| `read_floor` | options floor verdict, the ticket if one exists, what Vince/Sterling/Nova said |
| `read_brain` | SMC brain: one book, TAKE/WAIT/STAND, the missing layer |
| `read_rules` | the full `shared/desk-rules.json` + `RULES_HASH` — the gates (band edges, min-stop ATR, R:R floors, kill params, dispVsRr, sessions) |
| `read_backtest` | latest walk-forward summary (per-split & per-symbol hit/avgR/sumR/opt%, train/holdout/skipped); trades array omitted, count given |
| `read_calibration` | confluence knowledge (samples, best score, component fire %, hot/cold, lessons) + ladder calibration metadata |
| `report_trade` | (write) report a ticket's outcome back to the floor — taken/pnl/journal/status. Never places. |

The last three are built for an engineering agent: `read_rules` + `read_backtest` +
`read_calibration` give Codex the engine's own gates and measured self-knowledge
without a human pasting files.

## 2. Connect Codex

`mcp-remote` bridges the remote streamable-HTTP endpoint to the stdio MCP Codex
expects. In `~/.codex/config.toml`:

```toml
[mcp_servers.ledger_desk]
command = "npx"
args = ["-y", "mcp-remote", "https://ledgeyourtrades.netlify.app/api/mcp"]
```

Local dev instead: point it at `http://localhost:8080/api/mcp` while `npm run dev`
is up. Verify with Codex's `/mcp` (or `tools/list`) — you should see the eight tools
above.

## 3. Who does what (play to strengths, don't overlap)

- **Codex** — sustained autonomous coding in the terminal: large multi-file
  refactors, exhaustive test generation, running `scripts/backtest.mts` /
  `ab-measure.mts` / the `verify:*` suite and iterating on the output, mechanical
  migrations. This is where it beats the others — long, uninterrupted, big-diff work
  with the backtest in the loop. Good first jobs: the `node:path`/`databento`
  server-in-client boundary cleanup, virtualizing the long ladder lists for the
  two-tab perf pass, and promoting the shadow layers (#60/#62/#63) once an
  Accuracy-Review run clears them.
- **Grok** — live market / session reasoning during RTH: the SMC narrative, the tape
  read, the brain word. It is already the desk's connector; keep the live judgment
  there.
- **Claude** — architecture and design, code review of Codex's diffs, the honest
  measurement/accuracy framing, UI and animation craft, cross-cutting calls.

## 4. Fallback worker — when Claude or Grok drains

When Claude or Grok usage runs out, Codex keeps the engineering moving on its own:

1. It reads live desk state through the MCP (`read_desk` / `read_scanner` /
   `read_brain`) and the engine's gates/metrics (`read_rules` / `read_backtest` /
   `read_calibration`) — no human paste needed.
2. It works the repo the same way every agent here does: a branch and a PR, never a
   self-merge.
3. The guardrails hold regardless of which agent is driving:
   - **New logic starts in shadow**, logged, promoted only on an Accuracy-Review `GO`.
   - **`shared/desk-rules.json` changes need the Release-Watch gate + the Trading-Stand
     sha256 handoff** — never auto-merged.
   - **No live broker orders, ever** — no broker SDKs, keys, or order endpoints; the
     desk MCP is read-only and `report_trade` only journals.
   - Merge only on **CI green + Accuracy-Review GO**.

So the desk never stalls on one provider's quota: Grok reads the market, Claude
designs and reviews, Codex builds — and any one can cover the engineering lane
through the repo + this MCP while the gates keep every change honest.
