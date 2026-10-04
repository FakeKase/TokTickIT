import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";

/**
 * The README's account table, checked against the running API.
 *
 * Every other test in this folder signs in with a fixture hash, which proves
 * the endpoint works but says nothing about whether the credentials a person
 * reads in the README do. Those are three separate artefacts - the seed, the
 * migration, and the README - and the first time anybody notices they have
 * drifted is when a demo will not log in.
 *
 * The password is written out here rather than imported from the seed on
 * purpose: importing it would make the test agree with the seed by
 * construction, and the thing under test is that the seed agrees with the
 * documentation.
 */
const DOCUMENTED_PASSWORD = "ChangeMe123!";

const prisma = createPrismaClient();
const app = createApp();

const login = (email: string, password = DOCUMENTED_PASSWORD) =>
  request(app).post("/api/auth/login").send({ email, password });

afterAll(async () => {
  await prisma.session.deleteMany({
    where: { user: { email: { endsWith: "@toktickit.test" } }, expiresAt: { gt: new Date() } },
  });
  await prisma.$disconnect();
});

describe("seeded credentials match the README", () => {
  it.each([
    ["alex.morgan@toktickit.test", "ADMINISTRATOR"],
    ["sarah.chen@toktickit.test", "IT_STAFF"],
    ["peter.parker@toktickit.test", "REQUESTER"],
  ])("%s signs in with the documented password as %s", async (email, role) => {
    const response = await login(email);

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe(role);
    // Onboarded in the README's table, so the gate must not fire. This is the
    // assertion that caught the migrated-vs-fresh divergence in Issue #38:
    // peter.parker is a row the migration flagged and the seed un-flagged.
    expect(response.body.user.mustChangePassword).toBe(false);
  });

  it.each([
    ["nora.bennett@toktickit.test"],
    ["daniel.okafor@toktickit.test"],
  ])("%s signs in but must change the password first", async (email) => {
    const response = await login(email);

    expect(response.status).toBe(200);
    expect(response.body.user.mustChangePassword).toBe(true);
  });

  it("the inactive seeded account cannot sign in at all (BR-01)", async () => {
    const response = await login("david.kim@toktickit.test");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid email or password" });
  });

  it("the documented password is the only one that works", async () => {
    const wrong = await login("alex.morgan@toktickit.test", "ChangeMe123");

    expect(wrong.status).toBe(401);
  });
});
