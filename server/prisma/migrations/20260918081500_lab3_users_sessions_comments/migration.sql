-- Lab 3: real users, sessions, ticket workflow, and one comment model.
--
-- Written by hand. `prisma migrate dev --create-only` generates DROP TABLE
-- "Requester" / CREATE TABLE "User" for this change and says so itself:
--   "You are about to drop the `Requester` table, which is not empty (5 rows)."
-- That would take every Lab 2 Ticket's owner with it. Renaming in place keeps
-- the rows, the primary keys, and the foreign key on Ticket untouched, which is
-- what makes "no ownership moved" checkable rather than merely asserted
-- (specification.md 7.2, BR-40).

-- 1. Requester becomes User. Postgres repoints "Ticket_requesterId_fkey" at the
--    renamed table automatically; the constraint name Prisma expects is derived
--    from the referencing table and column, so it stays correct.
ALTER TABLE "Requester" RENAME TO "User";
ALTER TABLE "User" RENAME CONSTRAINT "Requester_pkey" TO "User_pkey";
ALTER INDEX "Requester_email_key" RENAME TO "User_email_key";
ALTER SEQUENCE "Requester_id_seq" RENAME TO "User_id_seq";

-- 2. New enums.
CREATE TYPE "Role" AS ENUM ('REQUESTER', 'IT_STAFF', 'ADMINISTRATOR');
CREATE TYPE "ItPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "CommentVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- 3. User gains credentials, a role, and the first-login flag.
--    passwordHash is added nullable, backfilled, then made NOT NULL: an
--    existing row cannot satisfy a NOT NULL column that has no default.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'REQUESTER';
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- bcrypt hash (cost 10) of the documented local development password
-- 'ChangeMe123!' - a fixture, recorded in the README, never a secret. Every
-- migrated Requester can therefore sign in exactly once: mustChangePassword
-- defaults to true above, so BR-02 forces a new password before the
-- application opens (AC-02, E2E-02).
UPDATE "User"
SET "passwordHash" = '$2b$10$fe8LFfUSa4m3GEHfNhCAie1N8lhhYzaHakFptb8bdxFt8KClfeCMq',
    "updatedAt" = "createdAt"
WHERE "passwordHash" IS NULL;

ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "updatedAt" SET NOT NULL;

-- 4. TicketStatus gains the workflow values, appended so NEW keeps position 0
--    and no existing row changes meaning. Postgres sorts a native enum by
--    declaration order, so the sequence below is also the queue's sort order.
ALTER TYPE "TicketStatus" ADD VALUE 'OPEN';
ALTER TYPE "TicketStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "TicketStatus" ADD VALUE 'WAITING_FOR_REQUESTER';
ALTER TYPE "TicketStatus" ADD VALUE 'RESOLVED';
ALTER TYPE "TicketStatus" ADD VALUE 'CLOSED';
ALTER TYPE "TicketStatus" ADD VALUE 'REOPENED';
ALTER TYPE "TicketStatus" ADD VALUE 'CANCELLED';

-- 5. Ticket gains ownership, IT Priority, and the Requester's resolution signal.
--    itPriority takes a temporary default so existing rows can be backfilled
--    from what the Requester asked for (BR-21), then loses it: the application
--    sets the value at creation, and the schema declares no default.
ALTER TABLE "Ticket" ADD COLUMN "ownerId" INTEGER;
ALTER TABLE "Ticket" ADD COLUMN "requesterResolvedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "itPriority" "ItPriority" NOT NULL DEFAULT 'MEDIUM';

UPDATE "Ticket" SET "itPriority" = "requestedPriority"::text::"ItPriority";

ALTER TABLE "Ticket" ALTER COLUMN "itPriority" DROP DEFAULT;

ALTER TABLE "Ticket"
  ADD CONSTRAINT "Ticket_ownerId_fkey" FOREIGN KEY ("ownerId")
  REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Ticket_ownerId_idx" ON "Ticket"("ownerId");
CREATE INDEX "Ticket_currentStatus_idx" ON "Ticket"("currentStatus");

-- 6. Sessions. The token is the primary key: there is nothing else to look it
--    up by, and nothing inside it to decode (BR-09).
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Session_userId_idx" ON "Session"("userId");

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId")
  REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. One table for Public Comments and Internal Notes, separated by visibility,
--    so BR-04 is a single filter tested once (specification.md 11).
CREATE TABLE "TicketComment" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "visibility" "CommentVisibility" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketComment_ticketId_visibility_idx" ON "TicketComment"("ticketId", "visibility");

ALTER TABLE "TicketComment"
  ADD CONSTRAINT "TicketComment_ticketId_fkey" FOREIGN KEY ("ticketId")
  REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TicketComment"
  ADD CONSTRAINT "TicketComment_authorId_fkey" FOREIGN KEY ("authorId")
  REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
