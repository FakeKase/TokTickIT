import "dotenv/config";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPrismaClient } from "../prisma.js";

/**
 * Removes the Tickets and Attachments the Playwright suite creates.
 *
 * Without this, every run leaves its fixtures behind and the demo database
 * fills with near-identical rows — which then show up in the very screenshots
 * the suite exists to produce.
 *
 * Matches on the marker the e2e helper writes into every description, so a
 * Ticket created by hand during a demo is never touched.
 */
const MARKER = "Lab 2 walkthrough";

const UPLOADS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "uploads",
);

async function main() {
  const prisma = createPrismaClient();
  const where = { description: { contains: MARKER } };

  const doomed = await prisma.attachment.findMany({
    where: { ticket: where },
    select: { storedFilename: true },
  });

  const attachments = await prisma.attachment.deleteMany({ where: { ticket: where } });
  // Comments hold a RESTRICT foreign key to their Ticket, the same as
  // Attachments do, so they have to go first. Without this the whole teardown
  // throws the moment a spec posts a comment - which Lab 3's specs will.
  const comments = await prisma.ticketComment.deleteMany({ where: { ticket: where } });
  const tickets = await prisma.ticket.deleteMany({ where });

  // The rows are gone, so nothing can reach these files any more.
  for (const { storedFilename } of doomed) {
    await unlink(path.join(UPLOADS_DIR, storedFilename)).catch(() => {});
  }

  console.log(
    `e2e cleanup: removed ${tickets.count} tickets, ${attachments.count} attachments, ${comments.count} comments, ${doomed.length} files`,
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  // Never fail the run over cleanup — the tests already reported their result.
  console.error("e2e cleanup failed (non-fatal):", error);
});
