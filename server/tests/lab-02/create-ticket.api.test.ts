import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";

// API-01, API-02, API-03, API-20, API-21, API-22: POST /api/tickets.
// Runs against the real database, like the other API tests, so BR-18's
// "nothing is persisted" claims are checked against actual row counts rather
// than a mock's call log.

const prisma = createPrismaClient();
const app = createApp();

const TAG = "create-ticket.api.test";

let requesterId: number;
let inactiveRequesterId: number;
let categoryId: number;
let relatedSystemId: number;

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    requesterId,
    categoryId,
    relatedSystemId,
    requestedPriority: "MEDIUM",
    summary: "Laptop battery drains quickly",
    description: "The battery drops from full to empty in about an hour.",
    ...overrides,
  };
}

async function ticketCount() {
  return prisma.ticket.count({ where: { requesterId } });
}

beforeAll(async () => {
  // A previous run that failed before afterAll would leave these behind and
  // collide on the unique email, so clear them first.
  const stale = { email: { contains: TAG } };
  await prisma.attachment.deleteMany({ where: { ticket: { requester: stale } } });
  await prisma.ticket.deleteMany({ where: { requester: stale } });
  await prisma.requester.deleteMany({ where: stale });

  const active = await prisma.requester.create({
    data: { name: `Active ${TAG}`, email: `active.${TAG}@toktickit.test` },
  });
  const inactive = await prisma.requester.create({
    data: {
      name: `Inactive ${TAG}`,
      email: `inactive.${TAG}@toktickit.test`,
      isActive: false,
    },
  });
  requesterId = active.id;
  inactiveRequesterId = inactive.id;

  const category = await prisma.category.findFirstOrThrow();
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow();
  categoryId = category.id;
  relatedSystemId = relatedSystem.id;
});

afterAll(async () => {
  await prisma.ticket.deleteMany({
    where: { requesterId: { in: [requesterId, inactiveRequesterId] } },
  });
  await prisma.requester.deleteMany({ where: { email: { contains: TAG } } });
  await prisma.$disconnect();
});

describe("API-01 POST /api/tickets — valid creation", () => {
  it("returns 201 with a generated Ticket Number and NEW status", async () => {
    const response = await request(app).post("/api/tickets").send(validBody());

    expect(response.status).toBe(201);
    expect(response.body.ticketNumber).toMatch(/^TKT-\d{4}-\d{6}$/);
    expect(response.body.currentStatus).toBe("NEW");
    expect(response.body.requesterId).toBe(requesterId);
  });

  it("persists exactly what it returned", async () => {
    const response = await request(app).post("/api/tickets").send(validBody());

    const stored = await prisma.ticket.findUnique({
      where: { id: response.body.id },
    });
    expect(stored?.ticketNumber).toBe(response.body.ticketNumber);
    expect(stored?.summary).toBe("Laptop battery drains quickly");
  });

  it("BR-02: ignores a client-supplied currentStatus", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .send(validBody({ currentStatus: "RESOLVED" }));

    expect(response.status).toBe(201);
    expect(response.body.currentStatus).toBe("NEW");
  });

  it("BR-01: never leaves a PENDING placeholder as the official number", async () => {
    const response = await request(app).post("/api/tickets").send(validBody());

    expect(response.body.ticketNumber).not.toMatch(/^PENDING-/);
    expect(
      await prisma.ticket.count({ where: { ticketNumber: { startsWith: "PENDING-" } } }),
    ).toBe(0);
  });

  it("BR-01: issues a distinct number to each Ticket", async () => {
    const [first, second] = await Promise.all([
      request(app).post("/api/tickets").send(validBody()),
      request(app).post("/api/tickets").send(validBody()),
    ]);

    expect(first.body.ticketNumber).not.toBe(second.body.ticketNumber);
  });

  it("BR-13/BR-14: stores the trimmed Summary and Description", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .send(
        validBody({
          summary: "   Padded summary   ",
          description: "   A description with padding around it.   ",
        }),
      );

    expect(response.body.summary).toBe("Padded summary");
    expect(response.body.description).toBe("A description with padding around it.");
  });
});

describe("API-02 POST /api/tickets — missing required selections", () => {
  it("BR-15: returns 400 with a message per missing field and saves nothing", async () => {
    const before = await ticketCount();

    const response = await request(app).post("/api/tickets").send({
      requesterId,
      summary: "Printer is offline",
      description: "The shared printer does not appear on the network.",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Validation failed");
    expect(Object.keys(response.body.fields).sort()).toEqual([
      "categoryId",
      "relatedSystemId",
      "requestedPriority",
    ]);
    expect(await ticketCount()).toBe(before);
  });

  it("rejects a Requested Priority outside the enum", async () => {
    const before = await ticketCount();

    const response = await request(app)
      .post("/api/tickets")
      .send(validBody({ requestedPriority: "URGENT" }));

    expect(response.status).toBe(400);
    expect(response.body.fields.requestedPriority).toBeTruthy();
    expect(await ticketCount()).toBe(before);
  });

  it("rejects an empty body without throwing", async () => {
    const response = await request(app).post("/api/tickets").send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Validation failed");
  });
});

describe("API-03 / API-21 POST /api/tickets — Summary bounds (BR-13)", () => {
  it("rejects a Summary below 5 characters", async () => {
    const before = await ticketCount();

    const response = await request(app)
      .post("/api/tickets")
      .send(validBody({ summary: "abcd" }));

    expect(response.status).toBe(400);
    expect(response.body.fields.summary).toMatch(/at least 5/);
    expect(await ticketCount()).toBe(before);
  });

  it("rejects a Summary above 120 characters", async () => {
    const before = await ticketCount();

    const response = await request(app)
      .post("/api/tickets")
      .send(validBody({ summary: "a".repeat(121) }));

    expect(response.status).toBe(400);
    expect(response.body.fields.summary).toMatch(/at most 120/);
    expect(await ticketCount()).toBe(before);
  });

  it("accepts both boundary lengths", async () => {
    const atMin = await request(app)
      .post("/api/tickets")
      .send(validBody({ summary: "abcde" }));
    const atMax = await request(app)
      .post("/api/tickets")
      .send(validBody({ summary: "a".repeat(120) }));

    expect(atMin.status).toBe(201);
    expect(atMax.status).toBe(201);
  });

  it("counts length after trimming, not before", async () => {
    // "   ab   " is 8 raw characters but 2 once trimmed — BR-13 measures the
    // trimmed value, so this must fail rather than sneak past on whitespace.
    const response = await request(app)
      .post("/api/tickets")
      .send(validBody({ summary: "   ab   " }));

    expect(response.status).toBe(400);
    expect(response.body.fields.summary).toBeTruthy();
  });
});

describe("API-20 POST /api/tickets — Description bounds (BR-14)", () => {
  it("rejects a Description below 10 characters", async () => {
    const before = await ticketCount();

    const response = await request(app)
      .post("/api/tickets")
      .send(validBody({ description: "too short" }));

    expect(response.status).toBe(400);
    expect(response.body.fields.description).toMatch(/at least 10/);
    expect(await ticketCount()).toBe(before);
  });

  it("rejects a Description above 2000 characters", async () => {
    const before = await ticketCount();

    const response = await request(app)
      .post("/api/tickets")
      .send(validBody({ description: "a".repeat(2001) }));

    expect(response.status).toBe(400);
    expect(response.body.fields.description).toMatch(/at most 2000/);
    expect(await ticketCount()).toBe(before);
  });

  it("accepts both boundary lengths", async () => {
    const atMin = await request(app)
      .post("/api/tickets")
      .send(validBody({ description: "a".repeat(10) }));
    const atMax = await request(app)
      .post("/api/tickets")
      .send(validBody({ description: "a".repeat(2000) }));

    expect(atMin.status).toBe(201);
    expect(atMax.status).toBe(201);
  });
});

describe("API-22 POST /api/tickets — unrecognized references", () => {
  it("returns 404 for a Category id with no row", async () => {
    const before = await ticketCount();

    const response = await request(app)
      .post("/api/tickets")
      .send(validBody({ categoryId: 2_000_000_000 }));

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/Category/i);
    expect(await ticketCount()).toBe(before);
  });

  it("returns 404 for a Related System id with no row", async () => {
    const before = await ticketCount();

    const response = await request(app)
      .post("/api/tickets")
      .send(validBody({ relatedSystemId: 2_000_000_000 }));

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/Related System/i);
    expect(await ticketCount()).toBe(before);
  });

  it("BR-12: returns 404 for an inactive Requester", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .send(validBody({ requesterId: inactiveRequesterId }));

    expect(response.status).toBe(404);
    expect(
      await prisma.ticket.count({ where: { requesterId: inactiveRequesterId } }),
    ).toBe(0);
  });

  it("returns a safe message that leaks no internal detail", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .send(validBody({ categoryId: 2_000_000_000 }));

    expect(JSON.stringify(response.body)).not.toMatch(/prisma|sql|stack|at /i);
  });
});
