import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";

// API-09 (AC-03, BR-08): GET /api/tickets/:id. The ownership rule is the
// point of this endpoint, so most of these assert what a non-owner cannot
// learn, not just what an owner gets.

const prisma = createPrismaClient();
const app = createApp();

const TAG = "ticket-detail.api.test";

let ownerId: number;
let otherId: number;
let ticketId: number;
let attachmentId: number;

beforeAll(async () => {
  const stale = { email: { contains: TAG } };
  await prisma.attachment.deleteMany({ where: { ticket: { requester: stale } } });
  await prisma.ticket.deleteMany({ where: { requester: stale } });
  await prisma.requester.deleteMany({ where: stale });

  const [owner, other] = await Promise.all([
    prisma.requester.create({
      data: { name: `Owner ${TAG}`, email: `owner.${TAG}@toktickit.test` },
    }),
    prisma.requester.create({
      data: { name: `Other ${TAG}`, email: `other.${TAG}@toktickit.test` },
    }),
  ]);
  ownerId = owner.id;
  otherId = other.id;

  const category = await prisma.category.findFirstOrThrow();
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow();

  const created = await request(app).post("/api/tickets").send({
    requesterId: ownerId,
    categoryId: category.id,
    relatedSystemId: relatedSystem.id,
    requestedPriority: "HIGH",
    summary: "Projector will not power on",
    description: "The lecture theatre projector shows no lights at all.",
  });
  ticketId = created.body.id;

  const attachment = await prisma.attachment.create({
    data: {
      ticketId,
      originalFilename: "photo.png",
      storedFilename: `${TAG}-stored.png`,
      mimeType: "image/png",
      sizeBytes: 2048,
    },
  });
  attachmentId = attachment.id;
});

afterAll(async () => {
  const owners = { in: [ownerId, otherId] };
  await prisma.attachment.deleteMany({ where: { ticket: { requesterId: owners } } });
  await prisma.ticket.deleteMany({ where: { requesterId: owners } });
  await prisma.requester.deleteMany({ where: { email: { contains: TAG } } });
  await prisma.$disconnect();
});

function detail(id: number, requesterId: number) {
  return request(app).get(`/api/tickets/${id}?requesterId=${requesterId}`);
}

describe("API-09 GET /api/tickets/:id — the owner's view", () => {
  it("returns the Ticket in the documented shape", async () => {
    const response = await detail(ticketId, ownerId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: ticketId,
      summary: "Projector will not power on",
      requestedPriority: "HIGH",
      currentStatus: "NEW",
    });
    expect(response.body.ticketNumber).toMatch(/^TKT-\d{4}-\d{6}$/);
  });

  it("nests requester, category and related system as objects", async () => {
    const response = await detail(ticketId, ownerId);

    expect(response.body.requester).toMatchObject({ id: ownerId });
    expect(response.body.requester.name).toContain("Owner");
    expect(Object.keys(response.body.category).sort()).toEqual(["id", "name"]);
    expect(Object.keys(response.body.relatedSystem).sort()).toEqual(["id", "name"]);
  });

  it("includes the Description, which the list endpoint omits", async () => {
    const response = await detail(ticketId, ownerId);

    expect(response.body.description).toContain("lecture theatre projector");
  });

  it("includes attachment metadata without the on-disk name", async () => {
    const response = await detail(ticketId, ownerId);

    expect(response.body.attachments).toHaveLength(1);
    expect(response.body.attachments[0]).toMatchObject({
      id: attachmentId,
      originalFilename: "photo.png",
      isRemoved: false,
    });
    // storedFilename is the path on disk and has no client use.
    expect(response.body.attachments[0].storedFilename).toBeUndefined();
  });

  it("does not repeat the owner id outside the nested requester", async () => {
    const response = await detail(ticketId, ownerId);

    expect(response.body.requesterId).toBeUndefined();
  });
});

describe("API-09 ownership (AC-03, BR-08)", () => {
  it("returns 404 for a Ticket owned by someone else", async () => {
    const response = await detail(ticketId, otherId);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Ticket not found" });
  });

  it("leaks nothing about the Ticket in that 404", async () => {
    const response = await detail(ticketId, otherId);

    const body = JSON.stringify(response.body);
    expect(body).not.toContain("Projector");
    expect(body).not.toContain("TKT-");
    expect(body).not.toContain("photo.png");
  });

  it("answers identically for a Ticket that does not exist", async () => {
    const missing = await detail(2_000_000_000, otherId);
    const notOwned = await detail(ticketId, otherId);

    // Byte-identical, so id enumeration cannot separate "someone else's"
    // from "no such Ticket".
    expect(missing.status).toBe(notOwned.status);
    expect(missing.body).toEqual(notOwned.body);
  });

  it("answers 404, not 400, for a malformed Ticket id", async () => {
    const response = await detail(NaN as unknown as number, ownerId);

    // A 400 here would tell a prober which ids are even well-formed.
    expect(response.status).toBe(404);
  });

  it("requires a requesterId", async () => {
    const missing = await request(app).get(`/api/tickets/${ticketId}`);
    const bogus = await request(app).get(`/api/tickets/${ticketId}?requesterId=abc`);

    expect(missing.status).toBe(400);
    expect(bogus.status).toBe(400);
  });

  it("does not accept an unknown requesterId as an owner", async () => {
    const response = await detail(ticketId, 2_000_000_000);

    expect(response.status).toBe(404);
  });
});
