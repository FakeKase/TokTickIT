// Actions Taken: the record of work done on a Ticket (Lab 4 api-spec.md §1
// to §3, specification.md BR-01 to BR-11, BR-17, BR-20).

import type { Express, RequestHandler } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  REQUEST_KEY_MESSAGE,
  isRequestKey,
  validateAction,
} from "../lib/action-validation.js";
import { STATUS_LABEL } from "../lib/status-transitions.js";
import { isActiveStatus, type TicketStatusValue } from "../lib/ticket-query.js";
import {
  TICKET_NOT_FOUND,
  parseId,
  resolveTicketFor,
} from "../lib/ticket-access.js";

interface Dependencies {
  prisma: PrismaClient;
  /** Signed in and past the first-login gate, any role. */
  asAnyUser: RequestHandler[];
  /** The same, and IT Staff or Administrator. */
  asStaff: RequestHandler[];
}

const ACTION_NOT_FOUND = { error: "Action Taken not found" };

/** Everything the response carries, and nothing else: a user is an id and a
 *  name here, never an email address or a role. */
const actionSelect = {
  id: true,
  ticketId: true,
  actionAt: true,
  description: true,
  result: true,
  followUpRequired: true,
  followUpNote: true,
  attachmentNotes: true,
  version: true,
  createdAt: true,
  editedAt: true,
  performedBy: { select: { id: true, name: true } },
  editedBy: { select: { id: true, name: true } },
};

interface ActionRow {
  id: number;
  ticketId: number;
  actionAt: Date;
  description: string;
  result: string;
  followUpRequired: boolean;
  followUpNote: string | null;
  attachmentNotes: string | null;
  version: number;
  createdAt: Date;
  editedAt: Date | null;
  performedBy: { id: number; name: string };
  editedBy: { id: number; name: string } | null;
}

/** The response shape for one Action Taken (api-spec.md §1). The same for
 *  every role: a Requester sees every field of the work done on their Ticket. */
const toAction = (action: ActionRow) => ({
  id: action.id,
  ticketId: action.ticketId,
  actionAt: action.actionAt,
  description: action.description,
  result: action.result,
  followUpRequired: action.followUpRequired,
  followUpNote: action.followUpNote,
  attachmentNotes: action.attachmentNotes,
  performedBy: action.performedBy,
  createdAt: action.createdAt,
  editedBy: action.editedBy,
  editedAt: action.editedAt,
  version: action.version,
});

/** BR-08. Names the status, because "not active" sends the reader to look up
 *  what active means and "Resolved" tells them what to do about it. */
const notActive = (status: string) => ({
  error: `This Ticket is ${
    STATUS_LABEL[status as TicketStatusValue] ?? "finished"
  }. Reopen it to record more work.`,
  code: "TICKET_NOT_ACTIVE",
});

type Outcome = { status: number; body: unknown };

export function registerActionsTaken(
  app: Express,
  { prisma, asAnyUser, asStaff }: Dependencies,
) {
  /**
   * The Ticket a write is about, locked until the transaction ends.
   *
   * Every write that the resolution gate depends on takes this lock, and so
   * will the move to Resolved: whichever comes second waits and then reads
   * what the first wrote, so the gate never decides while an Action Taken is
   * half recorded.
   *
   * FOR NO KEY UPDATE, not FOR UPDATE. Postgres checks the foreign key of
   * every comment, note and attachment inserted under this Ticket by taking
   * FOR KEY SHARE on it, and FOR UPDATE conflicts with that, so it would make
   * those inserts queue behind each one of these. This still conflicts with
   * itself, which is all that is needed here.
   */
  type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
  async function lockTicket(tx: Tx, id: number) {
    const [ticket] = await tx.$queryRaw<
      { id: number; currentStatus: string; createdAt: Date }[]
    >`SELECT "id", "currentStatus"::text AS "currentStatus", "createdAt" FROM "Ticket" WHERE "id" = ${id} FOR NO KEY UPDATE`;
    return ticket ?? null;
  }

  /** BR-11: recording work is something happening to the Ticket, so "recently
   *  updated" should notice. Nothing else about the Ticket changes, and in
   *  particular not its version: this is not a workflow change. */
  const touchTicket = (tx: Tx, id: number, at: Date) =>
    tx.ticket.update({ where: { id }, data: { updatedAt: at } });

  // api-spec.md §1 (FR-01, FR-04, BR-04, BR-10).
  app.get(
    "/api/tickets/:id/actions",
    ...asAnyUser,
    async (req: AuthenticatedRequest, res) => {
      try {
        const ticket = await resolveTicketFor(prisma, req.auth!.user, req.params.id);
        if (!ticket) return res.status(404).json(TICKET_NOT_FOUND);

        const actions = await prisma.actionTaken.findMany({
          where: { ticketId: ticket.id },
          // id in the same direction, so two actions dated to the same minute
          // keep one order across reloads (BR-10).
          orderBy: [{ actionAt: "desc" }, { id: "desc" }],
          select: actionSelect,
        });
        res.json(actions.map(toAction));
      } catch {
        res.status(500).json({ error: "Unable to load the Actions Taken" });
      }
    },
  );

  // api-spec.md §2 (FR-02, BR-01 to BR-08, BR-11, BR-20).
  app.post(
    "/api/tickets/:id/actions",
    ...asStaff,
    async (req: AuthenticatedRequest, res) => {
      const user = req.auth!.user;
      const ticketId = parseId(req.params.id);
      if (!ticketId) return res.status(404).json(TICKET_NOT_FOUND);

      const body = (req.body ?? {}) as Record<string, unknown>;
      const requestKey = body.requestKey;

      /** What a second request with a key already in use is answered with. */
      const replay = async (db: Tx | PrismaClient, key: string): Promise<Outcome | null> => {
        const existing = await db.actionTaken.findUnique({
          where: { requestKey: key },
          select: { ...actionSelect, performedById: true },
        });
        if (!existing) return null;
        // The same person sending the same form to the same Ticket again is a
        // retry, and gets what the first attempt created. Anything else is a
        // different request that happens to carry a used key.
        if (existing.ticketId === ticketId && existing.performedById === user.id) {
          return { status: 200, body: toAction(existing) };
        }
        return {
          status: 409,
          body: {
            error: "This request key has already been used",
            code: "REQUEST_KEY_REUSED",
          },
        };
      };

      try {
        const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
          const ticket = await lockTicket(tx, ticketId);
          if (!ticket) return { status: 404, body: TICKET_NOT_FOUND };

          if (!isRequestKey(requestKey)) {
            return {
              status: 400,
              body: {
                error: "Validation failed",
                fields: { requestKey: REQUEST_KEY_MESSAGE },
              },
            };
          }

          // Before the Ticket's status and before the other fields: a retry
          // of a request that succeeded must succeed, even if the Ticket has
          // been resolved since and even if the clock has moved on.
          const repeated = await replay(tx, requestKey);
          if (repeated) return repeated;

          if (!isActiveStatus(ticket.currentStatus)) {
            return { status: 409, body: notActive(ticket.currentStatus) };
          }

          const now = new Date();
          const checked = validateAction(body, {
            ticketCreatedAt: ticket.createdAt,
            now,
          });
          if (!checked.ok) {
            return {
              status: 400,
              body: { error: "Validation failed", fields: checked.fields },
            };
          }

          const created = await tx.actionTaken.create({
            data: {
              ...checked.value,
              requestKey,
              // From the path and the session, whatever the body carries
              // (BR-01, BR-03).
              ticketId: ticket.id,
              performedById: user.id,
            },
            select: actionSelect,
          });
          await touchTicket(tx, ticket.id, now);
          return { status: 201, body: toAction(created) };
        });

        res.status(outcome.status).json(outcome.body);
      } catch (error) {
        // The same key arriving for two different Tickets at once: each
        // request holds its own Ticket's lock, so neither saw the other, and
        // the unique index refused the second. Answer it as the replay check
        // would have, now that the first has committed.
        if ((error as { code?: unknown } | null)?.code === "P2002" && isRequestKey(requestKey)) {
          const repeated = await replay(prisma, requestKey).catch(() => null);
          if (repeated) return res.status(repeated.status).json(repeated.body);
        }
        res.status(500).json({ error: "Unable to record the Action Taken" });
      }
    },
  );

  // api-spec.md §3 (FR-03, BR-08, BR-09, BR-11, BR-17).
  app.patch(
    "/api/tickets/:id/actions/:actionId",
    ...asStaff,
    async (req: AuthenticatedRequest, res) => {
      const user = req.auth!.user;
      const ticketId = parseId(req.params.id);
      if (!ticketId) return res.status(404).json(TICKET_NOT_FOUND);
      const actionId = parseId(req.params.actionId);
      if (!actionId) return res.status(404).json(ACTION_NOT_FOUND);

      const body = (req.body ?? {}) as Record<string, unknown>;

      try {
        const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
          const ticket = await lockTicket(tx, ticketId);
          if (!ticket) return { status: 404, body: TICKET_NOT_FOUND };

          // Looked up through this Ticket, so an action id that belongs to
          // another Ticket is simply not here (BR-01).
          const current = await tx.actionTaken.findFirst({
            where: { id: actionId, ticketId: ticket.id },
            select: actionSelect,
          });
          if (!current) return { status: 404, body: ACTION_NOT_FOUND };

          if (!isActiveStatus(ticket.currentStatus)) {
            return { status: 409, body: notActive(ticket.currentStatus) };
          }

          const expectedVersion = body.expectedVersion;
          if (
            typeof expectedVersion !== "number" ||
            !Number.isInteger(expectedVersion) ||
            expectedVersion < 1
          ) {
            return {
              status: 400,
              body: {
                error: "Validation failed",
                fields: {
                  expectedVersion: "State the version of the Action Taken being edited",
                },
              },
            };
          }

          // BR-17. Before the fields are judged: somebody whose copy is out
          // of date should hear that first, with the row as it now stands,
          // whatever else is wrong with what they sent.
          if (expectedVersion !== current.version) {
            return {
              status: 409,
              body: {
                error: "This Action Taken was changed by someone else.",
                code: "STALE_ACTION",
                current: toAction(current),
              },
            };
          }

          const now = new Date();
          const checked = validateAction(body, {
            ticketCreatedAt: ticket.createdAt,
            now,
          });
          if (!checked.ok) {
            return {
              status: 400,
              body: { error: "Validation failed", fields: checked.fields },
            };
          }

          const updated = await tx.actionTaken.update({
            where: { id: current.id },
            // Only the six entered fields and the edit mark. The Ticket, the
            // performer and the creation time are not in this object, so no
            // body can reach them (BR-09).
            data: {
              ...checked.value,
              version: { increment: 1 },
              editedById: user.id,
              editedAt: now,
            },
            select: actionSelect,
          });
          await touchTicket(tx, ticket.id, now);
          return { status: 200, body: toAction(updated) };
        });

        res.status(outcome.status).json(outcome.body);
      } catch {
        res.status(500).json({ error: "Unable to save the Action Taken" });
      }
    },
  );
}
