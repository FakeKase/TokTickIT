-- Undoes prisma/migrations/20261006092420_lab4_actions_taken.
--
-- Kept outside prisma/migrations so that Prisma never runs it. Apply it by
-- hand, in one transaction, after taking a dump. The exact commands are in
-- the README under "Rolling back the Lab 4 migration".
--
-- What is lost: every Action Taken recorded since the migration, each
-- Ticket's version, and each Ticket's resolution time. Nothing from Labs 1 to
-- 3 is touched. `npm run db:migration-check` applies this file to a throwaway
-- database and proves that.

DROP INDEX "Ticket_updatedAt_idx";
DROP TABLE "ActionTaken";
ALTER TABLE "Ticket" DROP COLUMN "resolvedAt";
ALTER TABLE "Ticket" DROP COLUMN "version";

-- So that `prisma migrate deploy` sees the migration as not yet applied and
-- can run it again.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261006092420_lab4_actions_taken';
