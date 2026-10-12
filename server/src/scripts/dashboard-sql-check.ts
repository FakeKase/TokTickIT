import "dotenv/config";
import { createPrismaClient } from "../prisma.js";

/**
 * Counts what the IT Staff Dashboard counts, in SQL written out by hand.
 *
 *   npx tsx src/scripts/dashboard-sql-check.ts sarah.chen@toktickit.test
 *
 * The dashboard's own numbers come from the list's where-builders
 * (Lab 4 BR-24). Checking them against those builders would only show that
 * the code agrees with itself, so nothing here goes through them or through
 * the Prisma models: each number is one SELECT, printed with its result, for
 * `e2e/lab-04/submission-evidence.spec.ts` to set beside the screen
 * (handout Part 5). It reads and writes nothing else.
 */

const ACTIVE = `('NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_REQUESTER', 'REOPENED')`;
const ME = `(SELECT "id" FROM "User" WHERE "email" = $1)`;

const QUERIES: { metric: string; sql: string }[] = [
  {
    metric: "unassigned",
    sql: `SELECT COUNT(*)::int AS n FROM "Ticket" WHERE "ownerId" IS NULL AND "currentStatus" IN ${ACTIVE}`,
  },
  {
    metric: "myTickets",
    sql: `SELECT COUNT(*)::int AS n FROM "Ticket" WHERE "ownerId" = ${ME} AND "currentStatus" IN ${ACTIVE}`,
  },
  {
    metric: "urgent",
    sql: `SELECT COUNT(*)::int AS n FROM "Ticket" WHERE "itPriority" = 'URGENT' AND "currentStatus" IN ${ACTIVE}`,
  },
  {
    // Stored in UTC; "today" is the Bangkok calendar day (BR-25).
    metric: "myActionsToday",
    sql: `SELECT COUNT(*)::int AS n FROM "ActionTaken" WHERE "performedById" = ${ME} AND ("actionAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')::date = (now() AT TIME ZONE 'Asia/Bangkok')::date`,
  },
  ...[
    "NEW",
    "OPEN",
    "IN_PROGRESS",
    "WAITING_FOR_REQUESTER",
    "RESOLVED",
    "CLOSED",
    "REOPENED",
    "CANCELLED",
  ].map((status) => ({
    metric: `status ${status}`,
    sql: `SELECT COUNT(*)::int AS n FROM "Ticket" WHERE "currentStatus" = '${status}'`,
  })),
];

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("usage: dashboard-sql-check.ts <email of the IT Staff user>");

  const prisma = createPrismaClient();
  try {
    const results = [];
    for (const { metric, sql } of QUERIES) {
      const rows = sql.includes("$1")
        ? await prisma.$queryRawUnsafe<{ n: number }[]>(sql, email)
        : await prisma.$queryRawUnsafe<{ n: number }[]>(sql);
      results.push({ metric, sql: sql.replace("$1", `'${email}'`), value: rows[0].n });
    }
    console.log(JSON.stringify(results));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
