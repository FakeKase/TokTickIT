import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";
import { fixtureUser } from "../helpers/users.js";
import { signInAs } from "../helpers/session.js";

// API-42 to API-44 (Lab 4 FR-17, AC-44; handout §8.5, §8.6).
//
// What a request can do to get an answer the API was not written to give:
// name an address that is not a route, or name an id no row could have. Each
// must be answered as an ordinary refusal, in JSON, with nothing internal in
// it, and never as a 500.

const prisma = createPrismaClient();
const app = createApp();

const TAG = "hardening.api.test";
const email = (who: string) => `${who}.${TAG}@toktickit.test`;

/** One past the largest id a row can have: the column is a 32-bit integer. */
const TOO_BIG = 2_147_483_648;
/** Further out still, and still an integer as far as JavaScript can tell. */
const FAR_TOO_BIG = 99_999_999_999;

let requesterCookie: string;
let staffCookie: string;
let adminCookie: string;
let ticketId: number;
let categoryId: number;
let relatedSystemId: number;

async function removeFixtures() {
  const mine = { email: { contains: TAG } };
  await prisma.actionTaken.deleteMany({ where: { ticket: { requester: mine } } });
  await prisma.ticket.deleteMany({ where: { requester: mine } });
  await prisma.user.deleteMany({ where: mine });
}

beforeAll(async () => {
  await removeFixtures();
  const requester = await prisma.user.create({
    data: fixtureUser({ name: "Hardening Requester", email: email("requester") }),
  });
  await prisma.user.create({
    data: fixtureUser({ name: "Hardening Staff", email: email("staff"), role: "IT_STAFF" }),
  });
  await prisma.user.create({
    data: fixtureUser({ name: "Hardening Admin", email: email("admin"), role: "ADMINISTRATOR" }),
  });
  const category = await prisma.category.findFirstOrThrow();
  const system = await prisma.relatedSystem.findFirstOrThrow();
  categoryId = category.id;
  relatedSystemId = system.id;
  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-HARD-${Date.now()}`,
      requesterId: requester.id,
      categoryId,
      relatedSystemId,
      summary: "Hardening fixture",
      description: "A Ticket for requests that name ids no row could have.",
      requestedPriority: "LOW",
      itPriority: "LOW",
      createdAt: new Date(Date.now() - 60 * 60_000),
    },
  });
  ticketId = ticket.id;

  requesterCookie = await signInAs(app, email("requester"));
  staffCookie = await signInAs(app, email("staff"));
  adminCookie = await signInAs(app, email("admin"));
});

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

const SAFE = /stack|prisma|postgres|node_modules|\/Users\/|at \w+ \(|<html|<!doctype/i;

function expectSafeJson(response: request.Response, status: number) {
  const asked = `${response.request.method} ${new URL(response.request.url).pathname}`;
  expect([asked, response.status, response.type]).toEqual([asked, status, "application/json"]);
  expect(typeof response.body.error).toBe("string");
  expect(JSON.stringify(response.body)).not.toMatch(SAFE);
}

describe("API-42 an address that is not a route (AC-44)", () => {
  it.each([
    ["GET", "/api/nothing-here"],
    ["GET", "/api/tickets/1/nothing-here"],
    ["POST", "/api/dashboard/staff"],
    ["PUT", "/api/tickets/1"],
    ["DELETE", "/api/staff/tickets/1"],
    ["PATCH", "/api/users"],
  ] as const)("%s %s is answered 404 in JSON, signed in or not", async (method, path) => {
    const call = (cookie?: string) => {
      const sent = request(app)[method.toLowerCase() as "get"](path);
      return cookie ? sent.set("Cookie", cookie) : sent;
    };

    for (const cookie of [undefined, requesterCookie, adminCookie]) {
      const response = await call(cookie);
      expectSafeJson(response, 404);
      expect(response.body).toEqual({ error: "Not found" });
      // Express's own answer repeats the method and the path back.
      expect(response.text).not.toContain(path);
    }
  });

  it("deleting an Action Taken is not something the API does", async () => {
    const action = await prisma.actionTaken.create({
      data: {
        ticketId,
        performedById: (await prisma.user.findUniqueOrThrow({ where: { email: email("staff") } })).id,
        actionAt: new Date(),
        description: "Kept.",
        result: "Kept.",
        requestKey: randomUUID(),
      },
    });

    const response = await request(app)
      .delete(`/api/tickets/${ticketId}/actions/${action.id}`)
      .set("Cookie", adminCookie);

    expectSafeJson(response, 404);
    expect(await prisma.actionTaken.count({ where: { id: action.id } })).toBe(1);
  });
});

describe("API-43 an id no row could have (AC-44)", () => {
  const body = {
    requestKey: randomUUID(),
    actionAt: new Date().toISOString(),
    description: "Never saved.",
    result: "Never saved.",
    followUpRequired: false,
  };

  for (const id of [TOO_BIG, FAR_TOO_BIG]) {
    it(`a Requester's routes answer 404 for Ticket ${id}`, async () => {
      for (const response of [
        await request(app).get(`/api/tickets/${id}`).set("Cookie", requesterCookie),
        await request(app).get(`/api/tickets/${id}/comments`).set("Cookie", requesterCookie),
        await request(app).post(`/api/tickets/${id}/comments`).set("Cookie", requesterCookie).send({ body: "x" }),
        await request(app).get(`/api/tickets/${id}/actions`).set("Cookie", requesterCookie),
        await request(app).post(`/api/tickets/${id}/requester-resolved`).set("Cookie", requesterCookie),
        await request(app)
          .post(`/api/tickets/${id}/attachments`)
          .set("Cookie", requesterCookie)
          .attach("file", Buffer.from("89504e470d0a1a0a", "hex"), { filename: "a.png", contentType: "image/png" }),
        await request(app).get(`/api/attachments/${id}/download`).set("Cookie", requesterCookie),
        await request(app).delete(`/api/attachments/${id}`).set("Cookie", requesterCookie).send({ reason: "Uploaded by mistake" }),
      ]) {
        expectSafeJson(response, 404);
      }
    });

    it(`the staff routes answer 404 for Ticket ${id}`, async () => {
      for (const response of [
        await request(app).get(`/api/staff/tickets/${id}`).set("Cookie", staffCookie),
        await request(app).patch(`/api/staff/tickets/${id}/status`).set("Cookie", staffCookie).send({ currentStatus: "OPEN", expectedVersion: 1 }),
        await request(app).patch(`/api/staff/tickets/${id}/owner`).set("Cookie", staffCookie).send({ ownerId: null, expectedVersion: 1 }),
        await request(app).patch(`/api/staff/tickets/${id}/it-priority`).set("Cookie", staffCookie).send({ itPriority: "HIGH", expectedVersion: 1 }),
        await request(app).get(`/api/tickets/${id}/actions`).set("Cookie", staffCookie),
        await request(app).post(`/api/tickets/${id}/actions`).set("Cookie", staffCookie).send(body),
        await request(app).patch(`/api/tickets/${ticketId}/actions/${id}`).set("Cookie", staffCookie).send({ ...body, expectedVersion: 1 }),
        await request(app).get(`/api/attachments/${id}/download`).set("Cookie", staffCookie),
      ]) {
        expectSafeJson(response, 404);
      }
    });

    it(`User Management answers 404 for user ${id}`, async () => {
      for (const response of [
        await request(app).patch(`/api/users/${id}`).set("Cookie", adminCookie).send({ name: "Nobody" }),
        await request(app).post(`/api/users/${id}/initial-password`).set("Cookie", adminCookie).send({ initialPassword: "Initial123!" }),
      ]) {
        expectSafeJson(response, 404);
      }
    });

    it(`an id of ${id} in a body is a validation message on its own field`, async () => {
      const created = await request(app)
        .post("/api/tickets")
        .set("Cookie", requesterCookie)
        .send({ categoryId: id, relatedSystemId: id, requestedPriority: "LOW", summary: "Never saved", description: "Never saved at all." });
      expectSafeJson(created, 400);
      expect(Object.keys(created.body.fields).sort()).toEqual(["categoryId", "relatedSystemId"]);

      const owned = await request(app)
        .patch(`/api/staff/tickets/${ticketId}/owner`)
        .set("Cookie", staffCookie)
        .send({ ownerId: id, expectedVersion: 1 });
      expectSafeJson(owned, 400);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).ownerId).toBeNull();
    });

    it(`an id of ${id} in a list filter is ignored, as any unusable filter is`, async () => {
      const mine = await request(app).get(`/api/tickets?categoryId=${id}`).set("Cookie", requesterCookie);
      expect(mine.status).toBe(200);
      expect(mine.body.pagination.totalItems).toBe(1);

      const queue = await request(app).get(`/api/staff/tickets?categoryId=${id}`).set("Cookie", staffCookie);
      expect(queue.status).toBe(200);
      expect(queue.body.pagination.totalItems).toBeGreaterThan(0);
    });

    it(`page ${id} is clamped, like any other page past the end`, async () => {
      const mine = await request(app).get(`/api/tickets?page=${id}&pageSize=50`).set("Cookie", requesterCookie);
      expect(mine.status).toBe(200);
      expect(mine.body.pagination.totalItems).toBe(1);

      const queue = await request(app).get(`/api/staff/tickets?page=${id}&pageSize=50`).set("Cookie", staffCookie);
      expect(queue.status).toBe(200);
      expect(queue.body.data.length).toBeGreaterThan(0);
    });
  }

  it("the largest id a row can have is still looked up, and simply not found", async () => {
    const response = await request(app).get("/api/staff/tickets/2147483647").set("Cookie", staffCookie);
    expectSafeJson(response, 404);
  });
});

describe("API-44 Action Date/Time names a real offset (BR-05)", () => {
  const send = (actionAt: string) =>
    request(app)
      .post(`/api/tickets/${ticketId}/actions`)
      .set("Cookie", staffCookie)
      .send({ requestKey: randomUUID(), actionAt, description: "Checked.", result: "Fine.", followUpRequired: false });

  /** The moment a minute ago, written with the given offset. */
  const aMinuteAgoAt = (offset: string) => {
    const sign = offset.startsWith("-") ? -1 : 1;
    const [hours, minutes] = offset.slice(1).split(":").map(Number);
    const shifted = new Date(Date.now() - 60_000 + sign * (hours * 60 + minutes) * 60_000);
    return `${shifted.toISOString().slice(0, 19)}${offset}`;
  };

  it.each(["+14:00", "-12:00", "+07:00", "+05:45"])("accepts %s, an offset in use", async (offset) => {
    const response = await send(aMinuteAgoAt(offset));
    expect([offset, response.status]).toEqual([offset, 201]);
  });

  it.each(["+14:01", "+14:30", "+14:59", "-14:30", "+15:00"])("refuses %s, which no zone has", async (offset) => {
    const before = await prisma.actionTaken.count({ where: { ticketId } });
    const response = await send(aMinuteAgoAt(offset));
    expectSafeJson(response, 400);
    expect(Object.keys(response.body.fields)).toEqual(["actionAt"]);
    expect(await prisma.actionTaken.count({ where: { ticketId } })).toBe(before);
  });
});
