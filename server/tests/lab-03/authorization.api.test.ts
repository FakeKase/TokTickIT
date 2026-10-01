import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";
import { SESSION_COOKIE } from "../../src/lib/session.js";
import {
  type AuthenticatedRequest,
  requireAuth,
  requirePasswordChanged,
  requireRole,
} from "../../src/middleware/auth.js";
import { FIXTURE_PASSWORD, fixtureUser } from "../helpers/users.js";
import { requireSessionCookie, signInAs } from "../helpers/session.js";

// API-09 to API-15 land here as the endpoints they protect are converted
// (Issue #41). This file starts with the middleware itself, mounted on routes
// that exist only in this test.
//
// A probe app rather than the real one, deliberately: in this Issue no Lab 2
// endpoint is wrapped yet, so asserting against the real app would either prove
// nothing or require shipping half of #41 early. The middleware is the unit
// under test, and this is the smallest thing that exercises it as Express
// actually runs it - through the cookie parser, in order, with real sessions.

const prisma = createPrismaClient();
const realApp = createApp();

const TAG = "authorization.api.test";
const email = (who: string) => `${who}.${TAG}@toktickit.test`;

const probe = express();
probe.use(express.json());
probe.use(cookieParser());
probe.get(
  "/probe/authenticated",
  requireAuth(prisma),
  (req: AuthenticatedRequest, res) => {
    res.json({ email: req.auth!.user.email });
  },
);
probe.get(
  "/probe/onboarded",
  requireAuth(prisma),
  requirePasswordChanged,
  (_req, res) => res.json({ ok: true }),
);
probe.get(
  "/probe/staff",
  requireAuth(prisma),
  requirePasswordChanged,
  requireRole("IT_STAFF", "ADMINISTRATOR"),
  (_req, res) => res.json({ ok: true }),
);
probe.get(
  "/probe/admin",
  requireAuth(prisma),
  requirePasswordChanged,
  requireRole("ADMINISTRATOR"),
  (_req, res) => res.json({ ok: true }),
);

const cookieFor = async (who: string) => {
  const response = await request(realApp)
    .post("/api/auth/login")
    .send({ email: email(who), password: FIXTURE_PASSWORD });
  return requireSessionCookie(response);
};

beforeAll(async () => {
  const stale = { email: { contains: TAG } };
  await prisma.session.deleteMany({ where: { user: stale } });
  await prisma.user.deleteMany({ where: stale });

  await prisma.user.createMany({
    data: [
      fixtureUser({ name: `Requester ${TAG}`, email: email("requester") }),
      fixtureUser({ name: `Second ${TAG}`, email: email("second") }),
      fixtureUser({
        name: `Staff ${TAG}`,
        email: email("staff"),
        role: "IT_STAFF",
      }),
      fixtureUser({
        name: `Admin ${TAG}`,
        email: email("admin"),
        role: "ADMINISTRATOR",
      }),
      fixtureUser({
        name: `Gated ${TAG}`,
        email: email("gated"),
        role: "IT_STAFF",
        mustChangePassword: true,
      }),
    ],
  });
});

afterAll(async () => {
  const stale = { email: { contains: TAG } };
  await prisma.session.deleteMany({ where: { user: stale } });
  await prisma.user.deleteMany({ where: stale });
  await prisma.$disconnect();
});

describe("requireAuth", () => {
  it("passes a live session through and names the caller", async () => {
    const response = await request(probe)
      .get("/probe/authenticated")
      .set("Cookie", await cookieFor("requester"));

    expect(response.status).toBe(200);
    expect(response.body.email).toBe(email("requester"));
  });

  it("rejects no cookie, a junk cookie, and a deactivated user's live session", async () => {
    expect((await request(probe).get("/probe/authenticated")).status).toBe(401);

    const junk = await request(probe)
      .get("/probe/authenticated")
      .set("Cookie", `${SESSION_COOKIE}=not-a-token`);
    expect(junk.status).toBe(401);
    expect(junk.body).toEqual({ error: "Authentication required" });

    // AC-10 / BR-12: deactivation takes effect on the next request, not at
    // session expiry.
    const cookie = await cookieFor("requester");
    expect(
      (await request(probe).get("/probe/authenticated").set("Cookie", cookie))
        .status,
    ).toBe(200);
    await prisma.user.update({
      where: { email: email("requester") },
      data: { isActive: false },
    });
    expect(
      (await request(probe).get("/probe/authenticated").set("Cookie", cookie))
        .status,
    ).toBe(401);

    await prisma.user.update({
      where: { email: email("requester") },
      data: { isActive: true },
    });
  });
});

describe("requirePasswordChanged (BR-14, AC-02)", () => {
  it("blocks a gated user with a code the client can route on", async () => {
    const cookie = await cookieFor("gated");

    const blocked = await request(probe)
      .get("/probe/onboarded")
      .set("Cookie", cookie);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("PASSWORD_CHANGE_REQUIRED");

    // Distinct from a role refusal: "go and change your password" and "you may
    // never come here" are different screens, so they cannot share a body.
    const roleRefusal = await request(probe)
      .get("/probe/admin")
      .set("Cookie", await cookieFor("staff"));
    expect(roleRefusal.status).toBe(403);
    expect(roleRefusal.body.code).toBeUndefined();
  });

  it("lets an onboarded user through", async () => {
    const response = await request(probe)
      .get("/probe/onboarded")
      .set("Cookie", await cookieFor("staff"));

    expect(response.status).toBe(200);
  });

  it("still allows the three endpoints a gated user needs (BR-14)", async () => {
    const cookie = await cookieFor("gated");

    expect(
      (await request(realApp).get("/api/auth/me").set("Cookie", cookie)).status,
    ).toBe(200);
    expect(
      (await request(realApp).post("/api/auth/logout").set("Cookie", cookie))
        .status,
    ).toBe(204);
  });
});

// API-09 to API-14: the rules that only became testable once the Lab 2
// endpoints moved onto the session (Issue #41).
describe("the converted Lab 2 endpoints", () => {
  /**
   * Every route Issue #41 converted, with a body where one is needed.
   *
   * All seven, not a sample: a route that lost its guard in a later edit is
   * exactly what this list exists to catch, and two of seven would not catch
   * it. The ticket ids are deliberately absent - the gate answers before any
   * lookup, so a nonexistent id still produces 403 rather than 404, which is
   * itself worth knowing.
   */
  const CONVERTED_ROUTES = [
    { method: "post" as const, path: "/api/tickets" },
    { method: "get" as const, path: "/api/tickets" },
    { method: "get" as const, path: "/api/tickets/999999999" },
    { method: "post" as const, path: "/api/tickets/999999999/attachments" },
    { method: "get" as const, path: "/api/attachments/999999999" },
    { method: "get" as const, path: "/api/attachments/999999999/download" },
    { method: "delete" as const, path: "/api/attachments/999999999" },
  ];

  /** A Ticket owned by `who`, with one Attachment, created through the API. */
  async function ticketWithAttachment(who: string) {
    const cookie = await cookieFor(who);
    const category = await prisma.category.findFirstOrThrow();
    const relatedSystem = await prisma.relatedSystem.findFirstOrThrow();

    const created = await request(realApp)
      .post("/api/tickets")
      .set("Cookie", cookie)
      .send({
        categoryId: category.id,
        relatedSystemId: relatedSystem.id,
        requestedPriority: "LOW",
        summary: `Owned by ${who} ${TAG}`,
        description: "Created so the ownership rules have something to refuse.",
      });
    expect(created.status).toBe(201);

    const uploaded = await request(realApp)
      .post(`/api/tickets/${created.body.id}/attachments`)
      .set("Cookie", cookie)
      .attach("file", Buffer.from("89504e470d0a1a0a", "hex"), {
        filename: "evidence.png",
        contentType: "image/png",
      });
    expect(uploaded.status).toBe(201);

    return { ticketId: created.body.id as number, attachmentId: uploaded.body.id as number };
  }

  it("API-09 (AC-02, BR-14): a gated user reaches none of the seven", async () => {
    const cookie = await cookieFor("gated");

    for (const route of CONVERTED_ROUTES) {
      const response = await request(realApp)[route.method](route.path).set("Cookie", cookie);

      expect(response.status, `${route.method} ${route.path}`).toBe(403);
      expect(response.body.code, `${route.method} ${route.path}`).toBe(
        "PASSWORD_CHANGE_REQUIRED",
      );
    }
  });

  it("API-09 (BR-14): and still reaches the three that let them fix it", async () => {
    const cookie = await cookieFor("gated");

    expect((await request(realApp).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);

    // A wrong current password, so the session survives for the logout below:
    // 401 proves the route was reached, which is the point here.
    const change = await request(realApp)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({
        currentPassword: "NotTheRightOne1!",
        newPassword: "Replacement1!",
        confirmPassword: "Replacement1!",
      });
    expect(change.status).toBe(401);
    expect(change.body.code).toBeUndefined();

    expect((await request(realApp).post("/api/auth/logout").set("Cookie", cookie)).status).toBe(
      204,
    );
  });

  it("API-11 (AC-14): a role that does not own the route is refused", async () => {
    // The staff and admin namespaces arrive in Issues #43 and #45; the guard
    // itself is covered by the probe router above. This is the mirror case -
    // IT Staff refused a Requester route.
    const staff = await cookieFor("staff");

    const response = await request(realApp).get("/api/tickets").set("Cookie", staff);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "You do not have permission to perform this action",
    });
  });

  it("API-12 (AC-17, BR-18): a Ticket, its Attachment and its download all answer 404", async () => {
    const { ticketId, attachmentId } = await ticketWithAttachment("requester");
    const intruder = await cookieFor("second");

    try {
      const [ticket, metadata, download, remove, nonexistent] = await Promise.all([
        request(realApp).get(`/api/tickets/${ticketId}`).set("Cookie", intruder),
        request(realApp).get(`/api/attachments/${attachmentId}`).set("Cookie", intruder),
        request(realApp).get(`/api/attachments/${attachmentId}/download`).set("Cookie", intruder),
        request(realApp)
          .delete(`/api/attachments/${attachmentId}`)
          .set("Cookie", intruder)
          .send({ reason: "not mine to remove" }),
        request(realApp).get("/api/attachments/999999999").set("Cookie", intruder),
      ]);

      expect([ticket.status, metadata.status, download.status, remove.status]).toEqual([
        404, 404, 404, 404,
      ]);
      // Byte-identical to a nonexistent id: a different body would say "this
      // one exists, you just cannot have it".
      expect(JSON.stringify(metadata.body)).toBe(JSON.stringify(nonexistent.body));
    } finally {
      await prisma.attachment.deleteMany({ where: { ticketId } });
      await prisma.ticket.deleteMany({ where: { id: ticketId } });
    }
  });

  it("API-10 (AC-03, AC-16, BR-03): a supplied requesterId changes nothing", async () => {
    // Both Requesters own something, and something different: with either list
    // empty this test passes whatever the server does with the parameter.
    const mine = await ticketWithAttachment("requester");
    const theirs = await ticketWithAttachment("second");
    const owner = await cookieFor("requester");
    const other = await prisma.user.findUniqueOrThrow({
      where: { email: email("second") },
    });

    try {
      const spoofed = await request(realApp)
        .get(`/api/tickets?requesterId=${other.id}`)
        .set("Cookie", owner);
      const honest = await request(realApp).get("/api/tickets").set("Cookie", owner);

      expect(spoofed.status).toBe(200);
      expect(spoofed.body).toEqual(honest.body);

      // The assertions that make the comparison mean something: the owner's
      // list is not empty, and it is not the other Requester's list.
      const numbers = (body: { data: { id: number }[] }) => body.data.map((row) => row.id);
      expect(numbers(spoofed.body)).toContain(mine.ticketId);
      expect(numbers(spoofed.body)).not.toContain(theirs.ticketId);
    } finally {
      for (const { ticketId } of [mine, theirs]) {
        await prisma.attachment.deleteMany({ where: { ticketId } });
        await prisma.ticket.deleteMany({ where: { id: ticketId } });
      }
    }
  });

  it("API-13 (AC-10, BR-12): deactivation ends access on the next request", async () => {
    const cookie = await cookieFor("second");
    expect((await request(realApp).get("/api/tickets").set("Cookie", cookie)).status).toBe(200);

    try {
      await prisma.user.update({
        where: { email: email("second") },
        data: { isActive: false },
      });

      expect((await request(realApp).get("/api/tickets").set("Cookie", cookie)).status).toBe(401);
    } finally {
      // Restored whatever happened above: leaving this account deactivated
      // would fail every test after it for an unrelated reason.
      await prisma.user.update({
        where: { email: email("second") },
        data: { isActive: true },
      });
    }
  });

  it("API-14 (AC-15, BR-40): a migrated Requester still reaches their Lab 2 data", async () => {
    // db:migration-check proves the migration itself, on a throwaway database.
    // This proves the other half: that the API still serves what survived it,
    // for an account the migration carried over rather than the seed created.
    const migrated = await prisma.user.findUniqueOrThrow({
      where: { email: "peter.parker@toktickit.test" },
    });
    const existing = await prisma.ticket.findFirst({
      where: { requesterId: migrated.id },
      include: { attachments: { where: { isRemoved: false } } },
      orderBy: { id: "asc" },
    });
    expect(
      existing,
      "peter.parker@toktickit.test must own a Ticket — run npm run db:seed",
    ).not.toBeNull();

    // The seeded password from the README, not the fixture one: this account
    // comes from the seed and the migration, not from this file.
    const cookie = await signInAs(realApp, migrated.email, "ChangeMe123!");

    const detail = await request(realApp)
      .get(`/api/tickets/${existing!.id}`)
      .set("Cookie", cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.ticketNumber).toBe(existing!.ticketNumber);

    const listed = await request(realApp).get("/api/tickets").set("Cookie", cookie);
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((row: { id: number }) => row.id)).toContain(existing!.id);

    // And an Attachment on it is still downloadable, if it has one.
    if (existing!.attachments.length > 0) {
      const download = await request(realApp)
        .get(`/api/attachments/${existing!.attachments[0].id}/download`)
        .set("Cookie", cookie);
      expect(download.status).toBe(200);
    }
  });
});

// Part of API-44 (AC-44, BR-17). The rest of the surface is covered as each
// Issue converts its endpoints; this is the case that was live and leaking.
describe("API-44 unexpected failures stay safe", () => {
  it("answers a database failure with JSON, not a stack trace", async () => {
    const failing = createPrismaClient();
    vi.spyOn(failing.session, "findUnique").mockRejectedValue(
      new Error("connection terminated unexpectedly"),
    );
    const noisy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(createApp(failing))
      .get("/api/auth/me")
      .set("Cookie", `${SESSION_COOKIE}=anything`);

    noisy.mockRestore();
    await failing.$disconnect();

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "Something went wrong. Please try again.",
    });

    // Express's own handler renders the stack and absolute file paths as HTML
    // whenever NODE_ENV is not production, which is every developer machine and
    // every CI run. The assertions below are what that looked like before
    // createApp got an error handler of its own.
    const body = String(response.text);
    expect(body).not.toContain("connection terminated");
    expect(body).not.toContain("<!DOCTYPE html>");
    expect(body).not.toMatch(/\bat .+:\d+:\d+/); // a stack frame
    expect(body).not.toContain("/Users/");
    expect(body).not.toContain("node_modules");
  });
});

describe("API-44 a bad request is not a server fault", () => {
  it("answers malformed JSON with 400, not 500", async () => {
    // express.json() throws a SyntaxError carrying status 400. An error handler
    // that flattens everything to 500 turns a stray brace into what looks like
    // an outage.
    const response = await request(realApp)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{bad");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "The request could not be read" });
    // Still safe: no parser internals, no position, no stack.
    expect(String(response.text)).not.toMatch(/JSON|position|SyntaxError/i);
  });

  it("answers an oversized body with 413", async () => {
    const response = await request(realApp)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ email: "a@b.test", password: "x".repeat(200_000) }));

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: "Request body is too large" });
  });
});

describe("requireRole (§5.1)", () => {
  it("admits every listed role and refuses the rest with 403, not 404", async () => {
    for (const who of ["staff", "admin"]) {
      const allowed = await request(probe)
        .get("/probe/staff")
        .set("Cookie", await cookieFor(who));
      expect(allowed.status).toBe(200);
    }

    const refused = await request(probe)
      .get("/probe/staff")
      .set("Cookie", await cookieFor("requester"));
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({
      error: "You do not have permission to perform this action",
    });

    // 403 and not 404 on purpose: the caller is known, and what is being
    // withheld is permission, not the existence of the route. Ownership is the
    // opposite case and answers 404 (BR-18), per route.
    expect(refused.status).not.toBe(404);
  });

  it("narrows to one role where the matrix says so", async () => {
    expect(
      (await request(probe).get("/probe/admin").set("Cookie", await cookieFor("admin")))
        .status,
    ).toBe(200);
    expect(
      (await request(probe).get("/probe/admin").set("Cookie", await cookieFor("staff")))
        .status,
    ).toBe(403);
  });

  it("answers 401 before 403 when there is no session at all", async () => {
    // Order matters: an anonymous caller must not be told that the route needs
    // a particular role, only that it needs a session.
    const response = await request(probe).get("/probe/admin");

    expect(response.status).toBe(401);
  });
});
