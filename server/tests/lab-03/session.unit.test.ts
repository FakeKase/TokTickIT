import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/prisma.js";
import {
  SESSION_TTL_MS,
  createSession,
  hashToken,
  resolveSession,
} from "../../src/lib/session.js";
import { fixtureUser } from "../helpers/users.js";

// UNIT-02 (BR-09, BR-10, BR-11, BR-12). Runs against the real database: the
// interesting cases are all about what a row looks like and what resolveSession
// does with it, neither of which a mock can prove.

const prisma = createPrismaClient();
const TAG = "session.unit.test";

let userId: number;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
  const user = await prisma.user.create({
    data: fixtureUser({
      name: `Session ${TAG}`,
      email: `session.${TAG}@toktickit.test`,
    }),
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
  await prisma.$disconnect();
});

describe("UNIT-02 session tokens", () => {
  it("stores only the hash, and the hash is not the token", async () => {
    const token = await createSession(prisma, userId);

    const stored = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashToken(token) },
    });
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toHaveLength(64); // sha256, hex

    // The token itself must be unfindable in the table (BR-09): a database
    // dump has to be useless as a set of cookies.
    expect(
      await prisma.session.findUnique({ where: { tokenHash: token } }),
    ).toBeNull();

    await prisma.session.delete({ where: { id: stored.id } });
  });

  it("never repeats a token", async () => {
    const tokens = await Promise.all(
      Array.from({ length: 50 }, () => createSession(prisma, userId)),
    );

    expect(new Set(tokens).size).toBe(50);
    await prisma.session.deleteMany({ where: { userId } });
  });

  it("expires 8 hours out, with no sliding renewal", async () => {
    const token = await createSession(prisma, userId);
    const stored = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashToken(token) },
    });

    const expected = Date.now() + SESSION_TTL_MS;
    expect(Math.abs(stored.expiresAt.getTime() - expected)).toBeLessThan(5_000);

    // Resolving it does not push the expiry out (BR-09).
    await resolveSession(prisma, token);
    const after = await prisma.session.findUniqueOrThrow({
      where: { id: stored.id },
    });
    expect(after.expiresAt.getTime()).toBe(stored.expiresAt.getTime());

    await prisma.session.delete({ where: { id: stored.id } });
  });

  it("treats an expired row as no session, and deletes it on the way past (BR-11)", async () => {
    const token = await createSession(prisma, userId);
    const hash = hashToken(token);
    await prisma.session.update({
      where: { tokenHash: hash },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    expect(await resolveSession(prisma, token)).toBeNull();
    expect(
      await prisma.session.findUnique({ where: { tokenHash: hash } }),
    ).toBeNull();
  });

  it("rejects a live session whose user has since been deactivated (BR-12)", async () => {
    const token = await createSession(prisma, userId);
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    expect(await resolveSession(prisma, token)).toBeNull();

    // The row survives, unlike the expired case: deactivation is reversible,
    // and reactivating a user should not have logged them out retroactively.
    expect(
      await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } }),
    ).not.toBeNull();

    await prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
    });
    expect(await resolveSession(prisma, token)).not.toBeNull();
    await prisma.session.deleteMany({ where: { userId } });
  });

  it("resolves nothing for a missing or unknown token", async () => {
    expect(await resolveSession(prisma, undefined)).toBeNull();
    expect(await resolveSession(prisma, "not-a-real-token")).toBeNull();
  });
});
