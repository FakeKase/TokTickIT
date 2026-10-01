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
import { requireSessionCookie } from "../helpers/session.js";

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

// Part of API-44 (AC-44, BR-17). The rest of the surface is covered as each
// Issue converts its endpoints; this is the case that was live and leaking.
// API-09 to API-15: the rules that only became testable once the Lab 2
// endpoints moved onto the session (Issue #41).
describe("the converted Lab 2 endpoints", () => {
  const REQUESTER_ROUTES = [
    { method: "get" as const, path: "/api/tickets" },
    { method: "post" as const, path: "/api/tickets" },
  ];

  it("API-09 (AC-02, BR-14): a gated user reaches none of them", async () => {
    const cookie = await cookieFor("gated");

    for (const route of REQUESTER_ROUTES) {
      const response = await request(realApp)[route.method](route.path).set("Cookie", cookie);

      expect(response.status, `${route.method} ${route.path}`).toBe(403);
      expect(response.body.code).toBe("PASSWORD_CHANGE_REQUIRED");
    }

    // ...while the three a gated user needs stay open.
    expect((await request(realApp).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
  });

  it("API-11 (AC-14): a Requester is refused the staff and admin namespaces", async () => {
    // Those endpoints arrive in Issues #43 and #45. What is assertable now is
    // that the role guard itself refuses, which the probe router covers above;
    // this case guards the opposite direction - staff refused a Requester route.
    const staff = await cookieFor("staff");

    const response = await request(realApp).get("/api/tickets").set("Cookie", staff);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "You do not have permission to perform this action",
    });
  });

  it("API-12 (AC-17, BR-18): another Requester's Ticket is indistinguishable from none", async () => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: email("requester") },
    });
    const category = await prisma.category.findFirstOrThrow();
    const relatedSystem = await prisma.relatedSystem.findFirstOrThrow();

    const created = await request(realApp)
      .post("/api/tickets")
      .set("Cookie", await cookieFor("requester"))
      .send({
        categoryId: category.id,
        relatedSystemId: relatedSystem.id,
        requestedPriority: "LOW",
        summary: `Owned by ${owner.name} ${TAG}`,
        description: "Created so a second Requester can fail to read it.",
      });
    expect(created.status).toBe(201);

    const intruder = await cookieFor("second");
    const theirs = await request(realApp)
      .get(`/api/tickets/${created.body.id}`)
      .set("Cookie", intruder);
    const nonexistent = await request(realApp)
      .get("/api/tickets/999999999")
      .set("Cookie", intruder);

    expect(theirs.status).toBe(404);
    // Byte-identical: a different body would say "this one exists".
    expect(JSON.stringify(theirs.body)).toBe(JSON.stringify(nonexistent.body));

    await prisma.ticket.delete({ where: { id: created.body.id } });
  });

  it("API-10 (AC-03, AC-16, BR-03): a supplied requesterId changes nothing", async () => {
    const owner = await cookieFor("requester");
    const other = await prisma.user.findUniqueOrThrow({
      where: { email: email("second") },
    });

    const listed = await request(realApp)
      .get(`/api/tickets?requesterId=${other.id}`)
      .set("Cookie", owner);
    const honest = await request(realApp).get("/api/tickets").set("Cookie", owner);

    expect(listed.status).toBe(200);
    expect(listed.body).toEqual(honest.body);
  });

  it("API-13 (AC-10, BR-12): deactivation ends access on the next request", async () => {
    const cookie = await cookieFor("second");
    expect((await request(realApp).get("/api/tickets").set("Cookie", cookie)).status).toBe(200);

    await prisma.user.update({
      where: { email: email("second") },
      data: { isActive: false },
    });

    expect((await request(realApp).get("/api/tickets").set("Cookie", cookie)).status).toBe(401);

    await prisma.user.update({
      where: { email: email("second") },
      data: { isActive: true },
    });
  });
});

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
