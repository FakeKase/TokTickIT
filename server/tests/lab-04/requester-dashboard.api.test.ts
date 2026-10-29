import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";
import { ACTIVE_STATUSES, type TicketStatusValue } from "../../src/lib/ticket-query.js";
import { signInAs } from "../helpers/session.js";
import {
  SECRET_COMMENT,
  SECRET_DESCRIPTION,
  SECRET_NOTE,
  dashboardFixtures,
} from "./dashboard-fixtures.js";

// API-30 to API-35 (Lab 4 FR-09, FR-12; BR-21 to BR-28; AC-02, AC-06, AC-30
// to AC-32, AC-36, AC-38, AC-39).
//
// A Requester's dashboard depends on nobody else's rows, so unlike the staff
// file these counts are asserted as absolute numbers.

const TAG = "requester-dashboard.api.test";

// The clock the dashboard reads. Only "recently resolved" depends on it.
const NOW = new Date("2026-10-06T04:00:00.000Z"); // 11:00 on 6 October in Bangkok
const WINDOW_START = new Date("2026-09-29T17:00:00.000Z"); // 00:00 on 30 September in Bangkok

const prisma = createPrismaClient();
const app = createApp(prisma, { now: () => NOW });
const fixtures = dashboardFixtures(prisma, TAG);

const minutesBefore = (minutes: number, from = NOW) => new Date(from.getTime() - minutes * 60_000);

let aliceId: number;
let bobId: number;
let aliceCookie: string;
let bobCookie: string;
let emptyCookie: string;
let staffCookie: string;
let adminCookie: string;

const dashboard = (cookie: string, query = "") =>
  request(app).get(`/api/dashboard/requester${query}`).set("Cookie", cookie);
const myTickets = (cookie: string, query: string) =>
  request(app).get(`/api/tickets?${query}`).set("Cookie", cookie);

interface Metric { key: string; value: number; query: string }
const valueOf = (body: { metrics: Metric[] }, key: string) =>
  body.metrics.find((metric) => metric.key === key)!.value;

/** Alice's Tickets, by status. Six are waiting, so that list has to be cut. */
const ALICE: Record<TicketStatusValue, number> = {
  NEW: 1,
  OPEN: 1,
  IN_PROGRESS: 1,
  WAITING_FOR_REQUESTER: 6,
  REOPENED: 1,
  RESOLVED: 2,
  CLOSED: 1,
  CANCELLED: 1,
};
const ALICE_ACTIVE = ACTIVE_STATUSES.reduce((sum, status) => sum + ALICE[status], 0);

async function resetTickets() {
  await prisma.ticketComment.deleteMany({ where: { ticket: { requesterId: { in: [aliceId, bobId] } } } });
  await prisma.ticket.deleteMany({ where: { requesterId: { in: [aliceId, bobId] } } });

  // Every Ticket gets its own minute, so every order in this file is decided
  // by the timestamp and never by the tie-break.
  let minute = 0;
  const alice = (Object.entries(ALICE) as [TicketStatusValue, number][]).flatMap(([status, count]) =>
    Array.from({ length: count }, () => ({
      requesterId: aliceId,
      status,
      updatedAt: minutesBefore(++minute * 10),
      // Resolved and Closed long before the window, unless a test says otherwise.
      resolvedAt: status === "RESOLVED" || status === "CLOSED" ? new Date("2026-08-01T00:00:00.000Z") : null,
    })),
  );
  await fixtures.tickets([
    ...alice,
    { requesterId: bobId, status: "WAITING_FOR_REQUESTER", summary: `Bob waiting ${TAG}` },
    { requesterId: bobId, status: "RESOLVED", resolvedAt: minutesBefore(5), summary: `Bob resolved ${TAG}` },
  ]);
}

beforeAll(async () => {
  await fixtures.remove();
  const [alice, bob, empty, staff, admin] = await Promise.all([
    fixtures.user("alice"),
    fixtures.user("bob"),
    fixtures.user("empty"),
    fixtures.user("staff", "IT_STAFF"),
    fixtures.user("admin", "ADMINISTRATOR"),
  ]);
  aliceId = alice.id;
  bobId = bob.id;
  [aliceCookie, bobCookie, emptyCookie, staffCookie, adminCookie] = await Promise.all(
    [alice, bob, empty, staff, admin].map((user) => signInAs(app, user.email)),
  );
});

beforeEach(resetTickets);

afterAll(async () => {
  await fixtures.remove();
  await prisma.$disconnect();
});

describe("API-30 a Requester sees only their own (BR-23, AC-02)", () => {
  it("counts each Requester's Tickets and nobody else's", async () => {
    const alice = await dashboard(aliceCookie);
    const bob = await dashboard(bobCookie);

    expect(alice.status).toBe(200);
    expect(alice.body.metrics).toEqual([
      { key: "openTickets", value: ALICE_ACTIVE, query: "status=ACTIVE" },
      { key: "waitingForYou", value: 6, query: "status=WAITING_FOR_REQUESTER" },
      { key: "resolved", value: 2, query: "status=RESOLVED" },
      { key: "closed", value: 1, query: "status=CLOSED" },
    ]);
    expect(bob.body.metrics.map((metric: Metric) => metric.value)).toEqual([1, 1, 1, 0]);
  });

  it("lists only that Requester's Tickets", async () => {
    const aliceTickets = new Set(
      (await prisma.ticket.findMany({ where: { requesterId: aliceId }, select: { id: true } })).map((t) => t.id),
    );
    const { body } = await dashboard(aliceCookie);
    const bob = await dashboard(bobCookie);

    for (const list of [body.needsAttention, body.recentlyUpdated, body.recentlyResolved]) {
      for (const row of list) expect(aliceTickets.has(row.id)).toBe(true);
    }
    expect(bob.body.recentlyUpdated).toHaveLength(2);
    expect(bob.body.recentlyResolved).toHaveLength(1);
    for (const row of bob.body.recentlyUpdated) expect(aliceTickets.has(row.id)).toBe(false);
  });

  it("is not widened by a parameter naming another Requester", async () => {
    const plain = await dashboard(bobCookie);
    const widened = await dashboard(
      bobCookie,
      `?requesterId=${aliceId}&userId=${aliceId}&status=ACTIVE&all=true`,
    );

    expect(widened.status).toBe(200);
    expect(widened.body).toEqual(plain.body);
  });
});

describe("API-31 counts equal list totals (BR-24, AC-30)", () => {
  it("serves, for each metric, the total My Tickets returns under its query", async () => {
    const { body } = await dashboard(aliceCookie);

    expect(body.metrics).toHaveLength(4);
    for (const metric of body.metrics as Metric[]) {
      const list = await myTickets(aliceCookie, metric.query);
      expect(list.body.filtered).toBe(true);
      expect({ key: metric.key, value: metric.value }).toEqual({
        key: metric.key,
        value: list.body.pagination.totalItems,
      });
    }
  });

  it("moves exactly the two affected counts when a Ticket changes status", async () => {
    const before = (await dashboard(aliceCookie)).body;
    const resolved = await prisma.ticket.findFirstOrThrow({
      where: { requesterId: aliceId, currentStatus: "RESOLVED" },
    });

    await prisma.ticket.update({ where: { id: resolved.id }, data: { currentStatus: "CLOSED" } });
    const after = (await dashboard(aliceCookie)).body;

    expect(valueOf(after, "resolved")).toBe(valueOf(before, "resolved") - 1);
    expect(valueOf(after, "closed")).toBe(valueOf(before, "closed") + 1);
    expect(valueOf(after, "openTickets")).toBe(valueOf(before, "openTickets"));
    expect(valueOf(after, "waitingForYou")).toBe(valueOf(before, "waitingForYou"));
  });

  it("counts at request time, with nothing stored (BR-21)", async () => {
    await fixtures.ticket({ requesterId: aliceId, status: "NEW" });

    expect(valueOf((await dashboard(aliceCookie)).body, "openTickets")).toBe(ALICE_ACTIVE + 1);
  });
});

describe("API-32 a Requester with nothing (BR-27, AC-31)", () => {
  it("answers 200 with four zeros and three empty lists", async () => {
    const response = await dashboard(emptyCookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      generatedAt: NOW.toISOString(),
      timeZone: "Asia/Bangkok",
      metrics: [
        { key: "openTickets", value: 0, query: "status=ACTIVE" },
        { key: "waitingForYou", value: 0, query: "status=WAITING_FOR_REQUESTER" },
        { key: "resolved", value: 0, query: "status=RESOLVED" },
        { key: "closed", value: 0, query: "status=CLOSED" },
      ],
      needsAttention: [],
      recentlyUpdated: [],
      recentlyResolved: [],
    });
  });
});

describe("API-33 who may call it (AC-06, AC-32)", () => {
  it("answers 401 with no session", async () => {
    const response = await request(app).get("/api/dashboard/requester");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
  });

  it("answers 403 with no data for IT Staff and for an Administrator", async () => {
    for (const cookie of [staffCookie, adminCookie]) {
      const response = await dashboard(cookie);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "You do not have permission to perform this action" });
    }
  });
});

describe("API-34 the lists (BR-26, BR-28, AC-36, AC-38)", () => {
  it("cuts every list at 5 rows", async () => {
    const { body } = await dashboard(aliceCookie);

    expect(body.needsAttention).toHaveLength(5); // six are waiting
    expect(body.recentlyUpdated).toHaveLength(5); // fourteen Tickets
  });

  it("puts the longest wait first under Needs attention, and the newest first under Recently updated", async () => {
    const { body } = await dashboard(aliceCookie);
    const waiting = await prisma.ticket.findMany({
      where: { requesterId: aliceId, currentStatus: "WAITING_FOR_REQUESTER" },
      orderBy: { updatedAt: "asc" },
      take: 5,
      select: { id: true },
    });
    const newest = await prisma.ticket.findMany({
      where: { requesterId: aliceId },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true },
    });

    expect(body.needsAttention.map((row: { id: number }) => row.id)).toEqual(waiting.map((t) => t.id));
    expect(body.recentlyUpdated.map((row: { id: number }) => row.id)).toEqual(newest.map((t) => t.id));
    for (const row of body.needsAttention) expect(row.currentStatus).toBe("WAITING_FOR_REQUESTER");
  });

  it("breaks a tie on the timestamp by id descending", async () => {
    const same = minutesBefore(1);
    await prisma.ticket.updateMany({ where: { requesterId: aliceId }, data: { updatedAt: same } });
    const ids = (
      await prisma.ticket.findMany({ where: { requesterId: aliceId }, orderBy: { id: "desc" }, take: 5 })
    ).map((t) => t.id);

    const { body } = await dashboard(aliceCookie);

    expect(body.recentlyUpdated.map((row: { id: number }) => row.id)).toEqual(ids);
  });

  it("lists a Ticket resolved within the last 7 Bangkok days and leaves out an earlier one and a reopened one", async () => {
    const make = (status: TicketStatusValue, resolvedAt: Date, summary: string) =>
      fixtures.ticket({ requesterId: aliceId, status, resolvedAt, summary });
    const firstInstant = await make("RESOLVED", WINDOW_START, "first instant of the window");
    const closedInside = await make("CLOSED", minutesBefore(60), "closed, resolved an hour ago");
    const justNow = await make("RESOLVED", minutesBefore(1), "resolved a minute ago");
    const tooEarly = await make("RESOLVED", new Date(WINDOW_START.getTime() - 1), "a millisecond too early");
    // A date left behind on a Ticket that has since been reopened must not
    // bring it back: the status is checked as well as the date.
    const reopened = await make("REOPENED", minutesBefore(30), "reopened since");

    const { body } = await dashboard(aliceCookie);
    const ids = body.recentlyResolved.map((row: { id: number }) => row.id);

    expect(ids).toEqual([justNow.id, closedInside.id, firstInstant.id]);
    expect(ids).not.toContain(tooEarly.id);
    expect(ids).not.toContain(reopened.id);
    expect(body.recentlyResolved[0].resolvedAt).toBe(minutesBefore(1).toISOString());
  });

  it("cuts Recently resolved at 5 as well", async () => {
    for (let n = 1; n <= 6; n++) {
      await fixtures.ticket({ requesterId: aliceId, status: "RESOLVED", resolvedAt: minutesBefore(n) });
    }

    expect((await dashboard(aliceCookie)).body.recentlyResolved).toHaveLength(5);
  });

  it("carries short rows only: no description, comment, note or email address", async () => {
    const [ticket] = await prisma.ticket.findMany({
      where: { requesterId: aliceId, currentStatus: "WAITING_FOR_REQUESTER" },
      orderBy: { updatedAt: "asc" },
      take: 1,
    });
    await prisma.ticketComment.createMany({
      data: [
        { ticketId: ticket.id, authorId: aliceId, visibility: "PUBLIC", body: SECRET_COMMENT },
        { ticketId: ticket.id, authorId: aliceId, visibility: "INTERNAL", body: SECRET_NOTE },
      ],
    });
    await fixtures.ticket({ requesterId: aliceId, status: "RESOLVED", resolvedAt: minutesBefore(2) });

    const response = await dashboard(aliceCookie);
    const row = ["currentStatus", "id", "summary", "ticketNumber", "updatedAt"];

    expect(Object.keys(response.body.needsAttention[0]).sort()).toEqual(row);
    expect(Object.keys(response.body.recentlyUpdated[0]).sort()).toEqual(row);
    expect(Object.keys(response.body.recentlyResolved[0]).sort()).toEqual([...row, "resolvedAt"].sort());
    for (const secret of [SECRET_DESCRIPTION, SECRET_COMMENT, SECRET_NOTE, "@"]) {
      expect(response.text).not.toContain(secret);
    }
  });
});

describe("API-35 My Tickets filters (FR-12, AC-39)", () => {
  it("returns only the five active statuses under status=ACTIVE, and says the list is filtered", async () => {
    const response = await myTickets(aliceCookie, "status=ACTIVE&pageSize=50");

    expect(response.status).toBe(200);
    expect(response.body.filtered).toBe(true);
    expect(response.body.pagination.totalItems).toBe(ALICE_ACTIVE);
    expect(response.body.data).toHaveLength(ALICE_ACTIVE);
    for (const row of response.body.data) expect(ACTIVE_STATUSES).toContain(row.currentStatus);
  });

  it("filters to a single status", async () => {
    const response = await myTickets(aliceCookie, "status=WAITING_FOR_REQUESTER&pageSize=50");

    expect(response.body.pagination.totalItems).toBe(6);
    for (const row of response.body.data) expect(row.currentStatus).toBe("WAITING_FOR_REQUESTER");
  });

  it("ignores an unknown status and does not call the list filtered", async () => {
    const response = await myTickets(aliceCookie, "status=BOGUS&pageSize=50");

    expect(response.body.filtered).toBe(false);
    expect(response.body.pagination.totalItems).toBe(14);
  });

  it("combines status with the Lab 2 filters", async () => {
    const response = await myTickets(aliceCookie, `status=ACTIVE&search=${encodeURIComponent("Bob waiting")}`);

    expect(response.body.pagination.totalItems).toBe(0);
    expect(response.body.filtered).toBe(true);
  });

  it("orders by Last Updated when asked", async () => {
    const descending = await myTickets(aliceCookie, "sortBy=updatedAt&sortDir=desc&pageSize=50");
    const ascending = await myTickets(aliceCookie, "sortBy=updatedAt&sortDir=asc&pageSize=50");
    const times = (body: { data: { updatedAt: string }[] }) => body.data.map((row) => row.updatedAt);

    expect(times(descending.body)).toEqual([...times(descending.body)].sort().reverse());
    expect(times(ascending.body)).toEqual([...times(ascending.body)].sort());
    expect(new Set(times(descending.body)).size).toBe(14);
  });

  it("never returns another Requester's Ticket under any filter", async () => {
    for (const query of ["status=ACTIVE", "status=RESOLVED", "status=WAITING_FOR_REQUESTER", "sortBy=updatedAt"]) {
      const response = await myTickets(bobCookie, `${query}&pageSize=50`);

      for (const row of response.body.data) expect(row.summary).toContain("Bob");
    }
  });
});
