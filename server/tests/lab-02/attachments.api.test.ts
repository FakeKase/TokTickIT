import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";

// API-10, API-11, API-12, API-13, API-28: POST /api/tickets/:id/attachments.
// Uploads really are written to server/uploads here, so the "not stored"
// assertions check the directory as well as the table — a rejected upload that
// still left a file behind would pass a database-only test.

const prisma = createPrismaClient();
const app = createApp();

const UPLOADS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "uploads",
);

const TAG = "attachments.api.test";
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000",
  "hex",
);

let requesterId: number;
let otherRequesterId: number;
let ticketId: number;
let otherTicketId: number;
let filesBefore: string[] = [];

async function uploadedFiles() {
  const all = await readdir(UPLOADS_DIR).catch(() => [] as string[]);
  return all.filter((name) => !filesBefore.includes(name));
}

async function makeTicket(ownerId: number) {
  const category = await prisma.category.findFirstOrThrow();
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow();
  const response = await request(app).post("/api/tickets").send({
    requesterId: ownerId,
    categoryId: category.id,
    relatedSystemId: relatedSystem.id,
    requestedPriority: "LOW",
    summary: `Ticket for ${TAG}`,
    description: "A ticket created purely to hang attachments off.",
  });
  return response.body.id as number;
}

function upload(id: number, owner: number) {
  return request(app)
    .post(`/api/tickets/${id}/attachments`)
    .field("requesterId", String(owner));
}

beforeAll(async () => {
  filesBefore = await readdir(UPLOADS_DIR).catch(() => [] as string[]);

  // A previous run that failed before afterAll would leave these behind and
  // collide on the unique email, so clear them first.
  const stale = { email: { contains: TAG } };
  await prisma.attachment.deleteMany({ where: { ticket: { requester: stale } } });
  await prisma.ticket.deleteMany({ where: { requester: stale } });
  await prisma.requester.deleteMany({ where: stale });

  const owner = await prisma.requester.create({
    data: { name: `Owner ${TAG}`, email: `owner.${TAG}@toktickit.test` },
  });
  const other = await prisma.requester.create({
    data: { name: `Other ${TAG}`, email: `other.${TAG}@toktickit.test` },
  });
  requesterId = owner.id;
  otherRequesterId = other.id;

  ticketId = await makeTicket(requesterId);
  otherTicketId = await makeTicket(otherRequesterId);
});

afterAll(async () => {
  for (const name of await uploadedFiles()) {
    await unlink(path.join(UPLOADS_DIR, name)).catch(() => {});
  }
  // Covers the extra Tickets the cap and retry cases create, not just the two
  // from beforeAll — Attachment.ticketId is a restricting FK, so every child
  // has to go first.
  const owners = { in: [requesterId, otherRequesterId] };
  await prisma.attachment.deleteMany({ where: { ticket: { requesterId: owners } } });
  await prisma.ticket.deleteMany({ where: { requesterId: owners } });
  await prisma.requester.deleteMany({ where: { email: { contains: TAG } } });
  await prisma.$disconnect();
});

describe("API-10 upload a valid attachment (BR-19)", () => {
  it("returns 201 and links the Attachment to the Ticket", async () => {
    const response = await upload(ticketId, requesterId).attach("file", PNG, {
      filename: "screenshot.png",
      contentType: "image/png",
    });

    expect(response.status).toBe(201);
    expect(response.body.originalFilename).toBe("screenshot.png");
    expect(response.body.mimeType).toBe("image/png");
    expect(response.body.isRemoved).toBe(false);

    const stored = await prisma.attachment.findUnique({
      where: { id: response.body.id },
    });
    expect(stored?.ticketId).toBe(ticketId);
  });

  it("keeps the on-disk name out of the response", async () => {
    const response = await upload(ticketId, requesterId).attach("file", PNG, {
      filename: "second.png",
      contentType: "image/png",
    });

    expect(response.body.storedFilename).toBeUndefined();
    expect(Object.keys(response.body).sort()).toEqual([
      "createdAt",
      "id",
      "isRemoved",
      "mimeType",
      "originalFilename",
      "sizeBytes",
      "ticketId",
    ]);
  });

  it("stores under a random name, not the name the client supplied", async () => {
    const response = await upload(ticketId, requesterId).attach("file", PNG, {
      filename: "user-chosen.png",
      contentType: "image/png",
    });

    const stored = await prisma.attachment.findUnique({
      where: { id: response.body.id },
    });
    expect(stored?.storedFilename).not.toContain("user-chosen");
    expect(stored?.storedFilename).toMatch(/^[0-9a-f-]{36}\.png$/);
  });

  it("BR-08: returns 404 for a Ticket owned by someone else", async () => {
    const response = await upload(otherTicketId, requesterId).attach("file", PNG, {
      filename: "nope.png",
      contentType: "image/png",
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Ticket not found");
    expect(
      await prisma.attachment.count({ where: { ticketId: otherTicketId } }),
    ).toBe(0);
  });

  it("returns 404 for a Ticket that does not exist at all, identically", async () => {
    const response = await upload(2_000_000_000, requesterId).attach("file", PNG, {
      filename: "nope.png",
      contentType: "image/png",
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Ticket not found");
  });

  it("requires a requesterId", async () => {
    const response = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .attach("file", PNG, { filename: "x.png", contentType: "image/png" });

    expect(response.status).toBe(400);
  });

  it("requires a file", async () => {
    const response = await upload(ticketId, requesterId);

    expect(response.status).toBe(400);
  });
});

describe("API-11 oversized upload (BR-20)", () => {
  it("returns 413 and stores neither a row nor a file", async () => {
    const before = await prisma.attachment.count({ where: { ticketId } });
    const filesAtStart = (await uploadedFiles()).length;

    const response = await upload(ticketId, requesterId).attach(
      "file",
      Buffer.alloc(6 * 1024 * 1024, 1),
      { filename: "huge.png", contentType: "image/png" },
    );

    expect(response.status).toBe(413);
    expect(await prisma.attachment.count({ where: { ticketId } })).toBe(before);
    expect((await uploadedFiles()).length).toBe(filesAtStart);
  });

  it("accepts a file just under the limit", async () => {
    const response = await upload(ticketId, requesterId).attach(
      "file",
      Buffer.alloc(5 * 1024 * 1024 - 1024, 1),
      { filename: "big-enough.pdf", contentType: "application/pdf" },
    );

    expect(response.status).toBe(201);
  });
});

describe("API-12 unsupported type (BR-19)", () => {
  it("returns 415 and stores neither a row nor a file", async () => {
    const before = await prisma.attachment.count({ where: { ticketId } });
    const filesAtStart = (await uploadedFiles()).length;

    const response = await upload(ticketId, requesterId).attach(
      "file",
      Buffer.from("MZ"),
      { filename: "payload.exe", contentType: "application/x-msdownload" },
    );

    expect(response.status).toBe(415);
    expect(response.body.error).toMatch(/JPG, JPEG, PNG, WEBP, PDF/);
    expect(await prisma.attachment.count({ where: { ticketId } })).toBe(before);
    expect((await uploadedFiles()).length).toBe(filesAtStart);
  });

  it("rejects a disallowed file renamed to a permitted extension", async () => {
    // BR-19 is explicit that the declared MIME type is what counts, so an
    // .exe wearing a .png name must still be refused.
    const response = await upload(ticketId, requesterId).attach(
      "file",
      Buffer.from("MZ"),
      { filename: "payload.png", contentType: "application/x-msdownload" },
    );

    expect(response.status).toBe(415);
  });

  it("rejects a permitted MIME type whose extension disagrees", async () => {
    const response = await upload(ticketId, requesterId).attach("file", PNG, {
      filename: "payload.exe",
      contentType: "image/png",
    });

    expect(response.status).toBe(415);
  });
});

describe("API-13 the 5-attachment cap (BR-21)", () => {
  it("returns 409 on the sixth active attachment", async () => {
    const capTicket = await makeTicket(requesterId);

    for (let i = 0; i < 5; i += 1) {
      const ok = await upload(capTicket, requesterId).attach("file", PNG, {
        filename: `file-${i}.png`,
        contentType: "image/png",
      });
      expect(ok.status).toBe(201);
    }

    const sixth = await upload(capTicket, requesterId).attach("file", PNG, {
      filename: "sixth.png",
      contentType: "image/png",
    });

    expect(sixth.status).toBe(409);
    expect(sixth.body.error).toMatch(/maximum of 5/);
    expect(await prisma.attachment.count({ where: { ticketId: capTicket } })).toBe(5);
  });

  it("counts only active Attachments, so removing one frees a slot", async () => {
    const capTicket = await makeTicket(requesterId);

    for (let i = 0; i < 5; i += 1) {
      await upload(capTicket, requesterId).attach("file", PNG, {
        filename: `file-${i}.png`,
        contentType: "image/png",
      });
    }

    const first = await prisma.attachment.findFirstOrThrow({
      where: { ticketId: capTicket },
    });
    await prisma.attachment.update({
      where: { id: first.id },
      data: { isRemoved: true, removedAt: new Date(), removedReason: "test" },
    });

    const replacement = await upload(capTicket, requesterId).attach("file", PNG, {
      filename: "replacement.png",
      contentType: "image/png",
    });

    expect(replacement.status).toBe(201);
  });
});

describe("API-28 a failed upload leaves the Ticket intact (BR-22)", () => {
  it("keeps the Ticket valid and lets a retry succeed", async () => {
    const retryTicket = await makeTicket(requesterId);

    const failed = await upload(retryTicket, requesterId).attach(
      "file",
      Buffer.from("MZ"),
      { filename: "bad.exe", contentType: "application/x-msdownload" },
    );
    expect(failed.status).toBe(415);

    // The Ticket must survive untouched — no rollback, per BR-22.
    const ticket = await prisma.ticket.findUnique({ where: { id: retryTicket } });
    expect(ticket).not.toBeNull();
    expect(ticket?.ticketNumber).toMatch(/^TKT-\d{4}-\d{6}$/);
    expect(
      await prisma.attachment.count({ where: { ticketId: retryTicket } }),
    ).toBe(0);

    const retry = await upload(retryTicket, requesterId).attach("file", PNG, {
      filename: "good.png",
      contentType: "image/png",
    });

    expect(retry.status).toBe(201);
    expect(
      await prisma.attachment.count({ where: { ticketId: retryTicket } }),
    ).toBe(1);
  });
});
