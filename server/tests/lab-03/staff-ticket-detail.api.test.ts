import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { unlink } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { fileURLToPath } from "node:url";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";
import { fixtureUser } from "../helpers/users.js";
import { signInAs } from "../helpers/session.js";

// API-15, API-27 to API-34 (FR-14..FR-17, BR-19..BR-23; AC-21, AC-27..AC-33).
//
// Every write here is checked twice: the response, and then the row. A route
// that answered 409 and wrote anyway would pass a test that only read the
// status code, and "nothing is written" is half of what BR-22 promises.

const prisma = createPrismaClient();
const app = createApp();

const TAG = "staffdetail-api-test";

/** Where the server writes uploads; the test removes what it put there. */
const UPLOADS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "uploads",
);
const email = (who: string) => `${who}.${TAG}@toktickit.test`;

let requesterId: number;
let staffId: number;
let colleagueId: number;
let adminId: number;
let inactiveStaffId: number;
let ticketId: number;
let staffCookie: string;
let colleagueCookie: string;
let adminCookie: string;
let requesterCookie: string;
let categoryId: number;
let relatedSystemId: number;

const cleanup = async () => {
  const stale = { email: { contains: TAG } };
  await prisma.ticketComment.deleteMany({ where: { ticket: { requester: stale } } });
  // Lab 4: Actions Taken restrict the deletion of their Ticket and of the
  // user who performed them, so they go first.
  await prisma.actionTaken.deleteMany({ where: { ticket: { requester: stale } } });

  // The files first, while the rows that name them still exist. Deleting the
  // rows alone leaves one orphaned upload on disk for every run.
  const uploaded = await prisma.attachment.findMany({
    where: { ticket: { requester: stale } },
    select: { storedFilename: true },
  });
  await Promise.all(
    uploaded.map(({ storedFilename }) =>
      unlink(path.join(UPLOADS_DIR, storedFilename)).catch(() => {}),
    ),
  );
  await prisma.attachment.deleteMany({ where: { ticket: { requester: stale } } });
  await prisma.ticket.deleteMany({ where: { requester: stale } });
  await prisma.session.deleteMany({ where: { user: stale } });
  await prisma.user.deleteMany({ where: stale });
};

/** A moment safely in the past, so "updatedAt advanced" is a real statement
 *  and not a comparison between two clock readings a millisecond apart. */
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");

beforeAll(async () => {
  await cleanup();

  const make = (who: string, role?: "IT_STAFF" | "ADMINISTRATOR", isActive = true) =>
    prisma.user.create({
      data: fixtureUser({ name: `${who} ${TAG}`, email: email(who), role, isActive }),
    });

  const [requester, staff, colleague, admin, inactive] = await Promise.all([
    make("requester"),
    make("staff", "IT_STAFF"),
    make("colleague", "IT_STAFF"),
    make("admin", "ADMINISTRATOR"),
    make("inactive", "IT_STAFF", false),
  ]);
  requesterId = requester.id;
  staffId = staff.id;
  colleagueId = colleague.id;
  adminId = admin.id;
  inactiveStaffId = inactive.id;

  [staffCookie, colleagueCookie, adminCookie, requesterCookie] = await Promise.all([
    signInAs(app, staff.email),
    signInAs(app, colleague.email),
    signInAs(app, admin.email),
    signInAs(app, requester.email),
  ]);

  categoryId = (await prisma.category.findFirstOrThrow()).id;
  relatedSystemId = (await prisma.relatedSystem.findFirstOrThrow()).id;

  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber: `SD-${TAG}`,
      requesterId,
      categoryId,
      relatedSystemId,
      summary: `Detail fixture ${TAG}`,
      description: "The laptop will not charge from either port.",
      requestedPriority: "LOW",
      itPriority: "LOW",
    },
  });
  ticketId = ticket.id;
});

/** Puts the fixture Ticket into a known state before each test. */
const reset = (
  state: {
    currentStatus?: string;
    ownerId?: number | null;
    itPriority?: string;
    requesterResolvedAt?: Date | null;
  } = {},
) =>
  prisma.ticket.update({
    where: { id: ticketId },
    data: {
      currentStatus: "NEW",
      ownerId: null,
      itPriority: "LOW",
      requestedPriority: "LOW",
      requesterResolvedAt: null,
      updatedAt: LONG_AGO,
      ...state,
    } as never,
  });

beforeEach(async () => {
  await reset();
  // Lab 4: a Ticket can be Resolved only once work is recorded on it, and the
  // latest of it asks for no follow-up (Lab 4 BR-13). These tests are about
  // the Lab 3 rules, the matrix and the owner, so the fixture Ticket always
  // carries one such Action Taken and the gate is never what refuses a move
  // here. The gate has its own file, lab-04/ticket-workflow.api.test.ts.
  await prisma.actionTaken.deleteMany({ where: { ticketId } });
  await prisma.actionTaken.create({
    data: {
      ticketId,
      performedById: staffId,
      requestKey: `fixture-${TAG}`,
      actionAt: new Date(),
      description: "Fixture work, so that the resolution gate is met.",
      result: "Done.",
    },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const row = () => prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });

const detail = (cookie = staffCookie, id: number | string = ticketId) =>
  request(app).get(`/api/staff/tickets/${id}`).set("Cookie", cookie);

/**
 * One workflow change.
 *
 * Lab 4 requires every such request to name the version of the Ticket it was
 * based on (Lab 4 BR-16). These tests are not about that rule, so the helper
 * reads the current version and sends it, as a screen that had just loaded
 * the Ticket would. A test that is about a stale copy passes its own
 * `expectedVersion` in the body and this leaves it alone.
 */
const patch = async (
  what: "owner" | "it-priority" | "status",
  body: unknown,
  cookie = staffCookie,
  id: number | string = ticketId,
) => {
  const current = await prisma.ticket.findUnique({
    where: { id: Number(id) || 0 },
    select: { version: true },
  });
  const isObject = typeof body === "object" && body !== null;
  return request(app)
    .patch(`/api/staff/tickets/${id}/${what}`)
    .set("Cookie", cookie)
    .send(
      isObject && !("expectedVersion" in body)
        ? { ...body, expectedVersion: current?.version ?? 1 }
        : (body as object),
    );
};

describe("who may use the staff Ticket endpoints (AC-14, AC-21)", () => {
  it("API-15: refuses a Requester on every one, with 403, no Ticket data, and nothing written", async () => {
    await reset({ currentStatus: "IN_PROGRESS", ownerId: staffId });

    const attempts = [
      await detail(requesterCookie),
      await patch("status", { currentStatus: "RESOLVED" }, requesterCookie),
      await patch("status", { currentStatus: "CLOSED" }, requesterCookie),
      await patch("owner", { ownerId: null }, requesterCookie),
      await patch("it-priority", { itPriority: "URGENT" }, requesterCookie),
      await request(app).get("/api/staff/assignable-users").set("Cookie", requesterCookie),
    ];

    for (const response of attempts) {
      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain(TAG);
    }

    // It is the Requester's own Ticket, and they still may not move it (BR-05).
    const after = await row();
    expect(after.currentStatus).toBe("IN_PROGRESS");
    expect(after.ownerId).toBe(staffId);
    expect(after.itPriority).toBe("LOW");
    expect(after.updatedAt).toEqual(LONG_AGO);
  });

  it("refuses an anonymous caller with 401", async () => {
    const responses = [
      await request(app).get(`/api/staff/tickets/${ticketId}`),
      await request(app).patch(`/api/staff/tickets/${ticketId}/status`).send({ currentStatus: "OPEN" }),
      await request(app).get("/api/staff/assignable-users"),
    ];

    for (const response of responses) expect(response.status).toBe(401);
    expect((await row()).currentStatus).toBe("NEW");
  });

  it("lets an Administrator do what IT Staff can", async () => {
    expect((await detail(adminCookie)).status).toBe(200);
    expect((await patch("owner", { ownerId: adminId }, adminCookie)).status).toBe(200);
    expect((await patch("status", { currentStatus: "OPEN" }, adminCookie)).status).toBe(200);

    const after = await row();
    expect(after.ownerId).toBe(adminId);
    expect(after.currentStatus).toBe("OPEN");
  });
});

describe("opening a Ticket as staff (FR-14)", () => {
  it("returns the whole Ticket, with where it may go next", async () => {
    await reset({ currentStatus: "IN_PROGRESS", ownerId: staffId, itPriority: "HIGH" });

    const response = await detail();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: ticketId,
      ticketNumber: `SD-${TAG}`,
      summary: `Detail fixture ${TAG}`,
      description: "The laptop will not charge from either port.",
      requestedPriority: "LOW",
      itPriority: "HIGH",
      currentStatus: "IN_PROGRESS",
      requesterResolvedAt: null,
      // Lab 4 adds these two, and `blockedReason` on each move below.
      version: expect.any(Number),
      resolvedAt: null,
      createdAt: expect.any(String),
      updatedAt: LONG_AGO.toISOString(),
      category: { id: categoryId, name: expect.any(String) },
      relatedSystem: { id: relatedSystemId, name: expect.any(String) },
      requester: { id: requesterId, name: `requester ${TAG}` },
      owner: { id: staffId, name: `staff ${TAG}` },
      attachments: [],
      transitions: [
        { to: "WAITING_FOR_REQUESTER", requiresOwner: false, blockedReason: null },
        { to: "RESOLVED", requiresOwner: true, blockedReason: null },
        { to: "CANCELLED", requiresOwner: false, blockedReason: null },
      ],
      ownerRequired: false,
    });
  });

  it("says when the Ticket must keep its owner, in step with what unassign will do", async () => {
    for (const currentStatus of ["NEW", "IN_PROGRESS", "RESOLVED", "CLOSED", "CANCELLED"]) {
      await reset({ currentStatus, ownerId: staffId });

      const flagged = (await detail()).body.ownerRequired;
      const unassign = await patch("owner", { ownerId: null });

      // The flag and the refusal are the same rule, so they must agree.
      expect([currentStatus, flagged]).toEqual([currentStatus, unassign.status === 409]);
    }
  });

  it("carries no email address and no hash", async () => {
    const body = JSON.stringify((await detail()).body);

    expect(body).not.toContain("@toktickit.test");
    expect(body).not.toContain("passwordHash");
  });

  it("answers 404 for an id that is not a Ticket, and for one that is not a number", async () => {
    for (const id of [99999999, "abc", "0", "-3", "1.5"]) {
      const response = await detail(staffCookie, id);
      expect([id, response.status]).toEqual([id, 404]);
    }
  });

  it("does not read, any more than it writes: opening leaves Last Updated alone", async () => {
    await detail();
    expect((await row()).updatedAt).toEqual(LONG_AGO);
  });
});

describe("API-27 claim (AC-27, BR-20)", () => {
  it("makes the acting user the owner and advances Last Updated", async () => {
    const response = await patch("owner", { ownerId: staffId });

    expect(response.status).toBe(200);
    expect(response.body.owner).toEqual({ id: staffId, name: `staff ${TAG}` });

    const after = await row();
    expect(after.ownerId).toBe(staffId);
    expect(after.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
  });

  it("shows up in the queue", async () => {
    await patch("owner", { ownerId: staffId });

    const queue = await request(app)
      .get("/api/staff/tickets")
      .query({ search: `SD-${TAG}`, owner: "me" })
      .set("Cookie", staffCookie);

    expect(queue.body.data.map((ticket: { id: number }) => ticket.id)).toEqual([ticketId]);
  });

  it("can be taken over from a colleague who holds it", async () => {
    await reset({ ownerId: colleagueId });

    const response = await patch("owner", { ownerId: staffId });

    expect(response.status).toBe(200);
    expect((await row()).ownerId).toBe(staffId);
  });
});

describe("API-28 reassign (AC-28, BR-20)", () => {
  it("moves ownership to another active IT Staff user and advances Last Updated", async () => {
    await reset({ ownerId: staffId });

    const response = await patch("owner", { ownerId: colleagueId });

    expect(response.status).toBe(200);
    expect(response.body.owner.id).toBe(colleagueId);

    const after = await row();
    expect(after.ownerId).toBe(colleagueId);
    expect(after.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
  });

  it("accepts an Administrator as the new owner", async () => {
    const response = await patch("owner", { ownerId: adminId });

    expect(response.status).toBe(200);
    expect((await row()).ownerId).toBe(adminId);
  });

  it("writes nothing when the owner named is the owner already", async () => {
    await reset({ ownerId: staffId });

    const response = await patch("owner", { ownerId: staffId });

    // Still 200: the Ticket is as asked. But Last Updated must not move, or a
    // no-op would float the Ticket to the top of the queue.
    expect(response.status).toBe(200);
    expect(response.body.owner.id).toBe(staffId);
    expect((await row()).updatedAt).toEqual(LONG_AGO);
  });

  it("unassigns with null", async () => {
    await reset({ ownerId: staffId });

    const response = await patch("owner", { ownerId: null });

    expect(response.status).toBe(200);
    expect(response.body.owner).toBeNull();
    expect((await row()).ownerId).toBeNull();
  });

  it("will not unassign a Resolved or Closed Ticket (BR-23)", async () => {
    for (const currentStatus of ["RESOLVED", "CLOSED"]) {
      await reset({ currentStatus, ownerId: staffId });

      const response = await patch("owner", { ownerId: null });

      expect([currentStatus, response.status]).toEqual([currentStatus, 409]);
      expect(response.body.error).toMatch(/must keep its Ticket Owner/);
      const after = await row();
      expect(after.ownerId).toBe(staffId);
      expect(after.updatedAt).toEqual(LONG_AGO);
    }
  });

  it("still lets a Resolved Ticket change hands", async () => {
    await reset({ currentStatus: "RESOLVED", ownerId: staffId });

    const response = await patch("owner", { ownerId: colleagueId });

    expect(response.status).toBe(200);
    expect((await row()).ownerId).toBe(colleagueId);
  });
});

describe("API-29 who may own a Ticket (AC-29, BR-19)", () => {
  it("refuses a Requester, an inactive staff user and an id that is nobody, identically", async () => {
    await reset({ ownerId: staffId });

    const bodies: string[] = [];
    for (const ownerId of [requesterId, inactiveStaffId, 99999999]) {
      const response = await patch("owner", { ownerId });

      expect([ownerId, response.status]).toEqual([ownerId, 409]);
      bodies.push(JSON.stringify(response.body));
    }

    // One answer for all three, so the endpoint cannot be used to learn which
    // ids are accounts or which accounts are switched off.
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain("Ticket Owner must be an active IT Staff or Administrator");

    const after = await row();
    expect(after.ownerId).toBe(staffId);
    expect(after.updatedAt).toEqual(LONG_AGO);
  });

  it("answers 400 for an ownerId that is not an id or null", async () => {
    await reset({ ownerId: staffId });

    for (const body of [{}, { ownerId: "9" }, { ownerId: 1.5 }, { ownerId: 0 }, { ownerId: -1 }, { ownerId: true }, { ownerId: [staffId] }]) {
      const response = await patch("owner", body);

      expect([body, response.status]).toEqual([body, 400]);
      expect(response.body.fields.ownerId).toBeTruthy();
    }
    expect((await row()).ownerId).toBe(staffId);
  });

  it("answers 400, not 500, for a request with no body at all", async () => {
    const response = await request(app)
      .patch(`/api/staff/tickets/${ticketId}/owner`)
      .set("Cookie", staffCookie);

    expect(response.status).toBe(400);
  });

  it("answers 404 for a Ticket that does not exist", async () => {
    expect((await patch("owner", { ownerId: staffId }, staffCookie, 99999999)).status).toBe(404);
  });
});

describe("API-34 the assignable-user list (FR-15, BR-19)", () => {
  it("offers active IT Staff and Administrators, and nobody else", async () => {
    const response = await request(app)
      .get("/api/staff/assignable-users")
      .set("Cookie", staffCookie);

    expect(response.status).toBe(200);
    const ours = response.body.filter((user: { name: string }) => user.name.includes(TAG));

    expect(ours).toEqual([
      { id: adminId, name: `admin ${TAG}`, role: "ADMINISTRATOR" },
      { id: colleagueId, name: `colleague ${TAG}`, role: "IT_STAFF" },
      { id: staffId, name: `staff ${TAG}`, role: "IT_STAFF" },
    ]);
  });

  it("holds across the whole list, not just the fixtures", async () => {
    const response = await request(app)
      .get("/api/staff/assignable-users")
      .set("Cookie", staffCookie);

    const listed = await prisma.user.findMany({
      where: { id: { in: response.body.map((user: { id: number }) => user.id) } },
      select: { isActive: true, role: true },
    });

    expect(listed.length).toBe(response.body.length);
    expect(listed.every((user) => user.isActive && user.role !== "REQUESTER")).toBe(true);
    // id, name and role only: this list must not become a directory.
    expect(Object.keys(response.body[0]).sort()).toEqual(["id", "name", "role"]);
  });

  it("can be assigned exactly as listed: every entry is accepted as an owner", async () => {
    const response = await request(app)
      .get("/api/staff/assignable-users")
      .set("Cookie", staffCookie);
    const ours = response.body.filter((user: { name: string }) => user.name.includes(TAG));

    for (const user of ours) {
      expect([user.name, (await patch("owner", { ownerId: user.id })).status]).toEqual([user.name, 200]);
    }
  });
});

describe("API-30 IT Priority (AC-30, BR-21)", () => {
  it("sets IT Priority and leaves Requested Priority as the Requester left it", async () => {
    const response = await patch("it-priority", { itPriority: "URGENT" });

    expect(response.status).toBe(200);
    expect(response.body.itPriority).toBe("URGENT");
    expect(response.body.requestedPriority).toBe("LOW");

    const after = await row();
    expect(after.itPriority).toBe("URGENT");
    expect(after.requestedPriority).toBe("LOW");
    expect(after.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
  });

  it("ignores a requestedPriority sent alongside", async () => {
    await patch("it-priority", { itPriority: "HIGH", requestedPriority: "HIGH" });

    expect((await row()).requestedPriority).toBe("LOW");
  });

  it("answers 400 for a value that is not one of the four", async () => {
    for (const body of [{}, { itPriority: "CRITICAL" }, { itPriority: "urgent" }, { itPriority: 3 }, { itPriority: null }]) {
      const response = await patch("it-priority", body);

      expect([body, response.status]).toEqual([body, 400]);
    }
    const after = await row();
    expect(after.itPriority).toBe("LOW");
    expect(after.updatedAt).toEqual(LONG_AGO);
  });

  it("writes nothing when the priority is the one already set", async () => {
    const response = await patch("it-priority", { itPriority: "LOW" });

    expect(response.status).toBe(200);
    expect((await row()).updatedAt).toEqual(LONG_AGO);
  });

  it("answers 404 for a Ticket that does not exist", async () => {
    expect((await patch("it-priority", { itPriority: "HIGH" }, staffCookie, 99999999)).status).toBe(404);
  });
});

describe("status changes (FR-17, BR-22, BR-23)", () => {
  it("API-31: refuses In Progress to Closed with 409 and writes nothing (AC-31)", async () => {
    await reset({ currentStatus: "IN_PROGRESS", ownerId: staffId });

    const response = await patch("status", { currentStatus: "CLOSED" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Cannot move a Ticket from In Progress to Closed" });

    const after = await row();
    expect(after.currentStatus).toBe("IN_PROGRESS");
    expect(after.updatedAt).toEqual(LONG_AGO);
  });

  it("API-32: moves an owned In Progress Ticket to Resolved (AC-32)", async () => {
    await reset({ currentStatus: "IN_PROGRESS", ownerId: staffId });

    const response = await patch("status", { currentStatus: "RESOLVED" });

    expect(response.status).toBe(200);
    expect(response.body.currentStatus).toBe("RESOLVED");
    // The next moves come back with it, read from the new status.
    expect(response.body.transitions.map((move: { to: string }) => move.to)).toEqual([
      "CLOSED",
      "REOPENED",
    ]);

    const after = await row();
    expect(after.currentStatus).toBe("RESOLVED");
    expect(after.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
  });

  it("API-33: refuses to resolve or close a Ticket nobody owns (AC-33)", async () => {
    for (const [from, to] of [["IN_PROGRESS", "RESOLVED"], ["RESOLVED", "CLOSED"]]) {
      await reset({ currentStatus: from, ownerId: null });

      const response = await patch("status", { currentStatus: to });

      expect([to, response.status]).toEqual([to, 409]);
      expect(response.body.error).toMatch(/needs a Ticket Owner/);
      const after = await row();
      expect(after.currentStatus).toBe(from);
      expect(after.updatedAt).toEqual(LONG_AGO);
    }
  });

  it("enforces the matrix for the Administrator too", async () => {
    await reset({ currentStatus: "CANCELLED", ownerId: adminId });

    const response = await patch("status", { currentStatus: "REOPENED" }, adminCookie);

    expect(response.status).toBe(409);
    expect((await row()).currentStatus).toBe("CANCELLED");
  });

  it("refuses a move to the status the Ticket already has", async () => {
    await reset({ currentStatus: "OPEN" });

    const response = await patch("status", { currentStatus: "OPEN" });

    expect(response.status).toBe(409);
    expect((await row()).updatedAt).toEqual(LONG_AGO);
  });

  it("judges the move from the status in the database, not one the body claims", async () => {
    await reset({ currentStatus: "IN_PROGRESS", ownerId: staffId });

    // Resolved to Closed is legal, In Progress to Closed is not. The body
    // says the Ticket is Resolved; the database says otherwise.
    const response = await patch("status", { currentStatus: "CLOSED", from: "RESOLVED", previousStatus: "RESOLVED" });

    expect(response.status).toBe(409);
    expect((await row()).currentStatus).toBe("IN_PROGRESS");
  });

  it("answers 400 for a status that is not one", async () => {
    for (const body of [{}, { currentStatus: "DONE" }, { currentStatus: "resolved" }, { currentStatus: 4 }, { currentStatus: null }]) {
      const response = await patch("status", body);

      expect([body, response.status]).toEqual([body, 400]);
    }
    expect((await row()).currentStatus).toBe("NEW");
  });

  it("answers 404 for a Ticket that does not exist", async () => {
    expect((await patch("status", { currentStatus: "OPEN" }, staffCookie, 99999999)).status).toBe(404);
  });

  it("walks a Ticket through its whole life", async () => {
    await reset({ ownerId: staffId });

    for (const currentStatus of ["OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "REOPENED", "IN_PROGRESS", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"]) {
      const response = await patch("status", { currentStatus });
      expect([currentStatus, response.status]).toEqual([currentStatus, 200]);
    }
    // And Cancelled is where it ends.
    expect((await patch("status", { currentStatus: "REOPENED" })).status).toBe(409);
  });

  it("clears the Requester's resolved signal when the Ticket is reopened, and only then", async () => {
    const signalled = new Date("2026-09-03T08:00:00.000Z");
    await reset({ currentStatus: "IN_PROGRESS", ownerId: staffId, requesterResolvedAt: signalled });

    // Resolving agrees with the Requester; the signal stays as the record.
    await patch("status", { currentStatus: "RESOLVED" });
    expect((await row()).requesterResolvedAt).toEqual(signalled);

    // Reopening makes the Ticket live again, so the Requester must be able to
    // say "fixed" a second time. They cannot while the first is still set.
    const reopened = await patch("status", { currentStatus: "REOPENED" });
    expect(reopened.body.requesterResolvedAt).toBeNull();
    expect((await row()).requesterResolvedAt).toBeNull();

    const again = await request(app)
      .post(`/api/tickets/${ticketId}/requester-resolved`)
      .set("Cookie", requesterCookie);
    expect(again.status).toBe(200);
  });
});

describe("two people changing the same Ticket", () => {
  // Lab 3 proved these two by forcing a second write into the gap between
  // the route's read and its write. Lab 4 closes that gap: the route holds
  // the Ticket's row locked from its read to its write, so nothing can land
  // in between, and a request names the version it was based on (Lab 4
  // BR-16). What is left to prove is the same thing from the outside: a
  // change decided on a copy that somebody has since changed is refused.
  it("refuses a status change decided on a status that has since moved", async () => {
    await reset({ currentStatus: "IN_PROGRESS", ownerId: staffId });
    const seen = (await row()).version;

    // A colleague cancels it. The first person's screen still shows In
    // Progress, from which Resolved looks legal.
    expect((await patch("status", { currentStatus: "CANCELLED" }, colleagueCookie)).status).toBe(200);
    const response = await patch("status", { currentStatus: "RESOLVED", expectedVersion: seen });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/changed by someone else/);
    expect((await row()).currentStatus).toBe("CANCELLED");
  });

  it("refuses to resolve a Ticket that was unassigned in the meantime (BR-23)", async () => {
    await reset({ currentStatus: "IN_PROGRESS", ownerId: staffId });
    const seen = (await row()).version;

    expect((await patch("owner", { ownerId: null }, colleagueCookie)).status).toBe(200);
    const response = await patch("status", { currentStatus: "RESOLVED", expectedVersion: seen });

    expect(response.status).toBe(409);
    const after = await row();
    // Never Resolved with nobody owning it, whichever request came first.
    expect(after.currentStatus).toBe("IN_PROGRESS");
    expect(after.ownerId).toBeNull();
  });

  it("gives one of two simultaneous, incompatible moves a 409", async () => {
    await reset({ currentStatus: "IN_PROGRESS", ownerId: staffId });

    // Neither order makes a legal chain: Resolved cannot be Cancelled, and
    // Cancelled cannot be Resolved. So exactly one may win.
    const [first, second] = await Promise.all([
      patch("status", { currentStatus: "RESOLVED" }),
      patch("status", { currentStatus: "CANCELLED" }, colleagueCookie),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const winner = first.status === 200 ? "RESOLVED" : "CANCELLED";
    expect((await row()).currentStatus).toBe(winner);
  });

  it("settles two simultaneous claims on one owner, with both answered", async () => {
    const [first, second] = await Promise.all([
      patch("owner", { ownerId: staffId }),
      patch("owner", { ownerId: colleagueId }, colleagueCookie),
    ]);

    // Lab 3 let both succeed, one after the other, and the second silently
    // took the Ticket from the first. Lab 4 does not (Lab 4 BR-16): both were
    // decided on the same unowned Ticket, so one wins and the other is told
    // its copy is out of date. What still matters from Lab 3 is that neither
    // is lost to a failure surfacing as a 500.
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.body.code).toBe("STALE_TICKET");
    expect((await row()).ownerId).toBe(first.status === 200 ? staffId : colleagueId);
  });
});

describe("AC-45 staff read Attachments, and only read them", () => {
  let attachmentId: number;
  // The eight-byte PNG signature: the smallest thing the upload rules accept.
  const PNG = Buffer.from("89504e470d0a1a0a", "hex");

  beforeAll(async () => {
    const uploaded = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .set("Cookie", requesterCookie)
      .attach("file", PNG, { filename: "evidence.png", contentType: "image/png" });
    expect(uploaded.status).toBe(201);
    attachmentId = uploaded.body.id;
  });

  it("lists the Attachment on the staff Ticket", async () => {
    const response = await detail();

    expect(response.body.attachments).toEqual([
      expect.objectContaining({ id: attachmentId, originalFilename: "evidence.png", isRemoved: false }),
    ]);
    // Where the file lives on disk is nobody's business but the server's.
    expect(JSON.stringify(response.body)).not.toContain("storedFilename");
  });

  it("serves its metadata and its bytes to IT Staff and to an Administrator", async () => {
    for (const cookie of [staffCookie, adminCookie]) {
      const metadata = await request(app).get(`/api/attachments/${attachmentId}`).set("Cookie", cookie);
      expect(metadata.status).toBe(200);
      expect(metadata.body.originalFilename).toBe("evidence.png");
      expect(metadata.body.storedFilename).toBeUndefined();

      const download = await request(app)
        .get(`/api/attachments/${attachmentId}/download`)
        .set("Cookie", cookie)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => done(null, Buffer.concat(chunks)));
        });
      expect(download.status).toBe(200);
      // The bytes that were uploaded, not merely a 200.
      expect(Buffer.compare(download.body as Buffer, PNG)).toBe(0);
    }
  });

  it("refuses staff an upload or a removal with 403, and changes nothing", async () => {
    const upload = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .set("Cookie", staffCookie)
      .attach("file", PNG, { filename: "no.png", contentType: "image/png" });
    const removal = await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .set("Cookie", staffCookie)
      .send({ reason: "should not work" });

    expect(upload.status).toBe(403);
    expect(removal.status).toBe(403);

    const rows = await prisma.attachment.findMany({ where: { ticketId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].isRemoved).toBe(false);
  });

  it("keeps a removed Attachment's row visible to staff, and its file unreachable", async () => {
    // Last in this block: it removes the fixture the tests above read.
    const removed = await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .set("Cookie", requesterCookie)
      .send({ reason: "Wrong file" });
    expect(removed.status).toBe(200);

    const metadata = await request(app).get(`/api/attachments/${attachmentId}`).set("Cookie", staffCookie);
    expect(metadata.status).toBe(200);
    expect(metadata.body).toMatchObject({ isRemoved: true, removedReason: "Wrong file" });

    // Reading any Ticket does not mean reading what its owner took down.
    const download = await request(app)
      .get(`/api/attachments/${attachmentId}/download`)
      .set("Cookie", staffCookie);
    expect(download.status).toBe(404);
    expect(download.headers["content-disposition"]).toBeUndefined();
  });

  it("answers 404 for an Attachment that does not exist, for staff as for anyone", async () => {
    const response = await request(app).get("/api/attachments/99999999/download").set("Cookie", staffCookie);
    expect(response.status).toBe(404);
  });
});
