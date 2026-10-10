---
name: desk-data
description: Which connector a Ledger Desk number comes from, and which one to reach for without being asked. Use whenever the desk needs a figure it does not already hold — an SEC filing, insider or institutional holdings, a fundamentals or KPI refresh, an earnings or macro release calendar, a Treasury yield, CPI, an option chain or historical option price, an ETF's holdings, a company's segment numbers, a dated research figure, or a primary page to check one against — and whenever work touches the desk's own Supabase database, its Netlify deploy, the gateway's scheduled task, a three.js / TanStack / Vite API, or the Floor's office.glb. Read it before answering any "what is X's number" question and before writing a capture script. The connector is a source; a model never is.
---

# Desk data — where a number comes from

The standing rule is [[desk-accuracy]]: a model may find, read and explain a figure, never be the source of one. This skill says
WHICH source, because the session has ~40 connectors and only a handful belong anywhere near this desk.

**Reach for these without being asked.** If a question needs a number the repo does not already hold, the answer is a connector
call plus a dated source line — not recall, and not a search snippet.

## The number sources

| Need | Tool | Notes |
|---|---|---|
| Fundamentals, earnings calendar, ETF holdings, cash flow, CPI, Treasury yields, option chains | **Alpha Vantage** `mcp__e14abc31-*` (133 tools) | The repo already captures from this key — `npm run capture:invest`, `earnings-calendar.json`, `invest-etf-profiles.json`. The FREE key is **25 requests/day**, which is why those files are committed and never polled. The connector is a second path to the same vendor: use it for a one-off read, use the capture script when the answer must land in a file. `REALTIME_OPTIONS` / `HISTORICAL_OPTIONS` are real chains — the desk's own `option-math.ts` is a Black-Scholes model, so a chain read is evidence against it, never a replacement for the oracle grid. |
| SEC filings and filing items, insider trades, institutional holdings, beneficial ownership, segment financials, KPI/non-GAAP/guidance, macro series, interest rates, stock screener | **Financial Datasets** `mcp__501a1b5a-*` (28 tools) | This is the one that fixes a known gap: `news/feed.ts` SEC filings need `SEC_USER_AGENT` because EDGAR 403s anonymous scripts. `get_filings` / `get_filing_items` returns the same material without it. `list_filing_item_types` first, then ask for the item (8-K Item 5.02 is the operator-change flag the News tab wants). Feeds the Invest dossiers, `durability.ts` and the research book. |
| A four-year economic release calendar with exact times; company / ETF / market / sentiment tearsheets; entity search | **Bigdata.com** `mcp__56fb1d10-*` (25 tools) | **`bigdata_events_calendar` is the missing piece CLAUDE.md names by hand**: `exits.ts`'s `event` rule ("close an untrimmed option ≤5 min before a high-impact release") ships as an UNTESTED candidate purely because no four-year release calendar exists in the repo, and `measure-room-ev.mjs` cannot score it. Capture it deterministically into a dated JSON under `src/data/` with `capturedAt` and the source; never transcribe it. Doing that is what promotes the rule from candidate to measured. |
| A primary page, to read a figure or check one | **FireCrawl** `mcp__99c3cf8c-*` / `mcp__e754b7e8-*` (28 each) | `firecrawl_scrape` with `formats: ["json"]` and a schema pulls a stated figure off an agency page; `categories: ["gov"]` on `firecrawl_search` restricts to US federal/state sources (BLS, BEA, Census, Fed). This is the fetcher behind `scripts/check-research-sources.mjs`'s job — use it when that script reports MISSING and a human has to look. A PDF goes through `parsers: ["pdf"]`. |
| A second opinion on a web figure | **Parallel Search** `mcp__c75b7b06-*`, **apify** `mcp__75d67bd3-*`, **Browserbase** `mcp__9d5ad6e1-*` | Leads only. A snippet is never a source (desk-accuracy §1). |

Do NOT use the Alpha Vantage or Financial Datasets connectors inside the scoring loop, a verifier, or anything that runs per poll.
They are capture-time and answer-time tools. The desk stays deterministic: `src/lib/aplus/config.ts` and the gates read committed
files, never a live connector.

## The desk's own infrastructure

- **Supabase** `mcp__5a550ca5-*` — project **nfwuvpsxnxctinywwrgh**. `list_migrations`, `list_tables`, `execute_sql`,
  `get_advisors` (security + performance findings), `query_logs`. Use it to confirm a migration landed, to see whether
  `journal`/`invest_ledger`/`room_snapshot` actually have rows, and to read an error the serverless logs swallowed.
  **Never** write a `DATABASE_URL` containing `db.*.supabase.co` — the IPv6 direct host has silently broken every read twice
  (2026-08-26, 2026-09-30). Pooler only: `aws-0-us-east-1.pooler.supabase.com:6543`.
- **Netlify** `mcp__6de9396c-*` — the deploy target `ledgeyourtrades`. Check deploy status and build logs after a push, and
  confirm an env var is PRESENT. Never read or print a secret's value.
- **scheduled-tasks** `mcp__scheduled-tasks__*` — the gateway's Windows task is installed by `gateway/install-task.ps1`, not here;
  these tools are for Claude-side routines. See [[ledger-desk-gateway-task]].
- **Vercel** `mcp__42a0ce4e-*` is connected but this site runs on **Netlify** — `vercel.json`'s cron entries are vestigial
  (CLAUDE.md says something else must send the `exec-flatten` GET). Do not deploy to Vercel.

## Code and the Floor

- **Context7** `mcp__c4ea2d0f-*` — `resolve-library-id` then `query-docs` for three.js, TanStack Start/Router, Vite, better-auth.
  Use it instead of guessing an API; this repo pins exact versions and a wrong signature costs a build.
- **Blender** `mcp__Blender__*` (26 tools) — **connected and working as of 2026-10-09.** Blender **5.2.2 LTS** at
  `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`, with the official Blender Lab MCP add-on installed and enabled
  (`bl_ext.user_default.mcp`, v1.0.3, from `projects.blender.org/lab/blender_mcp`). It answers only while Blender is RUNNING with
  the server started, on `localhost:9876`.

  To start it:

  ```
  blender.exe --online-mode --python-expr "import bpy; bpy.app.timers.register(lambda: bpy.ops.blmcp.server_start() and None, first_interval=2.0)"
  ```

  `--online-mode` is required (the add-on refuses unless `bpy.app.online_access`), and the operator is `blmcp.server_start` /
  `blmcp.server_stop`. There is no autostart, which is deliberate — see below. Confirm with
  `get_blendfile_summary_path_info`, not by assuming.

  **Security, read before leaving it up.** The add-on was read line by line before install: it has **no outbound network code at
  all** (no `urllib`, `requests`, `httpx`, `urlopen`, `smtplib`) so it cannot phone home on its own, and it binds
  `DEFAULT_HOST = "localhost"` only, never `0.0.0.0`, so nothing off this machine can reach it. `weak_sandbox.py` is honest that
  it is "not really a sandbox" — it blocks `sys.exit` and a few operators, nothing more. **The socket has NO authentication**:
  while it is listening, any local process running as this user can send Python to it and have Blender execute it. So start it for
  the job and stop it after (`blmcp.server_stop`, or just close Blender). Blender's own page says the same in stronger terms:
  it "will execute LLM generated code ... without any guards in place".

  `scripts/blender/build_floor.py` is still the ONLY thing that may write `public/floor/office.glb`, and
  `src/data/floor-layout.json` is the single plan both it and the three.js runtime read — MCP is for inspecting and checking, not
  for hand-editing the model. Verified through MCP on 2026-10-09: the committed GLB is 3.48 MB, **279 objects, 0 lights,
  0 cameras, 90,240 triangles**, 174 materials, and every exact screen node the runtime looks up resolves (including the
  `led_urgency` / `led_urgency_front` prefix trap) — which matches the code map's claims. The `blender-*` and `text-to-blender`
  skills are for driving that session, not for editing `floor-scene.ts`.
- **visualize** `mcp__6f616b42-*` and the **dataviz** skill — for a chart in the reply. The desk's own panels are React and live in
  `src/components/`; do not render a PNG where a component belongs.

## Not for this project

Gmail, Calendar, Drive, Slack, Notion, Airtable, Figma, Canva, Adobe, Stripe, Webflow, Semrush, OpenSEO, Make, Zapier, Windsor.ai,
Shopify, and the bio-research servers are connected but have nothing to do with a futures desk. The `small-business:*`,
`sales:*`, `marketing:*`, `human-resources:*`, `legal:*`, `pigment:*` and `activecampaign:*` skills and servers are noise here —
do not reach for them, and do not report their auth or connection errors as problems with this project.
