import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";
import { fixtureUser } from "../helpers/users.js";
import { signInAs } from "../helpers/session.js";

// API-01 to API-17 (Lab 4 AC-01, AC-03 to AC-17; BR-01 to BR-11, BR-17, BR-20).
//
// Every rule about who may write is asserted against the endpoint itself, and
// "nothing was written" is read back from the database, not inferred from the
// status code.

const prisma = createPrismaClient();
const app = createApp();

const TAG = "actions-taken.api.test";
const email = (who: string) => `${who}.${TAG}@toktickit.test`;

const HOUR = 60 * 60_000;

let requesterId: number;
let ownerStaffId: number;
let secondStaffId: number;
let adminId: number;
let ticketId: number;
let otherTicketId: number;

let requesterCookie: string;
let strangerCookie: string;
let ownerStaffCookie: string;
let secondStaffCookie: string;
let adminCookie: string;

/** The Ticket is given a past, so tests have room to date work before now. */
const TICKET_AGE = 48 * HOUR;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

const validBody = (overrides: Record<string, unknown> = {}) => ({
  requestKey: randomUUID(),
  actionAt: hoursAgo(1),
  description: "Replaced the projector lamp in LX-204.",
  result: "Projector powers on and holds an image.",
  followUpRequired: false,
  ...overrides,
});

const actionsUrl = (id = ticketId) => `/api/tickets/${id}/actions`;
const list = (cookie: string, id = ticketId) => request(app).get(actionsUrl(id)).set("Cookie", cookie);
const create = (cookie: string, body: Record<string, unknown> = validBody(), id = ticketId) =>
  request(app).post(actionsUrl(id)).set("Cookie", cookie).send(body);
const edit = (cookie: string, actionId: number, body: Record<string, unknown>, id = ticketId) =>
  request(app).patch(`${actionsUrl(id)}/${actionId}`).set("Cookie", cookie).send(body);

const countActions = (id = ticketId) => prisma.actionTaken.count({ where: { ticketId: id } });
const readTicket = (id = ticketId) =>
  prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { currentStatus: true, ownerId: true, itPriority: true, version: true, updatedAt: true },
  });

async function removeFixtures() {
  const mine = { email: { contains: TAG } };
  await prisma.actionTaken.deleteMany({ where: { ticket: { requester: mine } } });
  await prisma.ticketComment.deleteMany({ where: { ticket: { requester: mine } } });
  await prisma.ticket.deleteMany({ where: { requester: mine } });
  await prisma.user.deleteMany({ where: mine });
}

beforeAll(async () => {
  await removeFixtures();

  const make = (who: string, role: "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR" = "REQUESTER") =>
    prisma.user.create({ data: fixtureUser({ name: `${who} ${TAG}`, email: email(who), role }) });
  const [requester, stranger, ownerStaff, secondStaff, admin] = await Promise.all([
    make("requester"),
    make("stranger"),
    make("owner-staff", "IT_STAFF"),
    make("second-staff", "IT_STAFF"),
    make("admin", "ADMINISTRATOR"),
  ]);
  requesterId = requester.id;
  ownerStaffId = ownerStaff.id;
  secondStaffId = secondStaff.id;
  adminId = admin.id;

  [requesterCookie, strangerCookie, ownerStaffCookie, secondStaffCookie, adminCookie] =
    await Promise.all(
      [requester, stranger, ownerStaff, secondStaff, admin].map((user) => signInAs(app, user.email)),
    );

  const category = await prisma.category.findFirstOrThrow();
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow();
  const makeTicket = async (n: number) =>
    prisma.ticket.create({
      data: {
        ticketNumber: `TKT-2026-96${String(Date.now() % 1000).padStart(3, "0")}${n}`,
        requesterId: requester.id,
        ownerId: ownerStaff.id,
        categoryId: category.id,
        relatedSystemId: relatedSystem.id,
        summary: `Actions fixture ${n} ${TAG}`,
        description: "A Ticket that exists so there is somewhere to record work.",
        requestedPriority: "MEDIUM",
        itPriority: "HIGH",
        currentStatus: "IN_PROGRESS",
        createdAt: new Date(Date.now() - TICKET_AGE),
      },
    });
  ticketId = (await makeTicket(1)).id;
  otherTicketId = (await makeTicket(2)).id;
});

beforeEach(async () => {
  // Each test starts from two Tickets with no work on them, In Progress.
  await prisma.actionTaken.deleteMany({ where: { ticketId: { in: [ticketId, otherTicketId] } } });
  await prisma.ticket.updateMany({
    where: { id: { in: [ticketId, otherTicketId] } },
    data: { currentStatus: "IN_PROGRESS", ownerId: ownerStaffId },
  });
});

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

describe("API-01 no session (AC-06)", () => {
  it("answers 401 on list, create and edit, and writes nothing", async () => {
    const listed = await request(app).get(actionsUrl());
    const created = await request(app).post(actionsUrl()).send(validBody());
    const edited = await request(app).patch(`${actionsUrl()}/1`).send({ expectedVersion: 1 });

    for (const response of [listed, created, edited]) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Authentication required" });
    }
    expect(await countActions()).toBe(0);
  });
});

describe("API-02 the list (FR-01, BR-10, AC-15)", () => {
  it("is an empty array for a Ticket with no Actions Taken", async () => {
    const response = await list(ownerStaffCookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("is ordered by Action Date/Time descending, then id descending, every time", async () => {
    const sameMinute = hoursAgo(5);
    const ids: Record<string, number> = {};
    // Entered out of order on purpose: the list follows when the work was
    // done, not when it was typed in.
    for (const [name, actionAt] of [
      ["middle", hoursAgo(10)],
      ["tieFirst", sameMinute],
      ["oldest", hoursAgo(20)],
      ["tieSecond", sameMinute],
      ["newest", hoursAgo(1)],
    ] as const) {
      const response = await create(ownerStaffCookie, validBody({ actionAt, description: name }));
      expect(response.status).toBe(201);
      ids[name] = response.body.id;
    }

    const expected = [ids.newest, ids.tieSecond, ids.tieFirst, ids.middle, ids.oldest];
    for (let read = 0; read < 3; read++) {
      const response = await list(ownerStaffCookie);
      expect(response.body.map((a: { id: number }) => a.id)).toEqual(expected);
    }
  });

  it("returns the documented fields and no others", async () => {
    await create(ownerStaffCookie);

    const [action] = (await list(ownerStaffCookie)).body;

    expect(Object.keys(action).sort()).toEqual(
      [
        "actionAt",
        "attachmentNotes",
        "createdAt",
        "description",
        "editedAt",
        "editedBy",
        "followUpNote",
        "followUpRequired",
        "id",
        "performedBy",
        "result",
        "ticketId",
        "version",
      ].sort(),
    );
    // A person is an id and a name: no email address, no role, no hash.
    expect(Object.keys(action.performedBy).sort()).toEqual(["id", "name"]);
    expect(JSON.stringify(action)).not.toContain("requestKey");
  });
});

describe("API-03 creating a valid Action Taken (AC-01)", () => {
  it("saves it under the Ticket with the caller as Performed by", async () => {
    const before = Date.now();
    const body = validBody({
      followUpRequired: true,
      followUpNote: "  Check lamp hours after one week.  ",
      attachmentNotes: "Photo of the old lamp label: lamp-lx204.jpg",
    });

    const response = await create(secondStaffCookie, body);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      ticketId,
      actionAt: body.actionAt,
      description: body.description,
      result: body.result,
      followUpRequired: true,
      followUpNote: "Check lamp hours after one week.",
      attachmentNotes: "Photo of the old lamp label: lamp-lx204.jpg",
      performedBy: { id: secondStaffId, name: `second-staff ${TAG}` },
      editedBy: null,
      editedAt: null,
      version: 1,
    });
    expect(new Date(response.body.createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);

    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(stored.ticketId).toBe(ticketId);
    expect(stored.performedById).toBe(secondStaffId);
    expect(stored.requestKey).toBe(body.requestKey);
  });
});

describe("API-04 identity and Ticket cannot be supplied (BR-01, BR-03, AC-01)", () => {
  it("ignores a performer, a Ticket and a creation time sent in the body", async () => {
    const response = await create(
      secondStaffCookie,
      validBody({
        performedById: adminId,
        performedBy: { id: adminId, name: "Somebody Else" },
        ticketId: otherTicketId,
        createdAt: "1999-01-01T00:00:00.000Z",
        version: 9,
        editedById: adminId,
      }),
    );

    expect(response.status).toBe(201);
    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(stored.performedById).toBe(secondStaffId);
    expect(stored.ticketId).toBe(ticketId);
    expect(stored.createdAt.getFullYear()).not.toBe(1999);
    expect(stored.version).toBe(1);
    expect(stored.editedById).toBeNull();
    expect(await countActions(otherTicketId)).toBe(0);
  });
});

describe("API-05 a Requester cannot write (BR-04, AC-04)", () => {
  it("is refused 403 on create and edit, on their own Ticket and on another's", async () => {
    const existing = (await create(ownerStaffCookie)).body;

    for (const cookie of [requesterCookie, strangerCookie]) {
      const created = await create(cookie);
      const edited = await edit(cookie, existing.id, { ...validBody(), expectedVersion: 1, description: "Changed" });

      for (const response of [created, edited]) {
        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: "You do not have permission to perform this action" });
      }
    }

    expect(await countActions()).toBe(1);
    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: existing.id } });
    expect(stored.description).toBe(existing.description);
    expect(stored.version).toBe(1);
  });
});

describe("API-06 a Requester reads their own Ticket only (BR-04, AC-03, AC-05)", () => {
  it("sees every field of every Action Taken on a Ticket they own", async () => {
    await create(ownerStaffCookie, validBody({ actionAt: hoursAgo(3) }));
    await create(
      secondStaffCookie,
      validBody({ followUpRequired: true, followUpNote: "Come back Friday.", attachmentNotes: "log.txt" }),
    );

    const asStaff = await list(ownerStaffCookie);
    const asRequester = await list(requesterCookie);

    expect(asRequester.status).toBe(200);
    expect(asRequester.body).toHaveLength(2);
    // Exactly what staff see: nothing about the work is held back (handout 8.3).
    expect(asRequester.body).toEqual(asStaff.body);
    expect(asRequester.body[0]).toMatchObject({ followUpNote: "Come back Friday.", attachmentNotes: "log.txt" });
  });

  it("gets a 404 for another Requester's Ticket, identical to one that does not exist", async () => {
    await create(ownerStaffCookie);

    const notTheirs = await list(strangerCookie);
    const noSuchTicket = await list(strangerCookie, 2_000_000_000);

    expect(notTheirs.status).toBe(404);
    expect(noSuchTicket.status).toBe(404);
    expect(notTheirs.text).toBe(noSuchTicket.text);
    expect(notTheirs.text).not.toContain("projector");
  });

  it("answers 404 to staff too when the id is not a Ticket", async () => {
    for (const id of ["2000000000", "abc", "0", "-1", "1.5"]) {
      const response = await request(app).get(`/api/tickets/${id}/actions`).set("Cookie", ownerStaffCookie);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Ticket not found" });
    }
  });
});

describe("API-07 the follow-up rule (BR-07, AC-07, AC-08)", () => {
  it.each([[undefined], [""], ["   \n "]])(
    "rejects follow-up required with note %j, on the note's own field",
    async (followUpNote) => {
      const response = await create(ownerStaffCookie, validBody({ followUpRequired: true, followUpNote }));

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Validation failed");
      expect(Object.keys(response.body.fields)).toEqual(["followUpNote"]);
      expect(await countActions()).toBe(0);
    },
  );

  it("stores no note when follow-up is not required, even if one was sent", async () => {
    const response = await create(
      ownerStaffCookie,
      validBody({ followUpRequired: false, followUpNote: "typed, then un-ticked" }),
    );

    expect(response.status).toBe(201);
    expect(response.body.followUpNote).toBeNull();
    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(stored.followUpNote).toBeNull();
  });
});

describe("API-08 field validation through the route (BR-05, BR-06, AC-09)", () => {
  it.each([
    ["description", ""],
    ["description", "   "],
    ["description", "x".repeat(2001)],
    ["result", ""],
    ["result", "x".repeat(1001)],
    ["attachmentNotes", "x".repeat(501)],
    ["actionAt", undefined],
    ["actionAt", "not a date"],
    ["actionAt", "2026-10-06T04:00:00"],
    // A date that does not exist is refused, not stored as a different day.
    ["actionAt", "2026-02-31T10:00:00.000Z"],
    ["actionAt", "2026-03-01T24:00:00.000Z"],
    ["followUpRequired", "yes"],
  ])("rejects a bad %s (%j) with a message on that field", async (field, value) => {
    const response = await create(ownerStaffCookie, validBody({ [field]: value }));

    expect(response.status).toBe(400);
    expect(Object.keys(response.body.fields)).toEqual([field]);
    expect(await countActions()).toBe(0);
  });

  it("rejects an Action Date/Time before the Ticket was created or ahead of the clock", async () => {
    const beforeTicket = await create(ownerStaffCookie, validBody({ actionAt: hoursAgo(TICKET_AGE / HOUR + 1) }));
    const tomorrow = await create(ownerStaffCookie, validBody({ actionAt: hoursAgo(-24) }));

    expect(beforeTicket.status).toBe(400);
    expect(beforeTicket.body.fields.actionAt).toMatch(/earlier than when the Ticket was created/);
    expect(tomorrow.status).toBe(400);
    expect(tomorrow.body.fields.actionAt).toMatch(/future/);
    expect(await countActions()).toBe(0);
  });

  it("accepts the form's own default on a Ticket created seconds ago", async () => {
    // The form offers "now" to the minute. On a Ticket created at hh:mm:30
    // that is 30 seconds before the Ticket existed, and it must still be
    // accepted (BR-05 compares to the minute).
    const thisMinute = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    await prisma.ticket.update({
      where: { id: otherTicketId },
      data: { createdAt: new Date(thisMinute.getTime() + 30_000) },
    });

    try {
      const accepted = await create(ownerStaffCookie, validBody({ actionAt: thisMinute.toISOString() }), otherTicketId);
      const tooEarly = await create(
        ownerStaffCookie,
        validBody({ actionAt: new Date(thisMinute.getTime() - 1000).toISOString() }),
        otherTicketId,
      );

      expect(accepted.status).toBe(201);
      expect(tooEarly.status).toBe(400);
      expect(Object.keys(tooEarly.body.fields)).toEqual(["actionAt"]);
    } finally {
      await prisma.actionTaken.deleteMany({ where: { ticketId: otherTicketId } });
      await prisma.ticket.update({
        where: { id: otherTicketId },
        data: { createdAt: new Date(Date.now() - TICKET_AGE) },
      });
    }
  });

  it("reports every failing field together", async () => {
    const response = await create(ownerStaffCookie, {
      requestKey: randomUUID(),
      actionAt: "nope",
      description: " ",
      followUpRequired: true,
    });

    expect(response.status).toBe(400);
    expect(Object.keys(response.body.fields).sort()).toEqual(["actionAt", "description", "followUpNote", "result"]);
  });

  it.each([[undefined], [""], ["short"], ["has a space in it"], ["x".repeat(65)], [12345678]])(
    "rejects a request key of %j",
    async (requestKey) => {
      const response = await create(ownerStaffCookie, validBody({ requestKey }));

      expect(response.status).toBe(400);
      expect(Object.keys(response.body.fields)).toEqual(["requestKey"]);
      expect(await countActions()).toBe(0);
    },
  );

  it("answers a request with no body as a validation error, not a failure", async () => {
    const response = await request(app).post(actionsUrl()).set("Cookie", ownerStaffCookie);

    expect(response.status).toBe(400);
    expect(response.body.fields).toHaveProperty("requestKey");
  });
});

describe("API-09 different staff on one Ticket (BR-02, AC-10)", () => {
  it("lets two staff who do not own the Ticket, and an Administrator, each record work under their own name", async () => {
    // Owned by a third person throughout.
    const thirdStaff = await prisma.user.create({
      data: fixtureUser({ name: `third-staff ${TAG}`, email: email("third-staff"), role: "IT_STAFF" }),
    });
    await prisma.ticket.update({ where: { id: ticketId }, data: { ownerId: thirdStaff.id } });
    const before = await readTicket();

    const first = await create(ownerStaffCookie, validBody({ actionAt: hoursAgo(3) }));
    const second = await create(secondStaffCookie, validBody({ actionAt: hoursAgo(2) }));
    const third = await create(adminCookie, validBody({ actionAt: hoursAgo(1) }));

    expect([first.status, second.status, third.status]).toEqual([201, 201, 201]);
    const listed = (await list(requesterCookie)).body;
    expect(listed.map((a: { performedBy: { id: number } }) => a.performedBy.id)).toEqual([
      adminId,
      secondStaffId,
      ownerStaffId,
    ]);

    const after = await readTicket();
    expect(after.ownerId).toBe(thirdStaff.id);
    expect(after.ownerId).toBe(before.ownerId);
  });
});

describe("API-10 editing (BR-09, AC-11)", () => {
  it("changes the six fields and the edit mark, and nothing else", async () => {
    const original = (await create(ownerStaffCookie, validBody({ attachmentNotes: "before.txt" }))).body;
    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: original.id } });
    const before = Date.now();

    const response = await edit(secondStaffCookie, original.id, {
      expectedVersion: 1,
      actionAt: hoursAgo(2),
      description: "Replaced the lamp and cleaned the filter.",
      result: "Image is brighter.",
      followUpRequired: true,
      followUpNote: "Order a spare lamp.",
      attachmentNotes: "",
      // None of these may take effect.
      performedById: secondStaffId,
      ticketId: otherTicketId,
      createdAt: "1999-01-01T00:00:00.000Z",
      requestKey: randomUUID(),
      version: 40,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: original.id,
      ticketId,
      description: "Replaced the lamp and cleaned the filter.",
      result: "Image is brighter.",
      followUpRequired: true,
      followUpNote: "Order a spare lamp.",
      attachmentNotes: null,
      performedBy: { id: ownerStaffId },
      editedBy: { id: secondStaffId, name: `second-staff ${TAG}` },
      createdAt: original.createdAt,
      version: 2,
    });
    expect(new Date(response.body.editedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);

    const after = await prisma.actionTaken.findUniqueOrThrow({ where: { id: original.id } });
    expect(after.performedById).toBe(ownerStaffId);
    expect(after.ticketId).toBe(ticketId);
    expect(after.requestKey).toBe(stored.requestKey);
    expect(after.createdAt).toEqual(stored.createdAt);
  });

  it("applies the same validation as create", async () => {
    const original = (await create(ownerStaffCookie)).body;

    const response = await edit(ownerStaffCookie, original.id, {
      ...validBody(),
      expectedVersion: 1,
      result: "  ",
      followUpRequired: true,
    });

    expect(response.status).toBe(400);
    expect(Object.keys(response.body.fields).sort()).toEqual(["followUpNote", "result"]);
    expect((await prisma.actionTaken.findUniqueOrThrow({ where: { id: original.id } })).version).toBe(1);
  });
});

describe("API-11 a stale edit (BR-17, AC-12)", () => {
  it("is refused with the current row, and writes nothing", async () => {
    const original = (await create(ownerStaffCookie)).body;
    const first = await edit(ownerStaffCookie, original.id, {
      ...validBody(),
      expectedVersion: 1,
      description: "First editor's text.",
    });
    expect(first.status).toBe(200);

    // The second editor still holds version 1.
    const second = await edit(secondStaffCookie, original.id, {
      ...validBody(),
      expectedVersion: 1,
      description: "Second editor's text.",
    });

    expect(second.status).toBe(409);
    expect(second.body.code).toBe("STALE_ACTION");
    expect(second.body.current).toEqual(first.body);

    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: original.id } });
    expect(stored.description).toBe("First editor's text.");
    expect(stored.version).toBe(2);
    expect(stored.editedById).toBe(ownerStaffId);
  });

  it("reports a stale version before judging the fields", async () => {
    const original = (await create(ownerStaffCookie)).body;
    await edit(ownerStaffCookie, original.id, { ...validBody(), expectedVersion: 1 });

    const response = await edit(secondStaffCookie, original.id, { expectedVersion: 1, description: "" });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("STALE_ACTION");
  });

  it.each([[undefined], [null], ["1"], [0], [1.5], [-1]])(
    "rejects an expectedVersion of %j as a validation error",
    async (expectedVersion) => {
      const original = (await create(ownerStaffCookie)).body;

      const response = await edit(ownerStaffCookie, original.id, { ...validBody(), expectedVersion });

      expect(response.status).toBe(400);
      expect(Object.keys(response.body.fields)).toEqual(["expectedVersion"]);
      expect((await prisma.actionTaken.findUniqueOrThrow({ where: { id: original.id } })).version).toBe(1);
    },
  );

  it("lets exactly one of two simultaneous edits from the same version through", async () => {
    const original = (await create(ownerStaffCookie)).body;

    const [a, b] = await Promise.all([
      edit(ownerStaffCookie, original.id, { ...validBody(), expectedVersion: 1, description: "A" }),
      edit(secondStaffCookie, original.id, { ...validBody(), expectedVersion: 1, description: "B" }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await prisma.actionTaken.findUniqueOrThrow({ where: { id: original.id } })).version).toBe(2);
  });
});

describe("API-12 a create that is sent again (BR-20, AC-13, AC-42)", () => {
  it("returns the first Action Taken and creates nothing", async () => {
    const body = validBody();

    const first = await create(ownerStaffCookie, body);
    const second = await create(ownerStaffCookie, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await countActions()).toBe(1);
  });

  it("creates one row when the same request arrives twice at once", async () => {
    const body = validBody();

    const responses = await Promise.all([
      create(ownerStaffCookie, body),
      create(ownerStaffCookie, body),
      create(ownerStaffCookie, body),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await countActions()).toBe(1);
  });

  it("answers the retry with what was saved, not with what the retry carries", async () => {
    const body = validBody();
    const first = await create(ownerStaffCookie, body);

    // A retry is the same request; if it somehow differs, the first one won.
    const second = await create(ownerStaffCookie, { ...body, description: "", result: "different" });

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("still answers the retry after the Ticket has been resolved in between", async () => {
    const body = validBody();
    const first = await create(ownerStaffCookie, body);
    await prisma.ticket.update({ where: { id: ticketId }, data: { currentStatus: "RESOLVED" } });

    const second = await create(ownerStaffCookie, body);

    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
  });

  it("refuses the key from another user or for another Ticket", async () => {
    const body = validBody();
    await create(ownerStaffCookie, body);

    const otherUser = await create(secondStaffCookie, body);
    const otherTicket = await create(ownerStaffCookie, body, otherTicketId);

    for (const response of [otherUser, otherTicket]) {
      expect(response.status).toBe(409);
      expect(response.body.code).toBe("REQUEST_KEY_REUSED");
      // Says nothing about the row that holds the key.
      expect(Object.keys(response.body).sort()).toEqual(["code", "error"]);
    }
    expect(await countActions()).toBe(1);
    expect(await countActions(otherTicketId)).toBe(0);
  });

  it("gives the key to one Ticket when it arrives for two at once", async () => {
    const body = validBody();

    const responses = await Promise.all([
      create(ownerStaffCookie, body),
      create(ownerStaffCookie, body, otherTicketId),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await countActions()) + (await countActions(otherTicketId))).toBe(1);
  });
});

describe("API-13 frozen once the Ticket is finished (BR-08, AC-14)", () => {
  it.each([
    ["RESOLVED", "Resolved"],
    ["CLOSED", "Closed"],
    ["CANCELLED", "Cancelled"],
  ] as const)("refuses create and edit on a %s Ticket", async (status, label) => {
    const existing = (await create(ownerStaffCookie)).body;
    await prisma.ticket.update({ where: { id: ticketId }, data: { currentStatus: status } });

    const created = await create(ownerStaffCookie);
    const edited = await edit(ownerStaffCookie, existing.id, { ...validBody(), expectedVersion: 1, description: "Later" });

    for (const response of [created, edited]) {
      expect(response.status).toBe(409);
      expect(response.body.code).toBe("TICKET_NOT_ACTIVE");
      expect(response.body.error).toContain(label);
    }
    expect(await countActions()).toBe(1);
    expect((await prisma.actionTaken.findUniqueOrThrow({ where: { id: existing.id } })).version).toBe(1);
  });

  it.each(["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"] as const)(
    "allows both on a %s Ticket",
    async (status) => {
      await prisma.ticket.update({ where: { id: ticketId }, data: { currentStatus: status } });

      const created = await create(ownerStaffCookie);
      const edited = await edit(ownerStaffCookie, created.body.id, { ...validBody(), expectedVersion: 1 });

      expect(created.status).toBe(201);
      expect(edited.status).toBe(200);
    },
  );
});

describe("API-14 no delete, and no reaching across Tickets (BR-01, BR-09, AC-15)", () => {
  it("has no DELETE endpoint", async () => {
    const existing = (await create(ownerStaffCookie)).body;

    const response = await request(app).delete(`${actionsUrl()}/${existing.id}`).set("Cookie", adminCookie);

    expect(response.status).toBe(404);
    expect(await countActions()).toBe(1);
  });

  it("does not find an Action Taken through another Ticket's path", async () => {
    const existing = (await create(ownerStaffCookie)).body;

    const response = await edit(
      ownerStaffCookie,
      existing.id,
      { ...validBody(), expectedVersion: 1, description: "Reached across" },
      otherTicketId,
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Action Taken not found" });
    expect((await prisma.actionTaken.findUniqueOrThrow({ where: { id: existing.id } })).description).toBe(
      existing.description,
    );
  });

  it("answers 404 for an Action Taken or a Ticket that does not exist", async () => {
    const noAction = await edit(ownerStaffCookie, 2_000_000_000, { ...validBody(), expectedVersion: 1 });
    const badAction = await request(app).patch(`${actionsUrl()}/abc`).set("Cookie", ownerStaffCookie).send({});
    const noTicket = await create(ownerStaffCookie, validBody(), 2_000_000_000);

    expect(noAction.status).toBe(404);
    expect(badAction.status).toBe(404);
    expect(noTicket.status).toBe(404);
    expect(noTicket.body).toEqual({ error: "Ticket not found" });
  });
});

describe("API-15 the effect on the Ticket (BR-11, AC-16)", () => {
  it("advances updatedAt on create and on edit, and changes nothing else", async () => {
    await prisma.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date(Date.now() - HOUR) } });
    const start = await readTicket();

    const created = await create(secondStaffCookie);
    const afterCreate = await readTicket();
    await prisma.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date(Date.now() - HOUR) } });
    const edited = await edit(secondStaffCookie, created.body.id, { ...validBody(), expectedVersion: 1 });
    const afterEdit = await readTicket();

    expect(created.status).toBe(201);
    expect(edited.status).toBe(200);
    for (const after of [afterCreate, afterEdit]) {
      expect(after.updatedAt.getTime()).toBeGreaterThan(start.updatedAt.getTime());
      expect(Date.now() - after.updatedAt.getTime()).toBeLessThan(10_000);
      expect({ ...after, updatedAt: null }).toEqual({ ...start, updatedAt: null });
    }
  });

  it("leaves updatedAt alone when the request is refused", async () => {
    const start = await readTicket();

    await create(ownerStaffCookie, validBody({ description: "" }));
    await create(requesterCookie);

    expect((await readTicket()).updatedAt).toEqual(start.updatedAt);
  });
});

describe("API-16 deactivated while signed in (AC-17)", () => {
  it("is refused as unauthenticated and writes nothing", async () => {
    const leaver = await prisma.user.create({
      data: fixtureUser({ name: `leaver ${TAG}`, email: email("leaver"), role: "IT_STAFF" }),
    });
    const cookie = await signInAs(app, leaver.email);
    expect((await create(cookie)).status).toBe(201);

    await prisma.user.update({ where: { id: leaver.id }, data: { isActive: false } });
    const response = await create(cookie);

    expect(response.status).toBe(401);
    expect(await countActions()).toBe(1);
  });
});

describe("API-17 the follow-up rule in the database (BR-07)", () => {
  const row = (followUpRequired: boolean, followUpNote: string | null) =>
    prisma.actionTaken.create({
      data: {
        ticketId,
        performedById: ownerStaffId,
        requestKey: randomUUID(),
        actionAt: new Date(),
        description: "Written past the API",
        result: "r",
        followUpRequired,
        followUpNote,
      },
    });

  it("refuses a row that requires follow-up and has no note", async () => {
    await expect(row(true, null)).rejects.toThrow();
    expect(await countActions()).toBe(0);
  });

  it("refuses a row that has a note and requires no follow-up", async () => {
    await expect(row(false, "stray")).rejects.toThrow();
    expect(await countActions()).toBe(0);
  });

  it("accepts the two consistent forms", async () => {
    await row(true, "Come back");
    await row(false, null);
    expect(await countActions()).toBe(2);
  });
});
