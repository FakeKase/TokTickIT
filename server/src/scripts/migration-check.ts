/**
 * Proves the Lab 3 and Lab 4 migrations preserve the data before them, and
 * that the Lab 4 rollback gives the Lab 3 data back, on a throwaway database.
 *
 * The claim "no Ticket was lost and no ownership moved" is worth nothing as a
 * sentence in a specification. This script rebuilds the Lab 2 schema from its
 * own migrations, fills it with Requesters, Tickets and Attachments, records a
 * fingerprint of who owns what, applies the Lab 3 migration, and compares.
 *
 * It then does the same one sprint on: it adds what only Lab 3 could hold
 * (staff, owners, statuses, comments, a session), fingerprints every row of
 * every table, applies the Lab 4 migration, applies its rollback, and applies
 * it again, comparing at each step (Lab 4 BR-32, AC-46).
 *
 *   npm run db:migration-check
 *
 * It never touches the development database: it creates its own, and drops it
 * again on the way out.
 */
import { execFileSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTAINER = process.env.PG_CONTAINER ?? "toktickit-postgres";
const DB = "toktickit_migration_check";
const LAB3_MIGRATION = "20260918081500_lab3_users_sessions_comments";
const LAB4_MIGRATION = "20261006092420_lab4_actions_taken";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "prisma",
  "migrations",
);

const LAB4_ROLLBACK = path.join(MIGRATIONS_DIR, "..", "rollback", "lab4_down.sql");

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
    [
      "exec",
      "-i",
      CONTAINER,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      // Prisma applies each migration file inside one transaction. Without
      // this, psql runs in autocommit and a file that fails halfway leaves
      // partial state behind - so the check would be exercising something
      // Prisma never does.
      "--single-transaction",
      "-U",
      "postgres",
      "-d",
      DB,
    ],
    { input: sql, encoding: "utf8", stdio: ["pipe", "ignore", "inherit"] },
  );
}

function containerIsRunning(): boolean {
  try {
    const state = execFileSync(
      "docker",
      ["inspect", "-f", "{{.State.Running}}", CONTAINER],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    // A stopped container prints "false" and exits 0, so the exit code alone
    // proves nothing - only the output does.
    return state.trim() === "true";
  } catch {
    return false;
  }
}

if (!containerIsRunning()) {
  console.error(
    `The "${CONTAINER}" container is not running. Start the database first:\n  docker compose up -d`,
  );
  process.exit(1);
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
    // The oid, not the name: a constraint dropped and recreated under the same
    // name would satisfy any check that only counted names.
    foreignKey: psql(`SELECT oid FROM pg_constraint WHERE conname = 'Ticket_requesterId_fkey'`),
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
  // Shape is not usability: a truncated or mangled hash can still start with
  // $2 and measure 60 characters. The only proof is that the documented
  // password actually verifies against what the migration wrote.
  const hashes = psql(`SELECT "passwordHash" FROM "User"`).split("\n").filter(Boolean);
  check(
    "the documented password verifies against every migrated hash",
    hashes.filter((hash) => bcrypt.compareSync("ChangeMe123!", hash)).length,
    hashes.length,
  );
  check("migrated accounts are Requesters", psql(`SELECT count(*) FROM "User" WHERE role <> 'REQUESTER'`), 0);
  check("no Ticket is owned yet", psql(`SELECT count(*) FROM "Ticket" WHERE "ownerId" IS NOT NULL`), 0);
  check("the Requester table is gone", psql(`SELECT to_regclass('public."Requester"') IS NULL`), "t");
  check(
    "the foreign key is the same constraint, not a rebuilt one",
    psql(`SELECT oid FROM pg_constraint WHERE conname = 'Ticket_requesterId_fkey'`),
    before.foreignKey,
  );

  // ---------------------------------------------------------------------
  // Lab 4 (specification.md 7.2, BR-32, AC-46).

  // 5. What only a Lab 3 database could hold: staff, owners, every status,
  //    both kinds of comment, a session. Two Tickets are finished, so the
  //    backfill has something to fill and something to leave alone.
  runFile(`
    INSERT INTO "User" ("name", "email", "passwordHash", "role", "mustChangePassword", "updatedAt") VALUES
      ('Staff Pre', 'staff.pre@toktickit.test', 'x', 'IT_STAFF', false, CURRENT_TIMESTAMP),
      ('Admin Pre', 'admin.pre@toktickit.test', 'x', 'ADMINISTRATOR', false, CURRENT_TIMESTAMP);
    INSERT INTO "Session" ("tokenHash", "userId", "expiresAt")
      SELECT 'pre-migration-session', id, CURRENT_TIMESTAMP + interval '1 hour'
      FROM "User" WHERE email = 'staff.pre@toktickit.test';
    -- Three distinct, older write times, so that a backfill which copied the
    -- wrong column, or the time of the migration, could not pass by accident.
    UPDATE "Ticket" SET
      "currentStatus" = 'RESOLVED', "itPriority" = 'URGENT',
      "ownerId" = (SELECT id FROM "User" WHERE email = 'staff.pre@toktickit.test'),
      "requesterResolvedAt" = TIMESTAMP '2026-09-20 08:00:00',
      "updatedAt" = TIMESTAMP '2026-09-21 09:30:00.123'
      WHERE "ticketNumber" = 'TKT-2026-100001';
    UPDATE "Ticket" SET
      "currentStatus" = 'CLOSED',
      "ownerId" = (SELECT id FROM "User" WHERE email = 'admin.pre@toktickit.test'),
      "updatedAt" = TIMESTAMP '2026-09-25 17:00:00'
      WHERE "ticketNumber" = 'TKT-2026-100002';
    UPDATE "Ticket" SET
      "currentStatus" = 'IN_PROGRESS', "updatedAt" = TIMESTAMP '2026-09-28 11:11:11'
      WHERE "ticketNumber" = 'TKT-2026-100003';
    INSERT INTO "TicketComment" ("ticketId", "authorId", "visibility", "body")
      SELECT t.id, u.id, v.visibility::"CommentVisibility", v.body
      FROM "Ticket" t, "User" u,
        (VALUES ('PUBLIC', 'Written before the Lab 4 migration.'), ('INTERNAL', 'A note from before it.')) AS v(visibility, body)
      WHERE t."ticketNumber" = 'TKT-2026-100001' AND u.email = 'staff.pre@toktickit.test';
  `);

  // Every row of every Lab 3 table, column by column. `to_jsonb(row)` takes
  // whatever columns the table has, so after the migration the two new Ticket
  // columns are subtracted by name to compare like with like. After the
  // rollback nothing is subtracted: the row must be back to exactly this.
  const LAB3_TABLES = ["User", "Session", "Category", "RelatedSystem", "Ticket", "TicketComment", "Attachment"];
  const fingerprint = (table: string, minus = "") =>
    psql(
      `SELECT count(*) || ':' || coalesce(md5(string_agg((to_jsonb(t)${minus})::text, ',' ORDER BY t.id)), 'empty') FROM "${table}" t`,
    );
  const LAB4_TICKET_COLUMNS = ` - 'version' - 'resolvedAt'`;
  const lab3 = Object.fromEntries(LAB3_TABLES.map((table) => [table, fingerprint(table)]));
  const lab3Columns = psql(
    `SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'Ticket'`,
  );
  console.log(
    `\nLab 3 data written: ${LAB3_TABLES.map((table) => `${table} ${lab3[table].split(":")[0]}`).join(", ")}`,
  );

  // Prisma's own record of what has run. The rollback removes its row from
  // here, so the table has to exist for that statement to be exercised.
  runFile(`
    CREATE TABLE "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count")
      VALUES ('lab3', 'x', '${LAB3_MIGRATION}', now(), 1);
  `);

  const lab4Sql = readFileSync(path.join(MIGRATIONS_DIR, LAB4_MIGRATION, "migration.sql"), "utf8");
  const applyLab4 = () => {
    runFile(lab4Sql);
    psql(
      `INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count") VALUES ('lab4', 'x', '${LAB4_MIGRATION}', now(), 1)`,
    );
  };

  /** What must hold whenever the Lab 4 migration is the last thing that ran. */
  const checkMigrated = (when: string) => {
    for (const table of LAB3_TABLES) {
      check(
        `${when}: every ${table} row is unchanged`,
        fingerprint(table, table === "Ticket" ? LAB4_TICKET_COLUMNS : ""),
        lab3[table],
      );
    }
    check(`${when}: every Ticket starts at version 1`, psql(`SELECT count(*) FROM "Ticket" WHERE "version" <> 1`), 0);
    check(`${when}: no Action Taken is invented`, psql(`SELECT count(*) FROM "ActionTaken"`), 0);
    check(
      `${when}: resolvedAt is the last write time for Resolved and Closed`,
      psql(
        `SELECT count(*) FROM "Ticket" WHERE "currentStatus" IN ('RESOLVED','CLOSED') AND "resolvedAt" IS NOT DISTINCT FROM "updatedAt"`,
      ),
      2,
    );
    check(
      `${when}: resolvedAt is empty for every other Ticket`,
      psql(`SELECT count(*) FROM "Ticket" WHERE "currentStatus" NOT IN ('RESOLVED','CLOSED') AND "resolvedAt" IS NOT NULL`),
      0,
    );
  };

  // 6. Forward.
  applyLab4();
  console.log(`\nApplied ${LAB4_MIGRATION}\n`);
  checkMigrated("after the migration");

  // The follow-up rule is a constraint, so it is tried against the database
  // itself (BR-07). Each statement must fail; one that succeeds is counted.
  const rejected = (followUpRequired: boolean, note: string | null) => {
    try {
      psql(
        `INSERT INTO "ActionTaken" ("ticketId", "performedById", "actionAt", "description", "result", "requestKey", "followUpRequired", "followUpNote")
         SELECT t.id, u.id, now(), 'd', 'r', 'check:${followUpRequired}', ${followUpRequired}, ${note === null ? "NULL" : `'${note}'`}
         FROM "Ticket" t, "User" u WHERE u.email = 'staff.pre@toktickit.test' LIMIT 1`,
      );
      return false;
    } catch {
      return true;
    }
  };
  // psql reports the refusal on stderr; it is expected here, so say so first.
  console.log("  (two constraint violations are expected next)");
  check("follow-up required with no note is refused by the database", rejected(true, null), true);
  check("a note with no follow-up required is refused by the database", rejected(false, "stray"), true);
  check("neither refused row was written", psql(`SELECT count(*) FROM "ActionTaken"`), 0);

  // 7. Back. An Action Taken is recorded first: the rollback has to cope
  //    with a table that is in use, which is the only time anyone would run it.
  psql(
    `INSERT INTO "ActionTaken" ("ticketId", "performedById", "actionAt", "description", "result", "requestKey")
     SELECT t.id, u.id, now(), 'Recorded after the migration', 'Lost by the rollback, as documented', 'check:rollback'
     FROM "Ticket" t, "User" u WHERE t."ticketNumber" = 'TKT-2026-100003' AND u.email = 'staff.pre@toktickit.test'`,
  );
  runFile(readFileSync(LAB4_ROLLBACK, "utf8"));
  console.log(`\nApplied the rollback, prisma/rollback/lab4_down.sql\n`);

  for (const table of LAB3_TABLES) {
    check(`after the rollback: every ${table} row is exactly as Lab 3 left it`, fingerprint(table), lab3[table]);
  }
  check(
    "after the rollback: Ticket has its Lab 3 columns and no others",
    psql(
      `SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'Ticket'`,
    ),
    lab3Columns,
  );
  check("after the rollback: the ActionTaken table is gone", psql(`SELECT to_regclass('public."ActionTaken"') IS NULL`), "t");
  check("after the rollback: the new index is gone", psql(`SELECT to_regclass('public."Ticket_updatedAt_idx"') IS NULL`), "t");
  check(
    "after the rollback: Prisma no longer records the Lab 4 migration",
    psql(`SELECT string_agg("migration_name", ',') FROM "_prisma_migrations"`),
    LAB3_MIGRATION,
  );

  // 8. Forward again, as `prisma migrate deploy` would after a rollback.
  applyLab4();
  console.log(`\nApplied ${LAB4_MIGRATION} again\n`);
  checkMigrated("after re-applying");
} finally {
  psql(`DROP DATABASE IF EXISTS "${DB}"`, "postgres");
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(
  "\nAll migration checks passed: Lab 2 data survives the Lab 3 migration, and Lab 3 data survives the Lab 4 migration, its rollback, and applying it again.",
);
