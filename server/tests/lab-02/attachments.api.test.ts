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

describe("API-13 the cap holds under concurrent uploads (BR-21)", () => {
  it("admits at most five when six upload at once", async () => {
    const raceTicket = await makeTicket(requesterId);

    // Sequential uploads cannot expose a check-then-insert race: each one
    // commits before the next reads. These overlap deliberately.
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        upload(raceTicket, requesterId).attach("file", PNG, {
          filename: `race-${i}.png`,
          contentType: "image/png",
        }),
      ),
    );

    const created = results.filter((r) => r.status === 201).length;
    const stored = await prisma.attachment.count({
      where: { ticketId: raceTicket, isRemoved: false },
    });

    expect(stored).toBeLessThanOrEqual(5);
    expect(created).toBe(stored);
  });
});

// API-14, API-15, API-16, API-17, API-27: metadata, download and soft removal
// (api-spec.md §8-10). The ownership rule is the same one the upload endpoint
// enforces, so these assert what a non-owner cannot learn from any of them.

/**
 * Uploads one Attachment, to its own fresh Ticket unless told otherwise.
 * Sharing `ticketId` with the cases above would run into the 5-active cap
 * they have already partly consumed, so each case here starts clean.
 */
async function makeAttachment(ticket?: number, filename = "doc.pdf") {
  const target = ticket ?? (await makeTicket(requesterId));
  const response = await upload(target, requesterId).attach(
    "file",
    Buffer.from("%PDF-1.4 fixture"),
    { filename, contentType: "application/pdf" },
  );
  return response.body.id as number;
}

describe("API-14 GET /api/attachments/:id/download (AC-19)", () => {
  it("returns the stored bytes with a filename header", async () => {
    const id = await makeAttachment(undefined, "battery-report.pdf");

    const response = await request(app)
      .get(`/api/attachments/${id}/download?requesterId=${requesterId}`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain(
      'filename="battery-report.pdf"',
    );
    expect(response.body.toString()).toContain("%PDF-1.4 fixture");
  });

  it("strips quotes and newlines from a hostile filename", async () => {
    // originalFilename is client-supplied; unescaped it could break the header.
    const id = await makeAttachment(undefined, 'ev"il\nname.pdf');

    const response = await request(app)
      .get(`/api/attachments/${id}/download?requesterId=${requesterId}`);

    const header = response.headers["content-disposition"];
    expect(header).not.toContain('"il');
    expect(header.split("\n")).toHaveLength(1);
  });

  it("returns metadata separately, without the stored filename", async () => {
    const id = await makeAttachment();

    const response = await request(app)
      .get(`/api/attachments/${id}?requesterId=${requesterId}`);

    expect(response.status).toBe(200);
    expect(response.body.storedFilename).toBeUndefined();
    expect(response.body.originalFilename).toBe("doc.pdf");
  });
});

describe("API-15 removed Attachments are not downloadable (AC-21, BR-26)", () => {
  it("answers 404, identically to one that never existed", async () => {
    const id = await makeAttachment();
    await request(app)
      .delete(`/api/attachments/${id}`)
      .send({ requesterId, reason: "Uploaded the wrong file" });

    const removed = await request(app)
      .get(`/api/attachments/${id}/download?requesterId=${requesterId}`);
    const nonexistent = await request(app)
      .get(`/api/attachments/2000000000/download?requesterId=${requesterId}`);

    // BR-26: a distinct status would confirm the file was once there.
    expect(removed.status).toBe(404);
    expect(removed.status).toBe(nonexistent.status);
    expect(removed.body).toEqual(nonexistent.body);
  });

  it("BR-24: still serves its metadata after removal", async () => {
    const id = await makeAttachment();
    await request(app)
      .delete(`/api/attachments/${id}`)
      .send({ requesterId, reason: "Superseded by a clearer scan" });

    const response = await request(app)
      .get(`/api/attachments/${id}?requesterId=${requesterId}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      isRemoved: true,
      removedReason: "Superseded by a clearer scan",
    });
    expect(response.body.removedAt).not.toBeNull();
  });

  it("BR-23: leaves the file on disk", async () => {
    const before = (await uploadedFiles()).length;
    const id = await makeAttachment();
    await request(app)
      .delete(`/api/attachments/${id}`)
      .send({ requesterId, reason: "Wrong screenshot" });

    // Lab 2 keeps the bytes; only the row is marked.
    expect((await uploadedFiles()).length).toBe(before + 1);
  });
});

describe("API-16 removal requires a reason (AC-22, BR-25)", () => {
  it("rejects a missing reason and changes nothing", async () => {
    const id = await makeAttachment();

    const response = await request(app)
      .delete(`/api/attachments/${id}`)
      .send({ requesterId });

    expect(response.status).toBe(400);
    expect(response.body.fields.reason).toBeTruthy();
    const still = await prisma.attachment.findUnique({ where: { id } });
    expect(still?.isRemoved).toBe(false);
  });

  it("rejects a reason under 3 characters, including one that is only spaces", async () => {
    const id = await makeAttachment();

    for (const reason of ["ab", "   ", ""]) {
      const response = await request(app)
        .delete(`/api/attachments/${id}`)
        .send({ requesterId, reason });
      expect(response.status).toBe(400);
    }

    const still = await prisma.attachment.findUnique({ where: { id } });
    expect(still?.isRemoved).toBe(false);
  });

  it("stores the trimmed reason", async () => {
    const id = await makeAttachment();

    const response = await request(app)
      .delete(`/api/attachments/${id}`)
      .send({ requesterId, reason: "   Wrong file uploaded   " });

    expect(response.body.removedReason).toBe("Wrong file uploaded");
  });
});

describe("API-17 soft removal keeps the row (AC-20, BR-23)", () => {
  it("returns the removed metadata and never deletes the row", async () => {
    const id = await makeAttachment();

    const response = await request(app)
      .delete(`/api/attachments/${id}`)
      .send({ requesterId, reason: "Replaced with a clearer photo" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id, isRemoved: true });
    expect(await prisma.attachment.findUnique({ where: { id } })).not.toBeNull();
  });

  it("is not silently repeatable", async () => {
    const id = await makeAttachment();
    const first = await request(app)
      .delete(`/api/attachments/${id}`)
      .send({ requesterId, reason: "First removal" });
    const second = await request(app)
      .delete(`/api/attachments/${id}`)
      .send({ requesterId, reason: "Second attempt" });

    expect(first.status).toBe(200);
    // 409 rather than a 404: the owner already knows it exists, so this
    // reveals nothing the ownership checks are protecting.
    expect(second.status).toBe(409);

    const stored = await prisma.attachment.findUnique({ where: { id } });
    expect(stored?.removedReason).toBe("First removal");
  });

  it("frees a slot under the 5-attachment cap", async () => {
    const capTicket = await makeTicket(requesterId);
    const ids: number[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(await makeAttachment(capTicket, `f${i}.pdf`));

    const blocked = await upload(capTicket, requesterId).attach("file", PNG, {
      filename: "sixth.png",
      contentType: "image/png",
    });
    expect(blocked.status).toBe(409);

    await request(app)
      .delete(`/api/attachments/${ids[0]}`)
      .send({ requesterId, reason: "Making room" });

    const allowed = await upload(capTicket, requesterId).attach("file", PNG, {
      filename: "replacement.png",
      contentType: "image/png",
    });
    expect(allowed.status).toBe(201);
  });
});

describe("API-27 cross-Requester access (AC-34, BR-08/BR-25)", () => {
  it("answers 404 for metadata, download and removal alike", async () => {
    const id = await makeAttachment();

    const metadata = await request(app)
      .get(`/api/attachments/${id}?requesterId=${otherRequesterId}`);
    const download = await request(app)
      .get(`/api/attachments/${id}/download?requesterId=${otherRequesterId}`);
    const removal = await request(app)
      .delete(`/api/attachments/${id}`)
      .send({ requesterId: otherRequesterId, reason: "Not mine to remove" });

    expect([metadata.status, download.status, removal.status]).toEqual([404, 404, 404]);
  });

  it("is indistinguishable from a nonexistent Attachment", async () => {
    const id = await makeAttachment();

    const notOwned = await request(app)
      .get(`/api/attachments/${id}?requesterId=${otherRequesterId}`);
    const nonexistent = await request(app)
      .get(`/api/attachments/2000000000?requesterId=${otherRequesterId}`);

    expect(notOwned.body).toEqual(nonexistent.body);
  });

  it("does not remove the Attachment a non-owner asked to remove", async () => {
    const id = await makeAttachment();

    await request(app)
      .delete(`/api/attachments/${id}`)
      .send({ requesterId: otherRequesterId, reason: "Not mine to remove" });

    const stored = await prisma.attachment.findUnique({ where: { id } });
    expect(stored?.isRemoved).toBe(false);
  });

  it("requires a requesterId on every one of the three", async () => {
    const id = await makeAttachment();

    const metadata = await request(app).get(`/api/attachments/${id}`);
    const download = await request(app).get(`/api/attachments/${id}/download`);
    const removal = await request(app)
      .delete(`/api/attachments/${id}`)
      .send({ reason: "No requester supplied" });

    expect([metadata.status, download.status, removal.status]).toEqual([400, 400, 400]);
  });
});

describe("API-17 removal is atomic under concurrency (BR-23)", () => {
  it("admits exactly one removal when several land at once", async () => {
    const id = await makeAttachment();

    // Sequential deletes cannot expose a check-then-update race: the first
    // commits before the second reads. These overlap deliberately.
    const responses = await Promise.all(
      ["First reason", "Second reason", "Third reason"].map((reason) =>
        request(app).delete(`/api/attachments/${id}`).send({ requesterId, reason }),
      ),
    );

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);

    // The winner's reason must survive — a later update overwriting it would
    // mean two callers both believed they had removed it.
    const winner = responses.find((r) => r.status === 200)!;
    const stored = await prisma.attachment.findUnique({ where: { id } });
    expect(stored?.removedReason).toBe(winner.body.removedReason);
  });
});
