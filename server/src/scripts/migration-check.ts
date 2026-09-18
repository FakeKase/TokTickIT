/**
 * Proves the Lab 3 migration preserves Lab 2 data, on a throwaway database.
 *
 * The claim "no Ticket was lost and no ownership moved" is worth nothing as a
 * sentence in a specification. This script rebuilds the Lab 2 schema from its
 * own migrations, fills it with Requesters, Tickets and Attachments, records a
 * fingerprint of who owns what, applies the Lab 3 migration, and compares.
 *
 *   npm run db:migration-check
 *
 * It never touches the development database: it creates its own, and drops it
 * again on the way out.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTAINER = process.env.PG_CONTAINER ?? "toktickit-postgres";
const DB = "toktickit_migration_check";
const LAB3_MIGRATION = "20260918081500_lab3_users_sessions_comments";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "prisma",
  "migrations",
);

function psql(sql: string, database = DB): string {
  return execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", database, "-tAc", sql],
    { encoding: "utf8" },
  ).trim();
}

function runFile(sql: string) {
  execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DB],
    { input: sql, encoding: "utf8", stdio: ["pipe", "ignore", "inherit"] },
  );
}

const failures: string[] = [];
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
  if (!ok) failures.push(label);
}

try {
  psql(`DROP DATABASE IF EXISTS "${DB}"`, "postgres");
  psql(`CREATE DATABASE "${DB}"`, "postgres");

  // 1. The Lab 1 + Lab 2 schema, from the migrations that built it.
  const applied = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name !== "migration_lock.toml" && name < LAB3_MIGRATION)
    .sort();
  for (const name of applied) {
    runFile(readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"));
  }
  console.log(`Lab 2 schema rebuilt from ${applied.length} migrations`);

  // 2. Lab 2 data: two Requesters, three Tickets, two Attachments.
  runFile(`
    INSERT INTO "Category" ("name", "description") VALUES ('Hardware', 'Equipment');
    INSERT INTO "RelatedSystem" ("name") VALUES ('Corporate Laptop');
    INSERT INTO "Requester" ("name", "email") VALUES
      ('Alice Pre', 'alice.pre@toktickit.test'),
      ('Bob Pre', 'bob.pre@toktickit.test');
    INSERT INTO "Ticket"
      ("ticketNumber", "requesterId", "categoryId", "relatedSystemId", "summary", "description", "requestedPriority", "updatedAt")
    SELECT
      'TKT-2026-10000' || g,
      CASE WHEN g <= 2 THEN (SELECT id FROM "Requester" WHERE email = 'alice.pre@toktickit.test')
           ELSE (SELECT id FROM "Requester" WHERE email = 'bob.pre@toktickit.test') END,
      (SELECT id FROM "Category" LIMIT 1),
      (SELECT id FROM "RelatedSystem" LIMIT 1),
      'Pre-migration ticket ' || g,
      'Created before the Lab 3 migration ran.',
      (ARRAY['LOW','MEDIUM','HIGH'])[g]::"RequestedPriority",
      CURRENT_TIMESTAMP
    FROM generate_series(1, 3) g;
    INSERT INTO "Attachment" ("ticketId", "originalFilename", "storedFilename", "mimeType", "sizeBytes")
    SELECT id, 'evidence.png', 'stored-' || id || '.png', 'image/png', 1024 FROM "Ticket" LIMIT 2;
  `);

  const OWNERSHIP =
    `SELECT md5(string_agg(t."ticketNumber" || ':' || r.email || ':' || t."requestedPriority", ',' ORDER BY t.id)) FROM "Ticket" t JOIN "%TABLE%" r ON r.id = t."requesterId"`;

  const before = {
    tickets: psql(`SELECT count(*) FROM "Ticket"`),
    attachments: psql(`SELECT count(*) FROM "Attachment"`),
    people: psql(`SELECT count(*) FROM "Requester"`),
    ownership: psql(OWNERSHIP.replace("%TABLE%", "Requester")),
  };
  console.log(`Lab 2 data written: ${before.people} requesters, ${before.tickets} tickets, ${before.attachments} attachments`);
  console.log(`Ownership fingerprint before: ${before.ownership}`);

  // 3. The migration under test.
  runFile(readFileSync(path.join(MIGRATIONS_DIR, LAB3_MIGRATION, "migration.sql"), "utf8"));
  console.log(`\nApplied ${LAB3_MIGRATION}\n`);

  // 4. What has to still be true afterwards (BR-40, AC-15).
  check("tickets survive", psql(`SELECT count(*) FROM "Ticket"`), before.tickets);
  check("attachments survive", psql(`SELECT count(*) FROM "Attachment"`), before.attachments);
  check("people survive the rename", psql(`SELECT count(*) FROM "User"`), before.people);
  check(
    "ownership fingerprint unchanged",
    psql(OWNERSHIP.replace("%TABLE%", "User")),
    before.ownership,
  );
  check(
    "itPriority backfilled from requestedPriority (BR-21)",
    psql(`SELECT count(*) FROM "Ticket" WHERE "itPriority"::text <> "requestedPriority"::text`),
    0,
  );
  check(
    "every migrated account must change its password (BR-02)",
    psql(`SELECT count(*) FROM "User" WHERE "mustChangePassword" IS NOT TRUE`),
    0,
  );
  check(
    "every migrated account has a usable bcrypt hash",
    psql(`SELECT count(*) FROM "User" WHERE "passwordHash" NOT LIKE '$2%' OR length("passwordHash") <> 60`),
    0,
  );
  check("migrated accounts are Requesters", psql(`SELECT count(*) FROM "User" WHERE role <> 'REQUESTER'`), 0);
  check("no Ticket is owned yet", psql(`SELECT count(*) FROM "Ticket" WHERE "ownerId" IS NOT NULL`), 0);
  check("the Requester table is gone", psql(`SELECT to_regclass('public."Requester"') IS NULL`), "t");
  check(
    "the foreign key was never rebuilt",
    psql(`SELECT count(*) FROM pg_constraint WHERE conname = 'Ticket_requesterId_fkey'`),
    1,
  );
} finally {
  psql(`DROP DATABASE IF EXISTS "${DB}"`, "postgres");
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nAll migration checks passed: Lab 2 data survives the Lab 3 migration intact.");
