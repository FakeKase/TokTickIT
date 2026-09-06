import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";

// API-05, API-06, API-07, API-08, API-23, API-24, API-25, API-26:
// GET /api/tickets. Ownership is the security boundary here (BR-07/BR-08),
// so it is proved against a second Requester's real rows rather than a mock.

const prisma = createPrismaClient();
const app = createApp();

const TAG = "my-tickets.api.test";

let ownerId: number;
let otherId: number;
let emptyId: number;
let hardwareId: number;
let softwareId: number;
let relatedSystemId: number;

/** Ticket ids owned by `ownerId`, in creation order. */
const owned: number[] = [];

let fixtureCounter = 0;
const nextFixtureNumber = () => (fixtureCounter += 1);

async function seedTicket(
  requesterId: number,
  overrides: {
    summary: string;
    categoryId?: number;
    requestedPriority?: "LOW" | "MEDIUM" | "HIGH";
    createdAt?: Date;
  },
) {
  const created = await prisma.ticket.create({
    data: {
      // Spec-shaped and unique: fixtures are deleted in afterAll, but a
      // malformed number here would still undermine the search-by-number test.
      ticketNumber: `TKT-2026-${String(900000 + nextFixtureNumber()).padStart(6, "0")}`,
      requesterId,
      categoryId: overrides.categoryId ?? hardwareId,
      relatedSystemId,
      summary: overrides.summary,
      description: "Seeded for the My Tickets query tests.",
      requestedPriority: overrides.requestedPriority ?? "MEDIUM",
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  });
  return created.id;
}

function list(params: Record<string, string | number> = {}) {
  const query = new URLSearchParams({ requesterId: String(ownerId) });
  for (const [key, value] of Object.entries(params)) {
    query.set(key, String(value));
  }
  return request(app).get(`/api/tickets?${query.toString()}`);
}

beforeAll(async () => {
  const stale = { email: { contains: TAG } };
  await prisma.attachment.deleteMany({ where: { ticket: { requester: stale } } });
  await prisma.ticket.deleteMany({ where: { requester: stale } });
  await prisma.requester.deleteMany({ where: stale });

  const [owner, other, empty] = await Promise.all([
    prisma.requester.create({
      data: { name: `Owner ${TAG}`, email: `owner.${TAG}@toktickit.test` },
    }),
    prisma.requester.create({
      data: { name: `Other ${TAG}`, email: `other.${TAG}@toktickit.test` },
    }),
    prisma.requester.create({
      data: { name: `Empty ${TAG}`, email: `empty.${TAG}@toktickit.test` },
    }),
  ]);
  ownerId = owner.id;
  otherId = other.id;
  emptyId = empty.id;

  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  hardwareId = categories[0].id;
  softwareId = categories[1].id;
  relatedSystemId = (await prisma.relatedSystem.findFirstOrThrow()).id;

  // 12 owned Tickets: enough to page, with a deterministic createdAt ladder so
  // ordering assertions do not depend on insertion timing.
  const base = new Date("2026-01-01T00:00:00.000Z").getTime();
  for (let i = 0; i < 12; i += 1) {
    owned.push(
      await seedTicket(ownerId, {
        summary: i === 0 ? "VPN keeps dropping" : `Owned ticket ${i}`,
        categoryId: i % 2 === 0 ? hardwareId : softwareId,
        requestedPriority: i === 0 ? "HIGH" : i % 3 === 0 ? "LOW" : "MEDIUM",
        createdAt: new Date(base + i * 86_400_000),
      }),
    );
  }

  // Deliberately out of step: the newest row by id carries the OLDEST
  // createdAt. Without it, id-desc and createdAt-desc produce identical
  // output on this data and the AC-16 tie-break test cannot tell them apart.
  owned.push(
    await seedTicket(ownerId, {
      summary: "Backdated ticket",
      requestedPriority: "MEDIUM",
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
    }),
  );

  await seedTicket(otherId, { summary: "VPN keeps dropping for someone else" });
});

afterAll(async () => {
  const owners = { in: [ownerId, otherId, emptyId] };
  await prisma.attachment.deleteMany({ where: { ticket: { requesterId: owners } } });
  await prisma.ticket.deleteMany({ where: { requesterId: owners } });
  await prisma.requester.deleteMany({ where: { email: { contains: TAG } } });
  await prisma.$disconnect();
});

describe("API-05 ownership scoping (AC-11, BR-07/BR-08)", () => {
  it("returns only the asserted Requester's Tickets", async () => {
    const response = await list({ pageSize: 50 });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(13);
    expect(response.body.pagination.totalItems).toBe(13);
  });

  it("never leaks another Requester's Ticket, even on a matching search", async () => {
    // Both Requesters own a Ticket whose summary contains "VPN".
    const response = await list({ search: "VPN", pageSize: 50 });

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].summary).toBe("VPN keeps dropping");
  });

  it("scopes to the other Requester when they ask", async () => {
    const response = await request(app).get(`/api/tickets?requesterId=${otherId}`);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].summary).toContain("someone else");
  });

  it("rejects a missing or non-numeric requesterId", async () => {
    const missing = await request(app).get("/api/tickets");
    const bogus = await request(app).get("/api/tickets?requesterId=abc");

    expect(missing.status).toBe(400);
    expect(bogus.status).toBe(400);
  });

  it("returns an empty page for a Requester who owns nothing", async () => {
    const response = await request(app).get(`/api/tickets?requesterId=${emptyId}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination.totalItems).toBe(0);
    // BR-28: no narrowing parameter was supplied, so this is Empty, not
    // No-Results — the client keys its copy off this flag.
    expect(response.body.filtered).toBe(false);
  });
});

describe("API-26 search (AC-33, BR-09)", () => {
  it("matches the Summary case-insensitively and partially", async () => {
    const response = await list({ search: "vpn keeps" });

    expect(response.body.data).toHaveLength(1);
  });

  it("matches the Ticket Number too", async () => {
    const first = await list({ pageSize: 1 });
    const number = first.body.data[0].ticketNumber;

    const response = await list({ search: number.slice(-6) });

    expect(response.body.data.length).toBeGreaterThanOrEqual(1);
    expect(response.body.data.map((t: { ticketNumber: string }) => t.ticketNumber)).toContain(
      number,
    );
  });

  it("reports a filtered zero-result set distinctly from an empty account", async () => {
    const response = await list({ search: "nothing matches this string" });

    expect(response.body.data).toEqual([]);
    expect(response.body.pagination.totalItems).toBe(0);
    // BR-28's No-Results half.
    expect(response.body.filtered).toBe(true);
  });
});

describe("API-23 filters (AC-30, BR-10)", () => {
  it("filters by Category", async () => {
    const response = await list({ categoryId: softwareId, pageSize: 50 });

    expect(response.body.data).toHaveLength(6);
  });

  it("filters by Requested Priority", async () => {
    const response = await list({ requestedPriority: "HIGH", pageSize: 50 });

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].summary).toBe("VPN keeps dropping");
  });

  it("combines Category, Priority and search with AND", async () => {
    const response = await list({
      categoryId: hardwareId,
      requestedPriority: "HIGH",
      search: "VPN",
      pageSize: 50,
    });

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].summary).toBe("VPN keeps dropping");
  });

  it("returns nothing when the combination excludes everything", async () => {
    const response = await list({
      categoryId: softwareId,
      requestedPriority: "HIGH",
      pageSize: 50,
    });

    expect(response.body.data).toEqual([]);
    expect(response.body.filtered).toBe(true);
  });

  it("ignores an unparseable filter rather than failing the request", async () => {
    // api-spec.md §5: requesterId is the only strict parameter.
    const response = await list({ categoryId: "not-a-number", pageSize: 50 });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(13);
    expect(response.body.filtered).toBe(false);
  });
});

describe("API-24 sorting (AC-31, AC-16, BR-11)", () => {
  it("defaults to Created Date descending", async () => {
    const response = await list({ pageSize: 50 });

    const dates = response.body.data.map((t: { createdAt: string }) =>
      new Date(t.createdAt).getTime(),
    );
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("sorts by Ticket Number ascending when asked", async () => {
    const response = await list({ sortBy: "ticketNumber", sortDir: "asc", pageSize: 50 });

    const numbers = response.body.data.map((t: { ticketNumber: string }) => t.ticketNumber);
    expect(numbers).toEqual([...numbers].sort());
  });

  it("falls back to the default for an unrecognized sortBy", async () => {
    // api-spec.md §5 says an invalid sort value falls back rather than 400.
    const response = await list({ sortBy: "; DROP TABLE", sortDir: "sideways", pageSize: 50 });

    expect(response.status).toBe(200);
    const dates = response.body.data.map((t: { createdAt: string }) =>
      new Date(t.createdAt).getTime(),
    );
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("AC-16: sorts Requested Priority High -> Medium -> Low, not alphabetically", async () => {
    // This is also the guard on schema.prisma's enum declaration order:
    // Postgres sorts a native enum by declaration sequence, so reordering
    // LOW/MEDIUM/HIGH there would silently invert this and fail here.
    // Alphabetically descending would be MEDIUM, LOW, HIGH — nothing like it.
    const response = await list({
      sortBy: "requestedPriority",
      sortDir: "desc",
      pageSize: 50,
    });

    const priorities = response.body.data.map(
      (t: { requestedPriority: string }) => t.requestedPriority,
    );
    const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as Record<string, number>;

    expect(priorities[0]).toBe("HIGH");
    expect(priorities.at(-1)).toBe("LOW");
    expect(priorities.map((p: string) => rank[p])).toEqual(
      [...priorities.map((p: string) => rank[p])].sort((a, b) => a - b),
    );
  });

  it("AC-16: breaks a Requested Priority tie by Created Date descending", async () => {
    const response = await list({
      sortBy: "requestedPriority",
      sortDir: "desc",
      requestedPriority: "MEDIUM",
      pageSize: 50,
    });

    // Every row here shares a priority, so only the tie-break orders them —
    // and AC-16 names Created Date, not id.
    const dates = response.body.data.map((t: { createdAt: string }) =>
      new Date(t.createdAt).getTime(),
    );
    expect(dates.length).toBeGreaterThan(1);
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("keeps paging stable when the sort key ties", async () => {
    // Every row here shares a currentStatus, so only the id tie-break stops
    // the two pages from overlapping.
    const [pageOne, pageTwo] = await Promise.all([
      list({ sortBy: "currentStatus", pageSize: 6, page: 1 }),
      list({ sortBy: "currentStatus", pageSize: 6, page: 2 }),
    ]);

    const first = pageOne.body.data.map((t: { id: number }) => t.id);
    const second = pageTwo.body.data.map((t: { id: number }) => t.id);

    expect(first).toHaveLength(6);
    expect(second).toHaveLength(6);
    expect(first.filter((id: number) => second.includes(id))).toEqual([]);
  });
});

describe("API-25 pagination (AC-15, AC-32, BR-12)", () => {
  it("returns a non-overlapping page 2", async () => {
    const [pageOne, pageTwo] = await Promise.all([
      list({ page: 1, pageSize: 5 }),
      list({ page: 2, pageSize: 5 }),
    ]);

    const first = pageOne.body.data.map((t: { id: number }) => t.id);
    const second = pageTwo.body.data.map((t: { id: number }) => t.id);

    expect(first.filter((id: number) => second.includes(id))).toEqual([]);
    expect(pageTwo.body.pagination.page).toBe(2);
  });

  it("reports totalItems and totalPages for the filtered set", async () => {
    const response = await list({ pageSize: 5 });

    expect(response.body.pagination).toMatchObject({
      page: 1,
      pageSize: 5,
      totalItems: 13,
      totalPages: 3,
    });
  });

  it("clamps a non-positive or non-numeric page to 1", async () => {
    for (const page of [0, -3, "abc"]) {
      const response = await list({ page });
      expect(response.status).toBe(200);
      expect(response.body.pagination.page).toBe(1);
    }
  });

  it("clamps pageSize into 1..50 instead of rejecting it", async () => {
    const tooBig = await list({ pageSize: 500 });
    const tooSmall = await list({ pageSize: 0 });

    expect(tooBig.body.pagination.pageSize).toBe(50);
    expect(tooSmall.body.pagination.pageSize).toBe(1);
  });

  it("returns an empty page past the end rather than an error", async () => {
    const response = await list({ page: 99 });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination.totalItems).toBe(13);
  });
});

describe("API-05 response shape", () => {
  it("returns the columns My Tickets renders, and nothing more", async () => {
    const response = await list({ pageSize: 1 });

    expect(Object.keys(response.body.data[0]).sort()).toEqual([
      "categoryName",
      "createdAt",
      "currentStatus",
      "id",
      "requestedPriority",
      "summary",
      "ticketNumber",
      "updatedAt",
    ]);
    // description is not listed anywhere on this screen, so it is not sent.
    expect(response.body.data[0].description).toBeUndefined();
  });
});
