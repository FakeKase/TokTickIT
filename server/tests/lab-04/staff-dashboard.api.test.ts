import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";
import { ACTIVE_STATUSES, TICKET_STATUSES } from "../../src/lib/ticket-query.js";
import { descriptionPreview, statusCounts } from "../../src/routes/dashboard.js";
import { signInAs } from "../helpers/session.js";
import {
  SECRET_COMMENT,
  SECRET_DESCRIPTION,
  SECRET_NOTE,
  dashboardFixtures,
} from "./dashboard-fixtures.js";

// API-36 to API-41 (Lab 4 FR-10 to FR-12; BR-21, BR-22, BR-24 to BR-29;
// AC-06, AC-32 to AC-36, AC-39).
//
// The queue is every Ticket in the database, including whatever the seed and
// other suites left there. So a count is never asserted as a number: it is
// compared with the queue's own total, or with itself before and after one
// change. Only what belongs to this file's users is asserted outright.

const TAG = "staff-dashboard.api.test";

const NOW = new Date("2026-10-06T04:00:00.000Z"); // 11:00 on 6 October in Bangkok
const DAY_START = new Date("2026-10-05T17:00:00.000Z");
const DAY_END = new Date("2026-10-06T17:00:00.000Z");

const prisma = createPrismaClient();
const app = createApp(prisma, { now: () => NOW });
const fixtures = dashboardFixtures(prisma, TAG);

let requesterId: number;
let staffId: number;
let colleagueId: number;
let ticketId: number;
let requesterCookie: string;
let staffCookie: string;
let colleagueCookie: string;
let adminCookie: string;

const dashboard = (cookie: string, query = "") =>
  request(app).get(`/api/dashboard/staff${query}`).set("Cookie", cookie);
const queue = (cookie: string, query: string) =>
  request(app).get(`/api/staff/tickets?${query}`).set("Cookie", cookie);

interface Metric { key: string; value: number; query: string | null }
interface Body {
  metrics: Metric[];
  byStatus: { status: string; value: number; query: string }[];
}
const valueOf = (body: Body, key: string) => body.metrics.find((metric) => metric.key === key)!.value;
const statusValue = (body: Body, status: string) => body.byStatus.find((row) => row.status === status)!.value;

beforeAll(async () => {
  await fixtures.remove();
  const [requester, staff, colleague, admin] = await Promise.all([
    fixtures.user("requester"),
    fixtures.user("staff", "IT_STAFF"),
    fixtures.user("colleague", "IT_STAFF"),
    fixtures.user("admin", "ADMINISTRATOR"),
    fixtures.user("left", "IT_STAFF", false),
  ]);
  requesterId = requester.id;
  staffId = staff.id;
  colleagueId = colleague.id;
  [requesterCookie, staffCookie, colleagueCookie, adminCookie] = await Promise.all(
    [requester, staff, colleague, admin].map((user) => signInAs(app, user.email)),
  );
});

beforeEach(async () => {
  await prisma.actionTaken.deleteMany({ where: { performedById: { in: [staffId, colleagueId] } } });
  await prisma.ticketComment.deleteMany({ where: { ticket: { requesterId } } });
  await prisma.ticket.deleteMany({ where: { requesterId } });
  ticketId = (
    await fixtures.ticket({ requesterId, status: "IN_PROGRESS", ownerId: colleagueId, itPriority: "HIGH" })
  ).id;
});

afterAll(async () => {
  await fixtures.remove();
  await prisma.$disconnect();
});

describe("API-36 counts equal queue totals (BR-24, AC-33)", () => {
  it("serves, for each card, the total the queue returns under its query", async () => {
    await fixtures.tickets([
      { requesterId, status: "NEW", ownerId: null, itPriority: "URGENT" },
      { requesterId, status: "REOPENED", ownerId: staffId, itPriority: "URGENT" },
      { requesterId, status: "RESOLVED", ownerId: staffId, itPriority: "URGENT" },
      { requesterId, status: "CANCELLED", ownerId: null },
    ]);

    const { body } = await dashboard(staffCookie);

    expect(body.metrics.map((metric: Metric) => [metric.key, metric.query])).toEqual([
      ["unassigned", "owner=unassigned&status=ACTIVE"],
      ["myTickets", "owner=me&status=ACTIVE"],
      ["urgent", "itPriority=URGENT&status=ACTIVE"],
      ["myActionsToday", null],
    ]);
    for (const metric of (body.metrics as Metric[]).filter((metric) => metric.query !== null)) {
      const list = await queue(staffCookie, metric.query!);
      expect(list.body.filtered).toBe(true);
      expect([metric.key, metric.value]).toEqual([metric.key, list.body.pagination.totalItems]);
    }
    // The one figure that is this file's alone: the caller owns one active Ticket.
    expect(valueOf(body, "myTickets")).toBe(1);
  });

  it("serves all eight statuses in order, each equal to the queue under it, summing to every Ticket", async () => {
    const { body } = await dashboard(staffCookie);

    expect(body.byStatus.map((row: { status: string }) => row.status)).toEqual([...TICKET_STATUSES]);
    for (const row of body.byStatus as Body["byStatus"]) {
      expect(row.query).toBe(`status=${row.status}`);
      const list = await queue(staffCookie, row.query);
      expect([row.status, row.value]).toEqual([row.status, list.body.pagination.totalItems]);
    }
    const everything = (await queue(staffCookie, "")).body.pagination.totalItems;
    expect(body.byStatus.reduce((sum: number, row: { value: number }) => sum + row.value, 0)).toBe(everything);
  });

  it("keeps a status nobody is in as a row with 0", () => {
    const rows = statusCounts([
      { currentStatus: "OPEN", _count: { _all: 3 } },
      { currentStatus: "CLOSED", _count: { _all: 1 } },
    ]);

    expect(rows.map((row) => row.value)).toEqual([0, 3, 0, 0, 0, 1, 0, 0]);
    expect(rows.map((row) => row.status)).toEqual([...TICKET_STATUSES]);
    expect(statusCounts([]).every((row) => row.value === 0)).toBe(true);
  });

  it("moves the cards a change touches by one and leaves the others", async () => {
    const before = (await dashboard(staffCookie)).body;

    const ticket = await fixtures.ticket({ requesterId, status: "NEW", ownerId: null, itPriority: "URGENT" });
    const created = (await dashboard(staffCookie)).body;
    expect(valueOf(created, "unassigned")).toBe(valueOf(before, "unassigned") + 1);
    expect(valueOf(created, "urgent")).toBe(valueOf(before, "urgent") + 1);
    expect(valueOf(created, "myTickets")).toBe(valueOf(before, "myTickets"));
    expect(statusValue(created, "NEW")).toBe(statusValue(before, "NEW") + 1);

    await prisma.ticket.update({ where: { id: ticket.id }, data: { ownerId: staffId } });
    const assigned = (await dashboard(staffCookie)).body;
    expect(valueOf(assigned, "unassigned")).toBe(valueOf(before, "unassigned"));
    expect(valueOf(assigned, "myTickets")).toBe(valueOf(before, "myTickets") + 1);
    expect(valueOf(assigned, "urgent")).toBe(valueOf(before, "urgent") + 1);

    // Resolved is not active: the Ticket leaves all three cards but stays counted by status.
    await prisma.ticket.update({ where: { id: ticket.id }, data: { currentStatus: "RESOLVED" } });
    const resolved = (await dashboard(staffCookie)).body;
    for (const key of ["unassigned", "myTickets", "urgent"]) {
      expect([key, valueOf(resolved, key)]).toEqual([key, valueOf(before, key)]);
    }
    expect(statusValue(resolved, "RESOLVED")).toBe(statusValue(before, "RESOLVED") + 1);
    expect(statusValue(resolved, "NEW")).toBe(statusValue(before, "NEW"));
  });

  it("reads `me` as whoever is asking", async () => {
    const mine = (await dashboard(staffCookie)).body;
    const theirs = (await dashboard(colleagueCookie)).body;

    expect(valueOf(mine, "myTickets")).toBe(0);
    expect(valueOf(theirs, "myTickets")).toBe(1);
    expect(valueOf(mine, "unassigned")).toBe(valueOf(theirs, "unassigned"));
  });

  it("is not changed by query parameters", async () => {
    const plain = await dashboard(staffCookie);
    const tried = await dashboard(staffCookie, `?owner=${colleagueId}&userId=${colleagueId}&role=ADMINISTRATOR`);

    expect(tried.body).toEqual(plain.body);
  });
});

describe("API-37 My Actions Today (BR-25, AC-34)", () => {
  it("counts the caller's actions dated inside the Bangkok day, and no others", async () => {
    const ms = (from: Date, offset: number) => new Date(from.getTime() + offset);
    await fixtures.action(ticketId, staffId, DAY_START); // first instant of today
    await fixtures.action(ticketId, staffId, ms(DAY_END, -1)); // last millisecond of today
    await fixtures.action(ticketId, staffId, ms(DAY_START, -1)); // yesterday, by a millisecond
    await fixtures.action(ticketId, staffId, DAY_END); // tomorrow's first instant
    await fixtures.action(ticketId, colleagueId, ms(DAY_START, 3_600_000)); // today, someone else

    const mine = (await dashboard(staffCookie)).body;
    const theirs = (await dashboard(colleagueCookie)).body;

    expect(valueOf(mine, "myActionsToday")).toBe(2);
    expect(valueOf(theirs, "myActionsToday")).toBe(1);
    expect(mine.generatedAt).toBe(NOW.toISOString());
    expect(mine.timeZone).toBe("Asia/Bangkok");
  });

  it("is 0, not an error, for someone who has recorded nothing (BR-27)", async () => {
    const response = await dashboard(staffCookie);

    expect(response.status).toBe(200);
    expect(valueOf(response.body, "myActionsToday")).toBe(0);
    expect(response.body.myRecentActions).toEqual([]);
  });
});

describe("API-38 user counts (BR-29, AC-35)", () => {
  it("gives an Administrator the active and inactive account counts", async () => {
    const [active, inactive] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isActive: false } }),
    ]);

    const { body } = await dashboard(adminCookie);

    expect(body.users).toEqual({ active, inactive });
    expect(inactive).toBeGreaterThanOrEqual(1);
  });

  it("gives IT Staff no users field at all", async () => {
    const { body } = await dashboard(staffCookie);

    expect(body).not.toHaveProperty("users");
    expect(Object.keys(body).sort()).toEqual(
      ["byStatus", "generatedAt", "metrics", "myRecentActions", "recentlyUpdated", "timeZone"].sort(),
    );
  });
});

describe("API-39 who may call it (AC-06, AC-32)", () => {
  it("answers 401 with no session", async () => {
    const response = await request(app).get("/api/dashboard/staff");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
  });

  it("answers 403 with no data for a Requester", async () => {
    const response = await dashboard(requesterCookie);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "You do not have permission to perform this action" });
  });
});

describe("API-40 lists and shape (BR-26, BR-28, AC-36)", () => {
  it("lists the five most recently updated Tickets, as the queue orders them", async () => {
    // Later than anything else in the database, and two share an instant so
    // the tie-break is exercised.
    const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
    for (const updatedAt of [later(60), later(60), later(59), later(58), later(57), later(56)]) {
      await fixtures.ticket({ requesterId, status: "OPEN", updatedAt });
    }

    const { body } = await dashboard(staffCookie);
    const firstPage = (await queue(staffCookie, "pageSize=5")).body.data;

    expect(body.recentlyUpdated).toHaveLength(5);
    expect(body.recentlyUpdated.map((row: { id: number }) => row.id)).toEqual(
      firstPage.map((row: { id: number }) => row.id),
    );
    expect(body.recentlyUpdated[0].id).toBeGreaterThan(body.recentlyUpdated[1].id);
    expect(Object.keys(body.recentlyUpdated[0]).sort()).toEqual(
      ["currentStatus", "id", "itPriority", "owner", "summary", "ticketNumber", "updatedAt"].sort(),
    );
    expect(body.recentlyUpdated[0].owner).toBeNull();
  });

  it("names an owner by id and name only", async () => {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { updatedAt: new Date(Date.now() + 3_600_000) },
    });

    const { body } = await dashboard(staffCookie);

    expect(body.recentlyUpdated[0].id).toBe(ticketId);
    expect(body.recentlyUpdated[0].owner).toEqual({ id: colleagueId, name: `colleague ${TAG}` });
  });

  it("lists the caller's five latest Actions Taken, newest first, and nobody else's", async () => {
    const at = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
    const mine = [];
    for (const minutes of [50, 10, 30, 20, 40, 60]) {
      mine.push(await fixtures.action(ticketId, staffId, at(minutes), { followUpRequired: minutes === 10 }));
    }
    await fixtures.action(ticketId, colleagueId, at(1));
    const expected = [...mine].sort((a, b) => b.actionAt.getTime() - a.actionAt.getTime()).slice(0, 5);

    const { body } = await dashboard(staffCookie);
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });

    expect(body.myRecentActions.map((row: { id: number }) => row.id)).toEqual(expected.map((a) => a.id));
    expect(body.myRecentActions[0]).toEqual({
      id: expected[0].id,
      ticketId,
      ticketNumber: ticket.ticketNumber,
      ticketSummary: ticket.summary,
      actionAt: at(10).toISOString(),
      descriptionPreview: "Checked the cable.",
      followUpRequired: true,
    });
  });

  it("breaks a tie on Action Date/Time by id descending", async () => {
    const first = await fixtures.action(ticketId, staffId, NOW);
    const second = await fixtures.action(ticketId, staffId, NOW);

    const { body } = await dashboard(staffCookie);

    expect(body.myRecentActions.map((row: { id: number }) => row.id)).toEqual([second.id, first.id]);
  });

  it("cuts the description to a preview of at most 120 characters", async () => {
    const long = "x".repeat(119) + "END-OF-PREVIEW" + "y".repeat(1800);
    await fixtures.action(ticketId, staffId, NOW, { description: long });

    const response = await dashboard(staffCookie);

    expect(response.body.myRecentActions[0].descriptionPreview).toBe(long.slice(0, 120));
    expect(response.body.myRecentActions[0]).not.toHaveProperty("description");
    expect(response.text).not.toContain("END-OF-PREVIEW");
  });

  it("never ends a preview on half of a character", () => {
    const emoji = "\u{1F600}"; // two UTF-16 units

    expect(descriptionPreview("x".repeat(119) + emoji + "tail")).toBe("x".repeat(119));
    expect(descriptionPreview("x".repeat(118) + emoji + "tail")).toBe("x".repeat(118) + emoji);
    expect(descriptionPreview("short " + emoji)).toBe("short " + emoji);
    expect(descriptionPreview("x".repeat(120))).toHaveLength(120);
  });

  it("carries no description, comment, note, attachment or email address", async () => {
    await prisma.ticketComment.createMany({
      data: [
        { ticketId, authorId: staffId, visibility: "PUBLIC", body: SECRET_COMMENT },
        { ticketId, authorId: staffId, visibility: "INTERNAL", body: SECRET_NOTE },
      ],
    });
    await prisma.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date(Date.now() + 3_600_000) } });
    await fixtures.action(ticketId, staffId, NOW);

    for (const cookie of [staffCookie, adminCookie]) {
      const response = await dashboard(cookie);

      expect(response.body.recentlyUpdated[0].id).toBe(ticketId);
      for (const secret of [SECRET_DESCRIPTION, SECRET_COMMENT, SECRET_NOTE, "@", "attachment", "Recorded for the dashboard test"]) {
        expect(response.text).not.toContain(secret);
      }
    }
  });
});

describe("API-41 the queue under status=ACTIVE (FR-12, AC-39)", () => {
  it("returns only the five active statuses and says the queue is filtered", async () => {
    await fixtures.tickets(TICKET_STATUSES.map((status) => ({ requesterId, status })));
    const active = await prisma.ticket.count({ where: { currentStatus: { in: [...ACTIVE_STATUSES] } } });

    const response = await queue(staffCookie, "status=ACTIVE&pageSize=50");

    expect(response.status).toBe(200);
    expect(response.body.filtered).toBe(true);
    expect(response.body.pagination.totalItems).toBe(active);
    expect(response.body.data.length).toBeGreaterThanOrEqual(6);
    for (const row of response.body.data) expect(ACTIVE_STATUSES).toContain(row.currentStatus);
  });

  it("combines with owner and IT Priority", async () => {
    await fixtures.tickets([
      { requesterId, status: "OPEN", ownerId: staffId, itPriority: "URGENT" },
      { requesterId, status: "CLOSED", ownerId: staffId, itPriority: "URGENT" },
      { requesterId, status: "OPEN", ownerId: staffId, itPriority: "LOW" },
    ]);

    const mine = await queue(staffCookie, "status=ACTIVE&owner=me");
    const mineUrgent = await queue(staffCookie, "status=ACTIVE&owner=me&itPriority=URGENT");

    expect(mine.body.pagination.totalItems).toBe(2);
    expect(mineUrgent.body.pagination.totalItems).toBe(1);
    expect(mineUrgent.body.data[0]).toMatchObject({ currentStatus: "OPEN", itPriority: "URGENT" });
  });

  it("still filters to one status, and ignores an unknown one", async () => {
    const one = await queue(staffCookie, "status=IN_PROGRESS&pageSize=50");
    const bogus = await queue(staffCookie, "status=BOGUS");

    for (const row of one.body.data) expect(row.currentStatus).toBe("IN_PROGRESS");
    expect(bogus.body.filtered).toBe(false);
  });
});
