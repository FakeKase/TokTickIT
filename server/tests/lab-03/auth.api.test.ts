import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";
import { SESSION_COOKIE, hashToken } from "../../src/lib/session.js";
import { FIXTURE_PASSWORD, fixtureUser } from "../helpers/users.js";
import {
  requireSessionCookie,
  sessionCookie,
  setCookieHeader,
  tokenFrom,
} from "../helpers/session.js";

// API-01 to API-07 (AC-01, AC-05 to AC-09, AC-11, AC-12). The security rules
// live here rather than in a UI test: a screen that hides a message proves
// nothing about what the endpoint answers.

const prisma = createPrismaClient();
const app = createApp();

const TAG = "auth.api.test";
const email = (who: string) => `${who}.${TAG}@toktickit.test`;

const login = (who: string, password = FIXTURE_PASSWORD) =>
  request(app).post("/api/auth/login").send({ email: email(who), password });

beforeAll(async () => {
  const stale = { email: { contains: TAG } };
  await prisma.session.deleteMany({ where: { user: stale } });
  await prisma.user.deleteMany({ where: stale });

  await prisma.user.createMany({
    data: [
      fixtureUser({ name: `Active ${TAG}`, email: email("active") }),
      fixtureUser({
        name: `Inactive ${TAG}`,
        email: email("inactive"),
        isActive: false,
      }),
      fixtureUser({
        name: `Gated ${TAG}`,
        email: email("gated"),
        mustChangePassword: true,
      }),
      fixtureUser({ name: `Changer ${TAG}`, email: email("changer") }),
      fixtureUser({ name: `Expiry ${TAG}`, email: email("expiry") }),
      fixtureUser({ name: `Logout ${TAG}`, email: email("logout") }),
      fixtureUser({ name: `Multi ${TAG}`, email: email("multi") }),
      fixtureUser({ name: `Deactivated ${TAG}`, email: email("deactivated") }),
    ],
  });
});

afterAll(async () => {
  const stale = { email: { contains: TAG } };
  await prisma.session.deleteMany({ where: { user: stale } });
  await prisma.user.deleteMany({ where: stale });
  await prisma.$disconnect();
});

describe("API-01 POST /api/auth/login — valid credentials (AC-01)", () => {
  it("returns the identity, sets an httpOnly cookie, and stores only a hash", async () => {
    const response = await login("active");

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      email: email("active"),
      role: "REQUESTER",
      isActive: true,
      mustChangePassword: false,
    });

    // BR-07: no endpoint returns a hash, including the one that just checked it.
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
    expect(response.body.user.passwordHash).toBeUndefined();

    // Asserted on the whole header: the flags are the security-relevant part,
    // and they live in the attributes the cookie value alone does not carry.
    const header = setCookieHeader(response)!;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");

    const cookie = requireSessionCookie(response);

    // The value in the cookie must not be the value in the table (BR-09).
    const token = tokenFrom(cookie);
    expect(
      await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } }),
    ).not.toBeNull();
    expect(
      await prisma.session.findUnique({ where: { tokenHash: token } }),
    ).toBeNull();
  });

  it("matches the email case-insensitively and ignores surrounding space (BR-06)", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: `  ${email("active").toUpperCase()}  `, password: FIXTURE_PASSWORD });

    expect(response.status).toBe(200);
  });

  it("rejects a missing email or password with field-level errors", async () => {
    const response = await request(app).post("/api/auth/login").send({});

    expect(response.status).toBe(400);
    expect(Object.keys(response.body.fields).sort()).toEqual([
      "email",
      "password",
    ]);
    expect(sessionCookie(response)).toBeUndefined();
  });
});

describe("API-02/API-03 login failures are indistinguishable (AC-05, AC-06, BR-08)", () => {
  it("answers a wrong password, an unknown email, and an inactive account identically", async () => {
    const wrongPassword = await login("active", "WrongPassword1!");
    const unknownEmail = await request(app)
      .post("/api/auth/login")
      .send({ email: email("nobody"), password: FIXTURE_PASSWORD });
    const inactive = await login("inactive"); // correct password, disabled account

    for (const response of [wrongPassword, unknownEmail, inactive]) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Invalid email or password" });
      expect(sessionCookie(response)).toBeUndefined();
    }

    // Byte-identical, not merely similar: a difference anywhere in the body is
    // an oracle for which of the three happened.
    expect(JSON.stringify(wrongPassword.body)).toBe(
      JSON.stringify(unknownEmail.body),
    );
    expect(JSON.stringify(inactive.body)).toBe(
      JSON.stringify(unknownEmail.body),
    );

    const inactiveUser = await prisma.user.findUniqueOrThrow({
      where: { email: email("inactive") },
    });
    expect(
      await prisma.session.count({ where: { userId: inactiveUser.id } }),
    ).toBe(0);
  });
});

describe("API-04 POST /api/auth/logout (AC-08, BR-10)", () => {
  it("deletes the session row and makes the cookie unusable", async () => {
    const signedIn = await login("logout");
    const cookie = requireSessionCookie(signedIn);
    const token = tokenFrom(cookie);

    expect(
      await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } }),
    ).not.toBeNull();

    const loggedOut = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie);
    expect(loggedOut.status).toBe(204);

    expect(
      await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } }),
    ).toBeNull();

    const reused = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(reused.status).toBe(401);
  });

  it("destroys the token even when the account has since been deactivated", async () => {
    const cookie = requireSessionCookie(await login("deactivated"));
    const token = tokenFrom(cookie);
    await prisma.user.update({
      where: { email: email("deactivated") },
      data: { isActive: false },
    });

    expect((await request(app).post("/api/auth/logout").set("Cookie", cookie)).status).toBe(204);

    // Without this the row would survive, and reactivating the account inside
    // the 8-hour window would hand the old token back its access.
    expect(
      await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } }),
    ).toBeNull();
  });

  it("is idempotent, with no cookie and with a stale one", async () => {
    expect((await request(app).post("/api/auth/logout")).status).toBe(204);
    expect(
      (
        await request(app)
          .post("/api/auth/logout")
          .set("Cookie", `${SESSION_COOKIE}=never-existed`)
      ).status,
    ).toBe(204);
  });
});

describe("API-05 expired sessions (AC-09, BR-11)", () => {
  it("treats an expired session as unauthenticated and clears the row", async () => {
    const cookie = requireSessionCookie(await login("expiry"));
    const token = tokenFrom(cookie);
    const hash = hashToken(token);

    await prisma.session.update({
      where: { tokenHash: hash },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const response = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
    expect(await prisma.session.findUnique({ where: { tokenHash: hash } })).toBeNull();
  });
});

describe("GET /api/auth/me (BR-14)", () => {
  it("returns the identity for a live session and 401 without one", async () => {
    const cookie = requireSessionCookie(await login("active"));

    const authenticated = await request(app)
      .get("/api/auth/me")
      .set("Cookie", cookie);
    expect(authenticated.status).toBe(200);
    expect(authenticated.body.user.email).toBe(email("active"));

    expect((await request(app).get("/api/auth/me")).status).toBe(401);
  });

  it("answers a user who still holds an initial password (BR-14)", async () => {
    const cookie = requireSessionCookie(await login("gated"));

    const response = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.body.user.mustChangePassword).toBe(true);
  });
});

describe("API-06 change-password validation (AC-11, BR-13)", () => {
  it("rejects a short, mismatched, or reused password without clearing the flag", async () => {
    const cookie = requireSessionCookie(await login("gated"));
    const change = (body: Record<string, string>) =>
      request(app)
        .post("/api/auth/change-password")
        .set("Cookie", cookie)
        .send(body);

    const short = await change({
      currentPassword: FIXTURE_PASSWORD,
      newPassword: "Ab1!",
      confirmPassword: "Ab1!",
    });
    expect(short.status).toBe(400);
    expect(short.body.fields.newPassword).toBeTruthy();

    const mismatch = await change({
      currentPassword: FIXTURE_PASSWORD,
      newPassword: "Replacement1!",
      confirmPassword: "Replacement2!",
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.fields.confirmPassword).toBeTruthy();

    const reused = await change({
      currentPassword: FIXTURE_PASSWORD,
      newPassword: FIXTURE_PASSWORD,
      confirmPassword: FIXTURE_PASSWORD,
    });
    expect(reused.status).toBe(400);
    expect(reused.body.fields.newPassword).toBeTruthy();

    const wrongCurrent = await change({
      currentPassword: "NotMyPassword1!",
      newPassword: "Replacement1!",
      confirmPassword: "Replacement1!",
    });
    expect(wrongCurrent.status).toBe(401);
    expect(wrongCurrent.body.fields.currentPassword).toBeTruthy();

    // The gate has to survive every one of those (BR-02).
    const still = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(still.body.user.mustChangePassword).toBe(true);
    expect(
      (await login("gated")).status,
    ).toBe(200); // the old password still works
  });

  it("requires a session", async () => {
    const response = await request(app)
      .post("/api/auth/change-password")
      .send({
        currentPassword: FIXTURE_PASSWORD,
        newPassword: "Replacement1!",
        confirmPassword: "Replacement1!",
      });

    expect(response.status).toBe(401);
  });
});

describe("API-07 change-password success (AC-12)", () => {
  it("clears the flag, replaces the password, and rotates the session", async () => {
    const signedIn = await login("changer");
    const oldCookie = requireSessionCookie(signedIn);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: email("changer") },
    });
    const oldHash = user.passwordHash;

    const response = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", oldCookie)
      .send({
        currentPassword: FIXTURE_PASSWORD,
        newPassword: "Replacement1!",
        confirmPassword: "Replacement1!",
      });

    expect(response.status).toBe(200);
    expect(response.body.user.mustChangePassword).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");

    // A new cookie is issued, and the one used to make the call is dead: a
    // token captured before the change must not outlive it.
    const newCookie = requireSessionCookie(response);
    expect(newCookie).not.toBe(oldCookie);
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", oldCookie)).status,
    ).toBe(401);
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", newCookie)).status,
    ).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.passwordHash).not.toBe(oldHash);
    expect(after.mustChangePassword).toBe(false);

    expect((await login("changer")).status).toBe(401); // old password
    expect((await login("changer", "Replacement1!")).status).toBe(200);
  });

  it("kills every other session the user holds, not just the calling one (BR-41)", async () => {
    // Two independent sign-ins: a laptop and a phone, or the user and whoever
    // they are changing their password because of.
    const laptop = requireSessionCookie(await login("multi"));
    const phone = requireSessionCookie(await login("multi"));
    expect(laptop).not.toBe(phone);
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", phone)).status,
    ).toBe(200);

    const response = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", laptop)
      .send({
        currentPassword: FIXTURE_PASSWORD,
        newPassword: "Replacement1!",
        confirmPassword: "Replacement1!",
      });
    expect(response.status).toBe(200);

    // The session that was never involved has to be gone: that is the whole
    // point of the rule, and the reason a password change is worth doing at all
    // when you suspect somebody else has it.
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", phone)).status,
    ).toBe(401);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: email("multi") },
    });
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });
});
