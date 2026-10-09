import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import type { Role } from "../../src/generated/prisma/enums.js";
import type { TicketStatusValue } from "../../src/lib/ticket-query.js";
import { fixtureUser } from "../helpers/users.js";

/** Text no response may carry (BR-28). Each is unique enough to search for. */
export const SECRET_DESCRIPTION = "ticket-description-that-must-not-leak";
export const SECRET_COMMENT = "public-comment-that-must-not-leak";
export const SECRET_NOTE = "internal-note-that-must-not-leak";

export interface TicketFixture {
  requesterId: number;
  status?: TicketStatusValue;
  ownerId?: number | null;
  itPriority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  updatedAt?: Date;
  resolvedAt?: Date | null;
  createdAt?: Date;
  summary?: string;
}

/**
 * Users, Tickets and Actions Taken for the dashboard tests, all traceable to
 * one tag so a file removes exactly what it made and nothing else.
 */
export function dashboardFixtures(prisma: PrismaClient, tag: string) {
  const email = (who: string) => `${who}.${tag}@toktickit.test`;
  const mine = { email: { contains: tag } };
  let references: { categoryId: number; relatedSystemId: number } | undefined;

  async function refs() {
    references ??= {
      categoryId: (await prisma.category.findFirstOrThrow()).id,
      relatedSystemId: (await prisma.relatedSystem.findFirstOrThrow()).id,
    };
    return references;
  }

  const ticketData = (fixture: TicketFixture, ids: Awaited<ReturnType<typeof refs>>) => ({
    ticketNumber: `TKT-TEST-${randomUUID()}`,
    requesterId: fixture.requesterId,
    ownerId: fixture.ownerId ?? null,
    ...ids,
    summary: fixture.summary ?? `Dashboard fixture ${tag}`,
    description: SECRET_DESCRIPTION,
    requestedPriority: "MEDIUM" as const,
    itPriority: fixture.itPriority ?? ("MEDIUM" as const),
    currentStatus: fixture.status ?? ("NEW" as const),
    resolvedAt: fixture.resolvedAt ?? null,
    createdAt: fixture.createdAt ?? new Date("2026-09-01T00:00:00.000Z"),
    ...(fixture.updatedAt ? { updatedAt: fixture.updatedAt } : {}),
  });

  return {
    email,

    user: (who: string, role: Role = "REQUESTER", isActive = true) =>
      prisma.user.create({
        data: fixtureUser({ name: `${who} ${tag}`, email: email(who), role, isActive }),
      }),

    ticket: async (fixture: TicketFixture) =>
      prisma.ticket.create({ data: ticketData(fixture, await refs()) }),

    tickets: async (fixtures: TicketFixture[]) => {
      const ids = await refs();
      await prisma.ticket.createMany({ data: fixtures.map((fixture) => ticketData(fixture, ids)) });
    },

    action: (
      ticketId: number,
      performedById: number,
      actionAt: Date,
      overrides: { description?: string; followUpRequired?: boolean } = {},
    ) =>
      prisma.actionTaken.create({
        data: {
          ticketId,
          performedById,
          actionAt,
          description: overrides.description ?? "Checked the cable.",
          result: "Recorded for the dashboard test.",
          followUpRequired: overrides.followUpRequired ?? false,
          followUpNote: overrides.followUpRequired ? "Come back tomorrow." : null,
          requestKey: randomUUID(),
        },
      }),

    /** Removes every row this tag made, children first. */
    remove: async () => {
      const onMine = { ticket: { requester: mine } };
      await prisma.actionTaken.deleteMany({ where: { OR: [onMine, { performedBy: mine }] } });
      await prisma.ticketComment.deleteMany({ where: onMine });
      await prisma.ticket.deleteMany({ where: { requester: mine } });
      await prisma.user.deleteMany({ where: mine });
    },
  };
}
