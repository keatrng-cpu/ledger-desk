#!/usr/bin/env node
/**
 * Seal the attestation chain to an external clock.
 *
 * THE PROBLEM THIS SOLVES
 * A hash chain proves that the record has not been edited SINCE it was
 * written. It does not prove WHEN it was written — whoever holds the database
 * can rebuild the whole chain from genesis with backdated timestamps and the
 * result verifies perfectly. Internal consistency is not evidence.
 *
 * THE FIX
 * Publish the tip hash somewhere the trader does not control the clock. This
 * script appends one line to attestations/SEALS.log; committing and pushing
 * that file gets the hash a server-side timestamp from GitHub for free. After
 * the push, every trade recorded before that seal is pinned: altering any of
 * them changes the tip, and the old tip is already sitting in a public commit
 * with somebody else's date on it.
 *
 * WHAT A SEAL DOES NOT CLAIM
 * It does not claim the trades were profitable, or real, or executed at the
 * prices stated. It claims exactly one thing: this set of records existed, in
 * this form, no later than this date. Everything else is what the broker
 * statements are for. Do not overstate it — that is how a genuine record
 * becomes a misrepresentation.
 *
 * Run: node scripts/seal-chain.mjs [--user <id>] [--check]
 *   --check  verify and report only; write nothing.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const sealDir = join(repoRoot, "attestations");
const sealPath = join(sealDir, "SEALS.log");

const { verifyChain, sealTip } = await import("../src/lib/journal/attest.ts");

/* ── args ─────────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const userIdx = args.indexOf("--user");
const wantedUser = userIdx >= 0 ? args[userIdx + 1] : null;

/* ── connection ───────────────────────────────────────────────────────────── */

const URL_VARS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "SUPABASE_DATABASE_URL",
  "NETLIFY_DATABASE_URL",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL_UNPOOLED",
];

let databaseUrl = null;
for (const name of URL_VARS) {
  if (process.env[name]) {
    databaseUrl = process.env[name];
    break;
  }
}
if (!databaseUrl) {
  console.error(
    `No database URL found. Set one of: ${URL_VARS.join(", ")}\n` +
      "A seal must come from the real journal — there is nothing to seal without it.",
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 20_000 });
const client = await pool.connect();

let exitCode = 0;
try {
  /* ── which users have a chain ───────────────────────────────────────────── */

  const users = wantedUser
    ? [{ user_id: wantedUser }]
    : (
        await client.query(
          "select distinct user_id from desk_attestations order by user_id",
        )
      ).rows;

  if (!users.length) {
    console.log("No attestation links yet — nothing to seal.");
    console.log("The chain starts at the first recorded trade.");
    process.exit(0);
  }

  const written = [];

  for (const { user_id: userId } of users) {
    const { rows } = await client.query(
      `select seq::int as seq, user_id, trade_id, event,
              to_char(recorded_at at time zone 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as recorded_at,
              body, body_hash, prev_hash, hash
         from desk_attestations
        where user_id = $1
        order by seq`,
      [userId],
    );

    const verdict = verifyChain(rows);
    console.log(`\nuser ${userId}`);
    console.log(`  links       ${rows.length}`);

    if (!verdict.ok) {
      console.error(`  CHAIN BROKEN at link ${verdict.brokenAt}`);
      console.error(`  ${verdict.reason}`);
      console.error(
        "\n  Refusing to seal. A seal over a broken chain would publish a hash\n" +
          "  that asserts integrity the record does not have — worse than no seal.",
      );
      exitCode = 1;
      continue;
    }

    // Gaps are not a failure, but they must be stated. A record that is
    // incomplete and says so is honest; one that looks complete is not.
    const gaps = await client.query(
      `select count(*)::int as n
         from desk_trades t
         left join desk_attestations a
                on a.user_id = t.user_id and a.trade_id = t.id
        where t.user_id = $1 and a.trade_id is null`,
      [userId],
    );
    const unsealed = gaps.rows[0]?.n ?? 0;

    console.log(`  verified    ${verdict.checked} links, chain intact`);
    console.log(`  tip         ${verdict.tip}`);
    if (unsealed > 0) {
      console.log(`  UNSEALED    ${unsealed} trade(s) have no link — see findUnattestedTrades()`);
    }

    const seal = sealTip(rows);
    if (!seal) continue;

    const line = `${seal.sealedAt} user=${userId} n=${seal.count} unsealed=${unsealed} tip=${seal.tip}`;

    if (checkOnly) {
      console.log(`  would append: ${line}`);
      continue;
    }

    // Idempotent: sealing twice with no new links appends nothing, so a cron
    // or a habit of running this every session does not pad the log.
    let existing = "";
    if (existsSync(sealPath)) existing = await readFile(sealPath, "utf8");
    if (existing.includes(`tip=${seal.tip}`)) {
      console.log("  tip already sealed — no new links since the last seal.");
      continue;
    }

    if (!existsSync(sealDir)) await mkdir(sealDir, { recursive: true });
    const header = existing
      ? ""
      : [
          "# Attestation seals — ledger-desk",
          "#",
          "# Each line pins the trade record's hash-chain tip to a public,",
          "# third-party timestamp: the moment GitHub received the commit that",
          "# added the line. A trade recorded before a given seal cannot be",
          "# altered afterwards without breaking a hash that is already public.",
          "#",
          "# A seal asserts ONE thing: these records existed, in this form, no",
          "# later than this date. It asserts nothing about whether the trades",
          "# were profitable or executed as stated — broker statements do that.",
          "#",
          "# Verify: node scripts/seal-chain.mjs --check",
          "#",
          "# <sealedAt> user=<id> n=<links> unsealed=<trades without a link> tip=<sha256>",
          "",
        ].join("\n");

    await writeFile(sealPath, `${header}${existing}${line}\n`, "utf8");
    written.push(line);
    console.log(`  sealed      ${seal.tip.slice(0, 16)}…`);
  }

  if (written.length) {
    console.log(
      `\nWrote ${written.length} seal line(s) to attestations/SEALS.log.\n` +
        "The seal is worthless until it is public — the external clock IS the anchor:\n",
    );
    console.log("  git add attestations/SEALS.log");
    console.log('  git commit -m "attest: seal chain tip"');
    console.log("  git push\n");
  }
} finally {
  client.release();
  await pool.end();
}

process.exit(exitCode);
