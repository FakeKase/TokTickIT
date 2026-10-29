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
 *
 * Lab 3's specs also create users. Those are found by a reserved email
 * domain, which no seeded or hand-made account uses, and a spec asserts this
 * script and the helper agree on it.
 */
const MARKER = "TokTickIT walkthrough";
const USER_DOMAIN = "@e2e.toktickit.test";

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
  // Actions Taken restrict the deletion of their Ticket in the same way
  // (Lab 4), so they go before it too.
  const actions = await prisma.actionTaken.deleteMany({ where: { ticket: where } });
  const tickets = await prisma.ticket.deleteMany({ where });

  // Users the suite created. A deleted user cannot be left as an author or an
  // owner, so what they wrote goes and what they owned is handed back first.
  // They file no Tickets of their own: every fixture Ticket is filed by a
  // seeded Requester and carries the marker above.
  const fixtureUser = { email: { endsWith: USER_DOMAIN } };
  await prisma.ticketComment.deleteMany({ where: { author: fixtureUser } });
  // The same for work they recorded. An action they only edited belongs to
  // somebody who is staying, so it is kept and loses its edit mark, both
  // halves together: an edit time with no editor is not a state the
  // application ever writes.
  await prisma.actionTaken.deleteMany({ where: { performedBy: fixtureUser } });
  await prisma.actionTaken.updateMany({
    where: { editedBy: fixtureUser },
    data: { editedById: null, editedAt: null },
  });
  await prisma.ticket.updateMany({ where: { owner: fixtureUser }, data: { ownerId: null } });
  await prisma.session.deleteMany({ where: { user: fixtureUser } });
  const users = await prisma.user.deleteMany({ where: fixtureUser });

  // The rows are gone, so nothing can reach these files any more.
  for (const { storedFilename } of doomed) {
    await unlink(path.join(UPLOADS_DIR, storedFilename)).catch(() => {});
  }

  console.log(
    `e2e cleanup: removed ${tickets.count} tickets, ${attachments.count} attachments, ${comments.count} comments, ${actions.count} actions taken, ${doomed.length} files, ${users.count} users`,
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  // Never fail the run over cleanup — the tests already reported their result.
  console.error("e2e cleanup failed (non-fatal):", error);
});
