import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";
import { TICKET_STATUSES } from "../../src/lib/ticket-query.js";
import { signInAs } from "../helpers/session.js";
import { dashboardFixtures } from "./dashboard-fixtures.js";

// PERF-01 (Lab 4 AC-51).
//
// A smoke test, not a benchmark: it catches a dashboard that starts reading
// whole tables or grows with the data, which is what the limits are for. The
// time is the median of several calls after a warm-up, so one slow tick on a
// busy machine does not fail it and one lucky call does not pass it.

const TAG = "dashboard-performance.api.test";
const EXTRA = 300;
const RUNS = 5;
const LIMIT_MS = 1000;
const LIMIT_BYTES = 16 * 1024;

const prisma = createPrismaClient();
const app = createApp(prisma);
const fixtures = dashboardFixtures(prisma, TAG);

let requesterCookie: string;
let staffCookie: string;
let adminCookie: string;

async function measure(path: string, cookie: string) {
  await request(app).get(path).set("Cookie", cookie); // warm-up
  const times: number[] = [];
  let last = await request(app).get(path).set("Cookie", cookie);
  for (let run = 0; run < RUNS; run++) {
    const started = performance.now();
    last = await request(app).get(path).set("Cookie", cookie);
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return { response: last, median: times[Math.floor(RUNS / 2)] };
}

beforeAll(async () => {
  await fixtures.remove();
  const [requester, staff, admin] = await Promise.all([
    fixtures.user("requester"),
    fixtures.user("staff", "IT_STAFF"),
    fixtures.user("admin", "ADMINISTRATOR"),
  ]);
  [requesterCookie, staffCookie, adminCookie] = await Promise.all(
    [requester, staff, admin].map((user) => signInAs(app, user.email)),
  );

  // Spread over every status and the last 30 days, all for one Requester and
  // half of them owned by one member of staff, so both dashboards have the
  // most they will ever have to count.
  const now = Date.now();
  await fixtures.tickets(
    Array.from({ length: EXTRA }, (_, n) => {
      const status = TICKET_STATUSES[n % TICKET_STATUSES.length];
      const touched = new Date(now - (n % 30) * 86_400_000 - n * 1000);
      return {
        requesterId: requester.id,
        status,
        ownerId: n % 2 === 0 ? staff.id : null,
        itPriority: n % 4 === 0 ? ("URGENT" as const) : ("MEDIUM" as const),
        updatedAt: touched,
        resolvedAt: status === "RESOLVED" || status === "CLOSED" ? touched : null,
        summary: `Load fixture ${n} ${"wide ".repeat(30)}`.slice(0, 200),
      };
    }),
  );
  const tickets = await prisma.ticket.findMany({ where: { requesterId: requester.id }, select: { id: true } });
  await prisma.actionTaken.createMany({
    data: tickets.map((ticket, n) => ({
      ticketId: ticket.id,
      performedById: staff.id,
      actionAt: new Date(now - n * 60_000),
      description: "d".repeat(2000),
      result: "r".repeat(1000),
      requestKey: randomUUID(),
    })),
  });
}, 60_000);

afterAll(async () => {
  await fixtures.remove();
  await prisma.$disconnect();
});

describe(`PERF-01 dashboards with ${EXTRA} extra Tickets and ${EXTRA} Actions Taken (AC-51)`, () => {
  it("has the data it claims to be measured against", async () => {
    const mine = { requester: { email: { contains: TAG } } };

    expect(await prisma.ticket.count({ where: mine })).toBe(EXTRA);
    expect(await prisma.actionTaken.count({ where: { ticket: mine } })).toBe(EXTRA);
  });

  it("answers the Requester dashboard in under a second, small, with lists still cut at 5", async () => {
    const { response, median } = await measure("/api/dashboard/requester", requesterCookie);

    expect(response.status).toBe(200);
    expect(median).toBeLessThan(LIMIT_MS);
    expect(Buffer.byteLength(response.text)).toBeLessThan(LIMIT_BYTES);
    expect(response.body.metrics[0].value).toBeGreaterThan(100);
    for (const list of [response.body.needsAttention, response.body.recentlyUpdated, response.body.recentlyResolved]) {
      expect(list).toHaveLength(5);
    }
  });

  it.each([
    ["IT Staff", () => staffCookie],
    ["an Administrator", () => adminCookie],
  ])("answers the staff dashboard for %s in under a second, small, with lists still cut at 5", async (_who, cookie) => {
    const { response, median } = await measure("/api/dashboard/staff", cookie());

    expect(response.status).toBe(200);
    expect(median).toBeLessThan(LIMIT_MS);
    expect(Buffer.byteLength(response.text)).toBeLessThan(LIMIT_BYTES);
    expect(response.body.recentlyUpdated).toHaveLength(5);
    expect(response.body.myRecentActions.length).toBeLessThanOrEqual(5);
  });

  it("gives the member of staff who did the work a preview, not 2000 characters, per row", async () => {
    const { response } = await measure("/api/dashboard/staff", staffCookie);

    expect(response.body.myRecentActions).toHaveLength(5);
    for (const row of response.body.myRecentActions) expect(row.descriptionPreview).toHaveLength(120);
  });
});
