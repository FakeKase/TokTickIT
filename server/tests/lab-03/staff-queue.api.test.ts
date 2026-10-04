import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";
import { fixtureUser } from "../helpers/users.js";
import { signInAs } from "../helpers/session.js";

// API-21 to API-26 (FR-13, BR-30, BR-31, AC-14, AC-22..AC-26).
//
// The queue returns every Ticket in the database, and this file shares that
// database with the seed and with whichever other test files are running
// beside it. So every fixture's Summary carries TAG, and each test narrows to
// it with `search` before asserting about order or membership. The handful of
// tests about the unfiltered queue assert only what holds whatever else is in
// there.

const prisma = createPrismaClient();
const app = createApp();

const TAG = "staffqueue-api-test";
const email = (who: string) => `${who}.${TAG}@toktickit.test`;

let staffId: number;
let colleagueId: number;
let staffCookie: string;
let adminCookie: string;
let requesterCookie: string;
let gatedStaffCookie: string;
let categoryId: number;
let otherCategoryId: number;

/** Minutes after a fixed instant, so Last Updated is something the tests set
 *  rather than something that depends on how fast the inserts ran. */
const at = (minutes: number) => new Date(Date.UTC(2026, 8, 1, 9, minutes));

const cleanup = async () => {
  const stale = { email: { contains: TAG } };
  await prisma.ticketComment.deleteMany({ where: { ticket: { requester: stale } } });
  await prisma.ticket.deleteMany({ where: { requester: stale } });
  await prisma.session.deleteMany({ where: { user: stale } });
  await prisma.user.deleteMany({ where: stale });
};

beforeAll(async () => {
  await cleanup();

  const [first, second, staff, colleague, admin, gated] = await Promise.all([
    prisma.user.create({
      data: fixtureUser({ name: `First ${TAG}`, email: email("first") }),
    }),
    prisma.user.create({
      data: fixtureUser({ name: `Second ${TAG}`, email: email("second") }),
    }),
    prisma.user.create({
      data: fixtureUser({ name: `Staff ${TAG}`, email: email("staff"), role: "IT_STAFF" }),
    }),
    prisma.user.create({
      data: fixtureUser({
        name: `Colleague ${TAG}`,
        email: email("colleague"),
        role: "IT_STAFF",
      }),
    }),
    prisma.user.create({
      data: fixtureUser({
        name: `Admin ${TAG}`,
        email: email("admin"),
        role: "ADMINISTRATOR",
      }),
    }),
    prisma.user.create({
      data: fixtureUser({
        name: `Gated ${TAG}`,
        email: email("gated"),
        role: "IT_STAFF",
        mustChangePassword: true,
      }),
    }),
  ]);
  staffId = staff.id;
  colleagueId = colleague.id;

  [staffCookie, adminCookie, requesterCookie, gatedStaffCookie] = await Promise.all([
    signInAs(app, staff.email),
    signInAs(app, admin.email),
    signInAs(app, first.email),
    signInAs(app, gated.email),
  ]);

  const categories = await prisma.category.findMany({ take: 2, orderBy: { id: "asc" } });
  expect(categories.length).toBe(2);
  [categoryId, otherCategoryId] = categories.map((category) => category.id);
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow();

  // Six Tickets, each a letter, inserted A to F. Three share HIGH so the
  // tie-break has something to break.
  //
  // `updated` deliberately runs in a different order from insertion. The last
  // sort key is id descending, so if Last Updated simply followed the ids, a
  // query that dropped the Last Updated tie-break would return the same order
  // and every tie-break assertion below would pass without testing anything.
  const fixtures = [
    { key: "A", updated: 3, requesterId: first.id, currentStatus: "NEW", itPriority: "URGENT", ownerId: null, word: "alpha" },
    { key: "B", updated: 6, requesterId: first.id, currentStatus: "IN_PROGRESS", itPriority: "HIGH", ownerId: staff.id, word: "bravo" },
    { key: "C", updated: 1, requesterId: second.id, currentStatus: "IN_PROGRESS", itPriority: "HIGH", ownerId: colleague.id, word: "charlie" },
    { key: "D", updated: 4, requesterId: second.id, currentStatus: "IN_PROGRESS", itPriority: "LOW", ownerId: staff.id, word: "delta" },
    { key: "E", updated: 2, requesterId: second.id, currentStatus: "RESOLVED", itPriority: "MEDIUM", ownerId: null, word: "echo" },
    { key: "F", updated: 5, requesterId: first.id, currentStatus: "NEW", itPriority: "HIGH", ownerId: null, word: "foxtrot" },
  ] as const;

  for (const [index, fixture] of fixtures.entries()) {
    await prisma.ticket.create({
      data: {
        ticketNumber: `QT-${TAG}-${fixture.key}`,
        requesterId: fixture.requesterId,
        ownerId: fixture.ownerId,
        // E alone sits in the second category, for the category filter.
        categoryId: fixture.key === "E" ? otherCategoryId : categoryId,
        relatedSystemId: relatedSystem.id,
        summary: `${fixture.word} ${TAG}`,
        description: "A queue fixture.",
        requestedPriority: "LOW",
        itPriority: fixture.itPriority,
        currentStatus: fixture.currentStatus,
        createdAt: at(index),
        updatedAt: at(fixture.updated),
      },
    });
  }
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const queue = (query: Record<string, string | number> = {}, cookie = staffCookie) =>
  request(app).get("/api/staff/tickets").query(query).set("Cookie", cookie);

/** The fixture set only, as letters in the order the API returned them. */
const letters = async (query: Record<string, string | number> = {}) => {
  const response = await queue({ search: TAG, ...query });
  expect(response.status).toBe(200);
  return (response.body.data as { ticketNumber: string }[])
    .map((ticket) => ticket.ticketNumber.slice(-1))
    .join("");
};

describe("AC-14 who may read the queue", () => {
  it("refuses a Requester with 403 and no data", async () => {
    const response = await queue({}, requesterCookie);

    expect(response.status).toBe(403);
    expect(response.body.data).toBeUndefined();
    expect(response.body.pagination).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(TAG);
  });

  it("refuses an anonymous caller with 401", async () => {
    const response = await request(app).get("/api/staff/tickets");

    expect(response.status).toBe(401);
    expect(response.body.data).toBeUndefined();
  });

  it("holds staff at the first-login gate like any other endpoint (BR-14)", async () => {
    const response = await queue({}, gatedStaffCookie);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(response.body.data).toBeUndefined();
  });

  it("serves an Administrator the same queue as IT Staff", async () => {
    const response = await queue({ search: TAG }, adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.pagination.totalItems).toBe(6);
  });
});

describe("API-21 the queue lists every Requester's Tickets (AC-22, FR-13)", () => {
  it("returns Tickets from more than one Requester, with ownership, status and both priorities", async () => {
    const response = await queue({ search: TAG, sortBy: "ticketNumber", sortDir: "asc" });

    expect(response.status).toBe(200);
    const rows = response.body.data;
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((row: { requester: { name: string } }) => row.requester.name))).toEqual(
      new Set([`First ${TAG}`, `Second ${TAG}`]),
    );

    expect(rows[1]).toEqual({
      id: expect.any(Number),
      ticketNumber: `QT-${TAG}-B`,
      summary: `bravo ${TAG}`,
      category: { id: categoryId, name: expect.any(String) },
      requester: { id: expect.any(Number), name: `First ${TAG}` },
      owner: { id: staffId, name: `Staff ${TAG}` },
      requestedPriority: "LOW",
      itPriority: "HIGH",
      currentStatus: "IN_PROGRESS",
      requesterResolvedAt: null,
      createdAt: at(1).toISOString(),
      updatedAt: at(6).toISOString(),
    });
  });

  it("reports an unassigned Ticket's owner as null, not as a missing key", async () => {
    const response = await queue({ search: `alpha ${TAG}` });

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toHaveProperty("owner", null);
  });

  it("carries names, never an email address or a hash", async () => {
    const response = await queue({ search: TAG });
    const body = JSON.stringify(response.body);

    expect(body).not.toContain("@toktickit.test");
    expect(body).not.toContain("passwordHash");
    expect(Object.keys(response.body.data[0].requester).sort()).toEqual(["id", "name"]);
  });

  it("includes Tickets that are not this test's, when nothing narrows it", async () => {
    // The one assertion made about the shared database: unfiltered, the queue
    // is at least as large as the fixture set, and says no filter was applied.
    const response = await queue({ pageSize: 50 });

    expect(response.status).toBe(200);
    expect(response.body.pagination.totalItems).toBeGreaterThanOrEqual(6);
    expect(response.body.filtered).toBe(false);
  });
});

describe("API-22 search (AC-23, BR-30)", () => {
  it("matches Summary and Ticket Number, partially and without regard to case", async () => {
    expect(await letters({ search: `CHARLIE ${TAG}` })).toBe("C");
    expect(await letters({ search: `qt-${TAG.toUpperCase()}-d` })).toBe("D");
  });

  it("answers a search that matches nothing with an empty page that says it was filtered", async () => {
    const response = await queue({ search: `no-such-ticket-${TAG}` });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination).toEqual({
      page: 1,
      pageSize: 10,
      totalItems: 0,
      totalPages: 0,
    });
    // What separates No-Results from an empty queue.
    expect(response.body.filtered).toBe(true);
  });

  it("does not call an ignored filter a filter", async () => {
    const response = await queue({ status: "BOGUS", owner: "nobody" });

    expect(response.status).toBe(200);
    expect(response.body.filtered).toBe(false);
  });
});

describe("API-23 filters (AC-24, BR-30)", () => {
  it("applies status and IT Priority together", async () => {
    // D is In Progress but Low; F is High but New. Neither may appear.
    expect(await letters({ status: "IN_PROGRESS", itPriority: "HIGH" })).toBe("BC");
  });

  it("filters by each on its own", async () => {
    expect(await letters({ status: "NEW" })).toBe("FA");
    expect(await letters({ itPriority: "HIGH" })).toBe("BFC");
    expect(await letters({ categoryId: otherCategoryId })).toBe("E");
  });

  it("ignores a filter value it does not recognise instead of failing", async () => {
    expect(await letters({ status: "ARCHIVED", itPriority: "CRITICAL", categoryId: "abc" })).toBe(
      "BFDAEC",
    );
  });
});

describe("API-24 sorting (AC-25, BR-31)", () => {
  it("defaults to Last Updated descending", async () => {
    expect(await letters()).toBe("BFDAEC");
  });

  it("sorts IT Priority descending as Urgent, High, Medium, Low, ties by Last Updated descending", async () => {
    // Urgent A; then the three Highs most recently updated first (B, F, C);
    // Medium E; Low D. Alphabetical order would put HIGH first and URGENT
    // last, and breaking the tie by id instead would give F, C, B.
    expect(await letters({ sortBy: "itPriority", sortDir: "desc" })).toBe("ABFCED");
  });

  it("keeps the tie-break descending when the sort itself ascends", async () => {
    expect(await letters({ sortBy: "itPriority", sortDir: "asc" })).toBe("DEBFCA");
  });

  it("sorts status in workflow order, not alphabetically", async () => {
    // New (F, A), In Progress (B, D, C), Resolved (E). Alphabetically In
    // Progress would lead.
    expect(await letters({ sortBy: "currentStatus", sortDir: "asc" })).toBe("FABDCE");
  });

  it("sorts by Ticket Number and by Created Date", async () => {
    expect(await letters({ sortBy: "ticketNumber", sortDir: "asc" })).toBe("ABCDEF");
    expect(await letters({ sortBy: "createdAt", sortDir: "asc" })).toBe("ABCDEF");
  });

  it("orders two Tickets updated in the same instant by id, newest first (BR-31)", async () => {
    // Their Summary avoids TAG on purpose, so they stay out of every other
    // test's six. Without the final id key the database is free to return
    // these in either order, and a row could repeat or vanish across pages.
    const twin = "twin-queue-tiebreak";
    const first = await prisma.user.findUniqueOrThrow({ where: { email: email("first") } });
    const relatedSystem = await prisma.relatedSystem.findFirstOrThrow();
    const ids: number[] = [];
    for (const key of ["1", "2"]) {
      const created = await prisma.ticket.create({
        data: {
          ticketNumber: `QT-${twin}-${key}`,
          requesterId: first.id,
          categoryId,
          relatedSystemId: relatedSystem.id,
          summary: twin,
          description: "A queue fixture.",
          requestedPriority: "LOW",
          itPriority: "LOW",
          createdAt: at(30),
          updatedAt: at(30),
        },
      });
      ids.push(created.id);
    }

    const response = await queue({ search: twin });

    expect(response.body.data.map((ticket: { id: number }) => ticket.id)).toEqual([
      ids[1],
      ids[0],
    ]);
  });

  it("falls back to the default for a sort key that is not offered", async () => {
    expect(await letters({ sortBy: "passwordHash" })).toBe("BFDAEC");
    expect(await letters({ sortBy: "requestedPriority" })).toBe("BFDAEC");
  });
});

describe("API-25 pagination (AC-26, BR-30)", () => {
  it("pages through the set without repeating or dropping a Ticket", async () => {
    const pages = [
      await letters({ pageSize: 2, page: 1 }),
      await letters({ pageSize: 2, page: 2 }),
      await letters({ pageSize: 2, page: 3 }),
    ];

    expect(pages).toEqual(["BF", "DA", "EC"]);
  });

  it("reports the pagination block for the page it actually served", async () => {
    const response = await queue({ search: TAG, pageSize: 4, page: 2 });

    expect(response.body.pagination).toEqual({
      page: 2,
      pageSize: 4,
      totalItems: 6,
      totalPages: 2,
    });
    expect(response.body.data).toHaveLength(2);
  });

  it("clamps a page past the end to the last real page", async () => {
    const response = await queue({ search: TAG, pageSize: 4, page: 99 });

    expect(response.status).toBe(200);
    expect(response.body.pagination.page).toBe(2);
    // The last page's rows, not an empty list that would read as "no Tickets".
    expect(response.body.data).toHaveLength(2);
  });

  it("clamps a page below one, and a page that is not a number, to the first", async () => {
    for (const page of ["0", "-3", "abc"]) {
      const response = await queue({ search: TAG, pageSize: 4, page });

      expect([page, response.status]).toEqual([page, 200]);
      expect([page, response.body.pagination.page]).toEqual([page, 1]);
      expect([page, response.body.data.length]).toEqual([page, 4]);
    }
  });

  it("clamps pageSize into 1 to 50, and takes the default for one that is not a number", async () => {
    const size = async (pageSize: string) =>
      (await queue({ search: TAG, pageSize })).body.pagination.pageSize;

    expect(await size("0")).toBe(1);
    expect(await size("-10")).toBe(1);
    expect(await size("999")).toBe(50);
    expect(await size("abc")).toBe(10);
  });

  it("stays on page 1 of nothing when the set is empty", async () => {
    const response = await queue({ search: `no-such-ticket-${TAG}`, page: 7 });

    expect(response.body.pagination).toEqual({
      page: 1,
      pageSize: 10,
      totalItems: 0,
      totalPages: 0,
    });
  });
});

describe("API-26 the owner filter (BR-30)", () => {
  it("returns exactly the caller's Tickets for owner=me", async () => {
    expect(await letters({ owner: "me" })).toBe("BD");
  });

  it("means the caller, whoever that is", async () => {
    // The Administrator owns none of the fixtures, so the same query string
    // that gave IT Staff two Tickets gives them nothing.
    const response = await queue({ search: TAG, owner: "me" }, adminCookie);

    expect(response.body.data).toEqual([]);
    expect(response.body.filtered).toBe(true);
  });

  it("returns exactly the unowned Tickets for owner=unassigned", async () => {
    expect(await letters({ owner: "unassigned" })).toBe("FAE");
  });

  it("returns a named colleague's Tickets for owner=<id>", async () => {
    expect(await letters({ owner: colleagueId })).toBe("C");
  });

  it("ignores an owner value that is none of those", async () => {
    expect(await letters({ owner: "nobody" })).toBe("BFDAEC");
  });
});
