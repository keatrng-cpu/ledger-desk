/**
 * Verification for the attestation chain (src/lib/journal/attest.ts +
 * migrations/0013_attestation.sql).
 *
 * Two halves, because the guarantee has two halves:
 *   1. The PURE half — canonicalisation is deterministic and the chain
 *      actually detects every class of edit. Run on synthetic trades.
 *   2. The DATABASE half — the migration applies (plpgsql is available in
 *      PGLite, which nothing else in migrations/ has relied on before) and
 *      the append-only trigger and anti-fork index really do refuse.
 *
 * Run: npx tsx scripts/verify-attestation.mjs
 */

const {
  canonicalize,
  attestedBody,
  bodyHash,
  buildLink,
  verifyChain,
  sealTip,
  GENESIS_HASH,
} = await import("../src/lib/journal/attest.ts");

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const a = typeof actual === "object" ? JSON.stringify(actual) : actual;
  const e = typeof expected === "object" ? JSON.stringify(expected) : expected;
  if (a === e) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}\n         expected: ${e}\n         actual:   ${a}`);
  }
}

function truthy(label, actual) {
  if (actual) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} (expected truthy, got ${actual})`);
  }
}

/* ── 1. Canonicalisation ─────────────────────────────────────────────────── */

console.log("\ncanonical JSON (RFC 8785)");

check("keys sort regardless of insertion order", canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
check("nested objects sort too", canonicalize({ z: { y: 1, x: 2 } }), '{"z":{"x":2,"y":1}}');
check("arrays keep order", canonicalize([3, 1, 2]), "[3,1,2]");
check("null is preserved", canonicalize({ a: null }), '{"a":null}');
check("undefined members are dropped", canonicalize({ a: undefined, b: 1 }), '{"b":1}');
check("negative zero normalises to 0", canonicalize(-0), "0");
check("integers have no decimal point", canonicalize(24180), "24180");
check("fractions round-trip shortest", canonicalize(0.1), "0.1");
check("strings are escaped", canonicalize('a"b'), '"a\\"b"');

let threw = false;
try {
  canonicalize(Number.NaN);
} catch {
  threw = true;
}
truthy("NaN is rejected rather than silently becoming null", threw);

/* ── 2. Determinism of the attested body ─────────────────────────────────── */

console.log("\nattested body determinism");

const baseTrade = {
  id: "t-001",
  user_id: "u-1",
  mode: "live",
  source: "desk",
  symbol: "MNQ",
  side: "short",
  status: "closed",
  opened_at: "2026-09-18T13:47:00.000Z",
  closed_at: "2026-09-18T14:12:00.000Z",
  entry: 24180.25,
  stop: 24255.5,
  target: 24030,
  exit: 24030,
  contracts: 1,
  pnl: 300.5,
  r: 2,
  commission: 1.24,
  slippage: 0.25,
  grade: "A+",
  prescore: 0.93,
  killzone: "ny-am",
  reason: "sweep of PDH into premium, MSS on 5m, IFVG retrace",
};

const h1 = bodyHash(attestedBody(baseTrade));
const reordered = Object.fromEntries(Object.entries(baseTrade).reverse());
check("key order in the source row does not change the hash", bodyHash(attestedBody(reordered)), h1);

const dateTyped = { ...baseTrade, opened_at: new Date(baseTrade.opened_at) };
check("Date object hashes the same as its ISO string", bodyHash(attestedBody(dateTyped)), h1);

const offsetTz = { ...baseTrade, opened_at: "2026-09-18T09:47:00.000-04:00" };
check("equivalent instant in another timezone hashes the same", bodyHash(attestedBody(offsetTz)), h1);

const extraField = { ...baseTrade, some_ui_only_column: "whatever" };
check("a non-attested column does not change the hash", bodyHash(attestedBody(extraField)), h1);

const movedStop = { ...baseTrade, exit: 24035 };
truthy("changing an attested value DOES change the hash", bodyHash(attestedBody(movedStop)) !== h1);

/* ── 3. Chain construction and tamper detection ──────────────────────────── */

console.log("\nchain integrity");

function buildChain(trades) {
  const rows = [];
  let prev = GENESIS_HASH;
  let seq = 1;
  for (const [trade, event] of trades) {
    const link = buildLink(trade, event, prev, Date.parse(trade.opened_at) + seq * 1000);
    rows.push({ seq: seq++, ...link });
    prev = link.hash;
  }
  return rows;
}

const t2 = { ...baseTrade, id: "t-002", pnl: -37.5, r: -1, grade: "A", exit: 24255.5 };
const t3 = { ...baseTrade, id: "t-003", pnl: 112.5, r: 1.5, grade: "A-" };

const chain = buildChain([
  [baseTrade, "open"],
  [baseTrade, "close"],
  [t2, "open"],
  [t2, "close"],
  [t3, "open"],
  [t3, "close"],
]);

check("chain length", chain.length, 6);
check("first link points at genesis", chain[0].prev_hash, GENESIS_HASH);
check("intact chain verifies", verifyChain(chain).ok, true);
check("intact chain reports every link checked", verifyChain(chain).checked, 6);
check("tip is the last link's hash", verifyChain(chain).tip, chain[5].hash);

// The scenario the whole file exists for: quietly turning a loser into a winner.
const doctored = chain.map((r) => ({ ...r, body: { ...r.body } }));
doctored[3].body.pnl = 300;
doctored[3].body.r = 2;
const doctoredVerdict = verifyChain(doctored);
check("editing a loser's body is caught", doctoredVerdict.ok, false);
check("...and is blamed on the right link", doctoredVerdict.brokenAt, 4);
truthy("...with a reason naming the body", /body was altered/.test(doctoredVerdict.reason));

// Deleting a link outright.
const deleted = chain.filter((r) => r.seq !== 4);
const deletedVerdict = verifyChain(deleted);
check("removing a losing trade is caught", deletedVerdict.ok, false);
check("...at the link that followed it", deletedVerdict.brokenAt, 5);
truthy("...as a broken predecessor", /prev_hash mismatch/.test(deletedVerdict.reason));

// Recomputing the body hash without recomputing the link (the naive forge).
const halfForged = chain.map((r) => ({ ...r, body: { ...r.body } }));
halfForged[3].body.pnl = 300;
halfForged[3].body_hash = bodyHash(halfForged[3].body);
const halfVerdict = verifyChain(halfForged);
check("patching body_hash too is still caught", halfVerdict.ok, false);
check("...at the same link", halfVerdict.brokenAt, 4);
truthy("...by the link hash", /link hash mismatch/.test(halfVerdict.reason));

// Reordering.
const swapped = [chain[0], chain[2], chain[1], chain[3], chain[4], chain[5]].map((r, i) => ({
  ...r,
  seq: i + 1,
}));
check("reordering links is caught", verifyChain(swapped).ok, false);

// An untouched prefix must still verify — a break must not retroactively
// invalidate history that is genuinely intact, or the record becomes useless
// after its first correction.
check("the intact prefix before a break still verifies", verifyChain(chain.slice(0, 3)).ok, true);

/* ── 4. Sealing ──────────────────────────────────────────────────────────── */

console.log("\nsealing");

const seal = sealTip(chain, Date.parse("2026-09-18T21:00:00.000Z"));
truthy("a valid chain produces a seal", seal !== null);
check("seal carries the tip", seal.tip, chain[5].hash);
check("seal counts the links", seal.count, 6);
truthy("seal line is one line", !seal.line.includes("\n"));
truthy("seal line contains the tip", seal.line.includes(chain[5].hash));
check("a broken chain refuses to seal", sealTip(doctored), null);
check("an empty chain has no tip to seal", sealTip([]), null);

/* ── 5. Database enforcement ─────────────────────────────────────────────── */

console.log("\ndatabase (PGLite)");

const { PGlite } = await import("@electric-sql/pglite");
const { readFileSync, readdirSync } = await import("node:fs");
const { join } = await import("node:path");

const pg = new PGlite();
await pg.waitReady;

const migrationsDir = join(process.cwd(), "migrations");
let applied = 0;
let migrationError = null;
for (const name of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
  try {
    await pg.exec(readFileSync(join(migrationsDir, name), "utf8"));
    applied++;
  } catch (err) {
    migrationError = `${name}: ${err.message}`;
    break;
  }
}
check("every migration applies (plpgsql trigger included)", migrationError, null);
truthy(`applied ${applied} migrations`, applied > 0);

async function insertLink(row) {
  await pg.query(
    `insert into desk_attestations
       (user_id, trade_id, event, recorded_at, body, body_hash, prev_hash, hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      row.user_id,
      row.trade_id,
      row.event,
      row.recorded_at,
      JSON.stringify(row.body),
      row.body_hash,
      row.prev_hash,
      row.hash,
    ],
  );
}

for (const row of chain) await insertLink(row);
const counted = await pg.query("select count(*)::int as n from desk_attestations");
check("chain persists", counted.rows[0].n, 6);

// Round-trip: what comes back out of jsonb must still verify. This is the
// step that catches a storage layer quietly changing numbers or key order.
const readBack = await pg.query(
  `select seq::int as seq, user_id, trade_id, event,
          to_char(recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as recorded_at,
          body, body_hash, prev_hash, hash
     from desk_attestations order by seq`,
);
check("chain read back from Postgres still verifies", verifyChain(readBack.rows).ok, true);

async function expectRefusal(label, sql) {
  try {
    await pg.query(sql);
    fail++;
    console.log(`  FAIL ${label} (statement was ACCEPTED)`);
  } catch {
    pass++;
    console.log(`  ok   ${label}`);
  }
}

await expectRefusal(
  "UPDATE is refused",
  "update desk_attestations set body_hash = repeat('a', 64) where seq = 4",
);
await expectRefusal("DELETE is refused", "delete from desk_attestations where seq = 4");
await expectRefusal(
  "a forked chain is refused (duplicate prev_hash)",
  `insert into desk_attestations
     (user_id, trade_id, event, recorded_at, body, body_hash, prev_hash, hash)
   values ('u-1', 't-999', 'open', now(), '{}'::jsonb,
           repeat('b', 64), '${chain[3].prev_hash}', repeat('c', 64))`,
);
await expectRefusal(
  "a non-hex hash is refused",
  `insert into desk_attestations
     (user_id, trade_id, event, recorded_at, body, body_hash, prev_hash, hash)
   values ('u-1', 't-998', 'open', now(), '{}'::jsonb,
           'not-a-hash', repeat('d', 64), repeat('e', 64))`,
);
await expectRefusal(
  "an unknown event type is refused",
  `insert into desk_attestations
     (user_id, trade_id, event, recorded_at, body, body_hash, prev_hash, hash)
   values ('u-1', 't-997', 'fabricate', now(), '{}'::jsonb,
           repeat('f', 64), repeat('0', 63) || '1', repeat('a', 63) || '2')`,
);

// A second user's chain is independent — it starts at genesis of its own.
const otherUser = buildChain([[{ ...baseTrade, user_id: "u-2", id: "o-1" }, "open"]]);
await insertLink(otherUser[0]);
const u2 = await pg.query(
  "select count(*)::int as n from desk_attestations where user_id = 'u-2'",
);
check("a second user keeps a separate chain from genesis", u2.rows[0].n, 1);

await pg.close();

/* ── Result ──────────────────────────────────────────────────────────────── */

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
