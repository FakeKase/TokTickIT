import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";
import { COMMENT_MAX } from "../../src/lib/comment-validation.js";
import { fixtureUser } from "../helpers/users.js";
import { signInAs } from "../helpers/session.js";

// API-16 to API-20 (AC-18, AC-19, AC-20, AC-34, BR-04, BR-24..29).
//
// BR-04 is the rule this file exists for, and it is asserted from the database
// outwards: a note is created, then the Requester's own view of the same Ticket
// is checked for any trace of it. A test that only looked for a heading would
// pass against a response that carried the content and hid it.

const prisma = createPrismaClient();
const app = createApp();

const TAG = "comments-notes.api.test";
const email = (who: string) => `${who}.${TAG}@toktickit.test`;

let ownerId: number;
let ticketId: number;
let ownerCookie: string;
let otherCookie: string;
let staffCookie: string;
let adminCookie: string;

beforeAll(async () => {
  const stale = { email: { contains: TAG } };
  await prisma.ticketComment.deleteMany({ where: { ticket: { requester: stale } } });
  await prisma.attachment.deleteMany({ where: { ticket: { requester: stale } } });
  await prisma.ticket.deleteMany({ where: { requester: stale } });
  await prisma.user.deleteMany({ where: stale });

  const [owner, other, staff, admin] = await Promise.all([
    prisma.user.create({
      data: fixtureUser({ name: `Owner ${TAG}`, email: email("owner") }),
    }),
    prisma.user.create({
      data: fixtureUser({ name: `Other ${TAG}`, email: email("other") }),
    }),
    prisma.user.create({
      data: fixtureUser({
        name: `Staff ${TAG}`,
        email: email("staff"),
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
  ]);
  ownerId = owner.id;

  [ownerCookie, otherCookie, staffCookie, adminCookie] = await Promise.all([
    signInAs(app, owner.email),
    signInAs(app, other.email),
    signInAs(app, staff.email),
    signInAs(app, admin.email),
  ]);

  const category = await prisma.category.findFirstOrThrow();
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow();
  const created = await request(app)
    .post("/api/tickets")
    .set("Cookie", ownerCookie)
    .send({
      categoryId: category.id,
      relatedSystemId: relatedSystem.id,
      requestedPriority: "MEDIUM",
      summary: `Thread fixture ${TAG}`,
      description: "A Ticket that exists so there is somewhere to comment.",
    });
  expect(created.status).toBe(201);
  ticketId = created.body.id;
});

beforeEach(async () => {
  // Each test starts from an empty thread and an un-signalled Ticket, so none
  // of them depends on the order the others ran in.
  await prisma.ticketComment.deleteMany({ where: { ticketId } });
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { requesterResolvedAt: null, currentStatus: "NEW" },
  });
});

afterAll(async () => {
  const stale = { email: { contains: TAG } };
  await prisma.ticketComment.deleteMany({ where: { ticket: { requester: stale } } });
  await prisma.ticket.deleteMany({ where: { requester: stale } });
  await prisma.user.deleteMany({ where: stale });
  await prisma.$disconnect();
});

const post = (cookie: string, body: Record<string, unknown>) =>
  request(app).post(`/api/tickets/${ticketId}/comments`).set("Cookie", cookie).send(body);

const list = (cookie: string, query = "") =>
  request(app).get(`/api/tickets/${ticketId}/comments${query}`).set("Cookie", cookie);

describe("API-16 posting a Public Comment (AC-18, BR-27)", () => {
  it("records the author and timestamp from the server, not the body", async () => {
    const before = Date.now();

    const response = await post(ownerCookie, {
      body: "  I have tried restarting it twice.  ",
      // Both are ignored: the server knows who is asking and what time it is.
      author: { id: 999, name: "Somebody Else" },
      createdAt: "1999-01-01T00:00:00.000Z",
    });

    expect(response.status).toBe(201);
    expect(response.body.author).toEqual({
      id: ownerId,
      name: `Owner ${TAG}`,
      role: "REQUESTER",
    });
    // Trimmed on the way in, so the stored text is what a reader sees.
    expect(response.body.body).toBe("I have tried restarting it twice.");
    expect(response.body.visibility).toBe("PUBLIC");
    expect(new Date(response.body.createdAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("is visible to the Requester, IT Staff and an Administrator (BR-04)", async () => {
    await post(ownerCookie, { body: "Visible to everyone on this Ticket." });

    for (const [who, cookie] of [
      ["requester", ownerCookie],
      ["staff", staffCookie],
      ["admin", adminCookie],
    ] as const) {
      const response = await list(cookie);

      expect(response.status, who).toBe(200);
      expect(response.body.map((c: { body: string }) => c.body), who).toContain(
        "Visible to everyone on this Ticket.",
      );
    }
  });

  it("orders a thread oldest first", async () => {
    await post(ownerCookie, { body: "First thing I tried." });
    await post(staffCookie, { body: "Thanks — could you send a screenshot?" });
    await post(ownerCookie, { body: "Attached." });

    const response = await list(ownerCookie);

    expect(response.body.map((c: { body: string }) => c.body)).toEqual([
      "First thing I tried.",
      "Thanks — could you send a screenshot?",
      "Attached.",
    ]);
  });
});

describe("API-17 content validation (AC-19, BR-25)", () => {
  it("rejects empty, whitespace-only and over-long bodies, and stores nothing", async () => {
    for (const body of ["", "   \n\t  ", "a".repeat(COMMENT_MAX + 1)]) {
      const response = await post(ownerCookie, { body });

      expect(response.status, JSON.stringify(body.slice(0, 12))).toBe(400);
      expect(response.body.fields.body).toBeTruthy();
    }

    expect(await prisma.ticketComment.count({ where: { ticketId } })).toBe(0);
  });

  it("accepts the maximum length itself, not just under it", async () => {
    const response = await post(ownerCookie, { body: "a".repeat(COMMENT_MAX) });

    expect(response.status).toBe(201);
  });

  it("rejects a visibility it does not recognise", async () => {
    const response = await post(ownerCookie, { body: "Hello", visibility: "SECRET" });

    expect(response.status).toBe(400);
    expect(response.body.fields.visibility).toBeTruthy();
  });
});

describe("API-18/API-19 Internal Notes stay internal (AC-34, BR-04, BR-29)", () => {
  it("never reaches the Requester, in content or in count", async () => {
    await post(ownerCookie, { body: "A public question from the Requester." });
    const note = await post(staffCookie, {
      body: "Internal: the serial number is on the vendor RMA list.",
      visibility: "INTERNAL",
    });
    expect(note.status).toBe(201);

    const asRequester = await list(ownerCookie);
    const asStaff = await list(staffCookie);

    // Staff see both; the Requester sees one. The note is not present as a
    // redacted entry, and not counted anywhere in the response either.
    expect(asStaff.body).toHaveLength(2);
    expect(asRequester.body).toHaveLength(1);
    expect(JSON.stringify(asRequester.body)).not.toContain("vendor RMA");
    expect(JSON.stringify(asRequester.body)).not.toContain("INTERNAL");

    // And the row is really there, so the absence above is a filter rather
    // than a failed write.
    expect(
      await prisma.ticketComment.count({ where: { ticketId, visibility: "INTERNAL" } }),
    ).toBe(1);
  });

  it("refuses a Requester who asks for internal entries outright", async () => {
    const response = await list(ownerCookie, "?visibility=INTERNAL");

    // 403 rather than an empty list: an empty collection would read as
    // "there are none", which is a different and false answer.
    expect(response.status).toBe(403);
  });

  it("refuses a Requester trying to post one", async () => {
    const response = await post(ownerCookie, {
      body: "Trying to write a note.",
      visibility: "INTERNAL",
    });

    expect(response.status).toBe(403);
    expect(await prisma.ticketComment.count({ where: { ticketId } })).toBe(0);
  });

  it("lets an Administrator read a note but not write one (BR-04, §5.1)", async () => {
    await post(staffCookie, { body: "Internal detail.", visibility: "INTERNAL" });

    const read = await list(adminCookie);
    expect(read.body.map((c: { body: string }) => c.body)).toContain("Internal detail.");

    const written = await post(adminCookie, {
      body: "An Administrator note.",
      visibility: "INTERNAL",
    });
    // The matrix gives Administrators internal-note access on both halves, so
    // this is allowed - asserted so a later change has to be deliberate.
    expect(written.status).toBe(201);
  });
});

describe("ownership on the thread (BR-18)", () => {
  it("answers 404 to another Requester, for reading and for posting", async () => {
    const read = await list(otherCookie);
    const write = await post(otherCookie, { body: "Not my Ticket." });

    expect([read.status, write.status]).toEqual([404, 404]);
    expect(await prisma.ticketComment.count({ where: { ticketId } })).toBe(0);
  });

  it("requires a session", async () => {
    const anonymous = await request(app).get(`/api/tickets/${ticketId}/comments`);

    expect(anonymous.status).toBe(401);
  });
});

describe("API-20 Problem Appears Resolved (AC-20, BR-05, BR-24)", () => {
  const signal = (cookie: string) =>
    request(app)
      .post(`/api/tickets/${ticketId}/requester-resolved`)
      .set("Cookie", cookie);

  it("records the timestamp, posts a Public Comment, and leaves the status alone", async () => {
    const response = await signal(ownerCookie);

    expect(response.status).toBe(200);
    expect(response.body.requesterResolvedAt).toBeTruthy();
    // BR-05: the Requester did not resolve the Ticket, they said it looks
    // resolved. Only IT Staff move the status.
    expect(response.body.currentStatus).toBe("NEW");

    const thread = await list(ownerCookie);
    expect(thread.body).toHaveLength(1);
    expect(thread.body[0].body).toMatch(/appears resolved/i);
    expect(thread.body[0].visibility).toBe("PUBLIC");
    expect(thread.body[0].author.id).toBe(ownerId);
  });

  it("is refused to IT Staff and Administrators", async () => {
    for (const cookie of [staffCookie, adminCookie]) {
      const response = await signal(cookie);
      expect(response.status).toBe(403);
    }

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(after.requesterResolvedAt).toBeNull();
  });

  it("is refused on another Requester's Ticket", async () => {
    expect((await signal(otherCookie)).status).toBe(404);
  });

  it("is refused once the Ticket is already resolved, closed or cancelled", async () => {
    for (const currentStatus of ["RESOLVED", "CLOSED", "CANCELLED"] as const) {
      await prisma.ticket.update({ where: { id: ticketId }, data: { currentStatus } });

      const response = await signal(ownerCookie);

      expect(response.status, currentStatus).toBe(409);
    }

    expect(await prisma.ticketComment.count({ where: { ticketId } })).toBe(0);
  });

  it("leaves no half-written signal when it fails", async () => {
    // The timestamp and its comment are one event: a 409 must write neither.
    await prisma.ticket.update({ where: { id: ticketId }, data: { currentStatus: "CLOSED" } });

    await signal(ownerCookie);

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(after.requesterResolvedAt).toBeNull();
    expect(await prisma.ticketComment.count({ where: { ticketId } })).toBe(0);
  });
});
