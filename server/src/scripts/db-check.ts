import { prisma } from "../prisma.js";

// Verifies the Issue 1 acceptance criterion "PostgreSQL is reachable and
// Prisma is initialized" without depending on any model existing yet.
async function main() {
  const [row] = await prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
  console.log("PostgreSQL reachable via Prisma:");
  console.log(row.version);
}

main()
  .catch((error) => {
    console.error("Database check failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
