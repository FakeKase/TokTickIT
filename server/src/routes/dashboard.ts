// The two dashboards (Lab 4 api-spec.md §8 and §9, specification.md §5.3,
// BR-21 to BR-29).
//
// Nothing is stored: every number is counted when it is asked for (BR-21).
// A count that has a drill-down is counted through the list's own parser and
// where-builder, from the very query string the response hands the client, so
// the number on a card and the total of the list behind it are one query
// written once (BR-24).

import type { Express, RequestHandler } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  DASHBOARD_TIME_ZONE,
  bangkokLastDaysStart,
  bangkokToday,
} from "../lib/bangkok-day.js";
import type { Tx } from "../lib/ticket-access.js";
import {
  TICKET_STATUSES,
  parseStaffQueueQuery,
  parseTicketQuery,
  queryFromString,
  requesterTicketWhere,
  staffTicketWhere,
} from "../lib/ticket-query.js";

interface Dependencies {
  prisma: PrismaClient;
  /** Signed in, past the first-login gate, and a Requester. */
  asRequester: RequestHandler[];
  /** The same, and IT Staff or Administrator. */
  asStaff: RequestHandler[];
  now: () => Date;
}

/** BR-26. */
export const DASHBOARD_LIST_SIZE = 5;
export const RECENTLY_RESOLVED_DAYS = 7;
export const PREVIEW_LENGTH = 120;

const REQUESTER_METRICS = [
  { key: "openTickets", query: "status=ACTIVE" },
  { key: "waitingForYou", query: "status=WAITING_FOR_REQUESTER" },
  { key: "resolved", query: "status=RESOLVED" },
  { key: "closed", query: "status=CLOSED" },
] as const;

const STAFF_METRICS = [
  { key: "unassigned", query: "owner=unassigned&status=ACTIVE" },
  { key: "myTickets", query: "owner=me&status=ACTIVE" },
  { key: "urgent", query: "itPriority=URGENT&status=ACTIVE" },
] as const;

/** BR-28: a row is enough to recognise the Ticket and open it, no more. */
const requesterRow = {
  id: true,
  ticketNumber: true,
  summary: true,
  currentStatus: true,
  updatedAt: true,
};

/**
 * The first 120 characters of an Action Description. A cut that lands inside
 * a surrogate pair drops the half it kept, so the preview never ends in a
 * character that cannot be displayed.
 */
export function descriptionPreview(description: string): string {
  const cut = description.slice(0, PREVIEW_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  const splitPair =
    description.length > PREVIEW_LENGTH && last >= 0xd800 && last <= 0xdbff;
  return splitPair ? cut.slice(0, -1) : cut;
}

/**
 * BR-27: a status nobody is in is a row with 0, not a missing row. All eight,
 * in the declared order, whatever the grouped read returned.
 */
export function statusCounts(
  groups: readonly { currentStatus: string; _count: { _all: number } }[],
) {
  const perStatus = new Map(
    groups.map((group) => [group.currentStatus, group._count._all]),
  );
  return TICKET_STATUSES.map((status) => ({
    status,
    value: perStatus.get(status) ?? 0,
    query: `status=${status}`,
  }));
}

export function registerDashboards(
  app: Express,
  { prisma, asRequester, asStaff, now }: Dependencies,
): void {
  // One snapshot per response. The reads are separate statements, and a
  // Ticket changing status between two of them would be counted under both
  // statuses or neither. Under REPEATABLE READ they all see the database as
  // it was at the first one, so the eight status counts add up to the number
  // of Tickets. Nothing is written, so there is nothing to conflict with.
  const snapshot = <Result>(read: (db: Tx) => Promise<Result>) =>
    prisma.$transaction(read, { isolationLevel: "RepeatableRead" });

  // BR-23: the only thing that decides whose Tickets are counted is the
  // session. The handler never reads `req.query`, so there is no parameter to
  // get wrong.
  app.get(
    "/api/dashboard/requester",
    ...asRequester,
    async (req: AuthenticatedRequest, res) => {
      const requesterId = req.auth!.user.id;
      const generatedAt = now();
      const mine = (query: string) =>
        requesterTicketWhere(requesterId, parseTicketQuery(queryFromString(query)));

      try {
        const [values, needsAttention, recentlyUpdated, recentlyResolved] =
          await snapshot((db) => Promise.all([
            Promise.all(
              REQUESTER_METRICS.map(({ query }) =>
                db.ticket.count({ where: mine(query) }),
              ),
            ),
            db.ticket.findMany({
              where: mine("status=WAITING_FOR_REQUESTER"),
              // Longest wait first: the Ticket that has sat untouched longest
              // is the one most in need of an answer.
              orderBy: [{ updatedAt: "asc" }, { id: "desc" }],
              take: DASHBOARD_LIST_SIZE,
              select: requesterRow,
            }),
            db.ticket.findMany({
              where: mine(""),
              orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
              take: DASHBOARD_LIST_SIZE,
              select: requesterRow,
            }),
            db.ticket.findMany({
              where: {
                ...mine(""),
                // Status as well as the date: a Ticket reopened since has its
                // `resolvedAt` cleared, and the status check keeps that true
                // even for a row written before this sprint.
                currentStatus: { in: ["RESOLVED", "CLOSED"] },
                resolvedAt: {
                  gte: bangkokLastDaysStart(generatedAt, RECENTLY_RESOLVED_DAYS),
                },
              },
              orderBy: [{ resolvedAt: "desc" }, { id: "desc" }],
              take: DASHBOARD_LIST_SIZE,
              select: { ...requesterRow, resolvedAt: true },
            }),
          ]));

        res.json({
          generatedAt,
          timeZone: DASHBOARD_TIME_ZONE,
          metrics: REQUESTER_METRICS.map((metric, index) => ({
            key: metric.key,
            value: values[index],
            query: metric.query,
          })),
          needsAttention,
          recentlyUpdated,
          recentlyResolved,
        });
      } catch {
        res.status(500).json({ error: "Unable to load the dashboard" });
      }
    },
  );

  app.get(
    "/api/dashboard/staff",
    ...asStaff,
    async (req: AuthenticatedRequest, res) => {
      const { id: userId, role } = req.auth!.user;
      const generatedAt = now();
      const today = bangkokToday(generatedAt);
      const queue = (query: string) =>
        staffTicketWhere(userId, parseStaffQueueQuery(queryFromString(query)));

      try {
        const [values, myActionsToday, statusGroups, recentlyUpdated, actions, userGroups] =
          await snapshot((db) => Promise.all([
            Promise.all(
              STAFF_METRICS.map(({ query }) =>
                db.ticket.count({ where: queue(query) }),
              ),
            ),
            db.actionTaken.count({
              where: {
                performedById: userId,
                actionAt: { gte: today.from, lt: today.to },
              },
            }),
            // One grouped read, not eight counts. It is the same condition as
            // the queue's `status=X` filter: equality on `currentStatus`.
            db.ticket.groupBy({ by: ["currentStatus"], _count: { _all: true } }),
            db.ticket.findMany({
              orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
              take: DASHBOARD_LIST_SIZE,
              select: {
                id: true,
                ticketNumber: true,
                summary: true,
                currentStatus: true,
                itPriority: true,
                updatedAt: true,
                owner: { select: { id: true, name: true } },
              },
            }),
            db.actionTaken.findMany({
              where: { performedById: userId },
              orderBy: [{ actionAt: "desc" }, { id: "desc" }],
              take: DASHBOARD_LIST_SIZE,
              select: {
                id: true,
                ticketId: true,
                actionAt: true,
                description: true,
                followUpRequired: true,
                ticket: { select: { ticketNumber: true, summary: true } },
              },
            }),
            // BR-29: not even asked for unless the caller is an Administrator.
            role === "ADMINISTRATOR"
              ? db.user.groupBy({ by: ["isActive"], _count: { _all: true } })
              : null,
          ]));

        const usersWhere = (isActive: boolean) =>
          userGroups?.find((group) => group.isActive === isActive)?._count._all ?? 0;

        res.json({
          generatedAt,
          timeZone: DASHBOARD_TIME_ZONE,
          metrics: [
            ...STAFF_METRICS.map((metric, index) => ({
              key: metric.key,
              value: values[index],
              query: metric.query as string | null,
            })),
            // No drill-down: there is no list of Actions Taken across Tickets.
            { key: "myActionsToday", value: myActionsToday, query: null },
          ],
          byStatus: statusCounts(statusGroups),
          recentlyUpdated,
          myRecentActions: actions.map(({ description, ticket, ...action }) => ({
            id: action.id,
            ticketId: action.ticketId,
            ticketNumber: ticket.ticketNumber,
            ticketSummary: ticket.summary,
            actionAt: action.actionAt,
            descriptionPreview: descriptionPreview(description),
            followUpRequired: action.followUpRequired,
          })),
          ...(userGroups
            ? { users: { active: usersWhere(true), inactive: usersWhere(false) } }
            : {}),
        });
      } catch {
        res.status(500).json({ error: "Unable to load the dashboard" });
      }
    },
  );
}
