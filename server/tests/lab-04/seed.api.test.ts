import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { createPrismaClient } from "../../src/prisma.js";

/**
 * MIG-02 (Lab 4 FR-19, AC-47): the seed is safe to run again, and it holds
 * what the contract says it holds.
 *
 * Run against a database of its own, built here from the migrations. On the
 * development database "the counts did not change" would be a claim about
 * whatever else happened to be in it; on an empty one it is a claim about the
 * seed. It also means the seed is exercised on a fresh database on every test
 * run, which is the case a new checkout meets first.
 */
const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const url = new URL(process.env.DATABASE_URL!);
const NAME = `${url.pathname.replace(/^\//, "")}_seed_check`;
url.pathname = `/${NAME}`;

const admin = createPrismaClient();
let db: PrismaClient;

const run = (command: string, args: string[]) =>
  execFileSync(command, args, {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: ["ignore", "ignore", "inherit"],
  });

const seed = () => run("npx", ["tsx", "prisma/seed.ts"]);

/** Row count of every table the seed can write to. */
async function counts() {
  const [users, sessions, categories, systems, tickets, comments, attachments, actions] =
    await Promise.all([
      db.user.count(),
      db.session.count(),
      db.category.count(),
      db.relatedSystem.count(),
      db.ticket.count(),
      db.ticketComment.count(),
      db.attachment.count(),
      db.actionTaken.count(),
    ]);
  return { users, sessions, categories, systems, tickets, comments, attachments, actions };
}

beforeAll(async () => {
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${NAME}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${NAME}"`);
  run("npx", ["prisma", "migrate", "deploy"]);
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
  seed();
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${NAME}" WITH (FORCE)`);
  await admin.$disconnect();
});

describe("the seed on a fresh database", () => {
  it("writes the same rows when it is run a second time", async () => {
    const first = await counts();
    const actionsBefore = await db.actionTaken.findMany({ orderBy: { id: "asc" } });
    const ticketsBefore = await db.ticket.findMany({
      orderBy: { id: "asc" },
      select: { id: true, createdAt: true, resolvedAt: true, version: true, currentStatus: true },
    });

    seed();

    expect(await counts()).toEqual(first);
    // Not only the same number of rows: the same rows. A seed that deleted
    // and rewrote its actions would pass a count and still churn every id.
    expect(await db.actionTaken.findMany({ orderBy: { id: "asc" } })).toEqual(actionsBefore);
    expect(
      await db.ticket.findMany({
        orderBy: { id: "asc" },
        select: { id: true, createdAt: true, resolvedAt: true, version: true, currentStatus: true },
      }),
    ).toEqual(ticketsBefore);
  }, 60_000);

  it("has Tickets with zero, one and several Actions Taken, as specification.md 7.3 lists them", async () => {
    const tickets = await db.ticket.findMany({
      where: { ticketNumber: { startsWith: "TKT-2026-80000" } },
      orderBy: { ticketNumber: "asc" },
      select: { ticketNumber: true, currentStatus: true, _count: { select: { actionsTaken: true } } },
    });

    expect(
      tickets.map((t) => [t.ticketNumber.slice(-1), t.currentStatus, t._count.actionsTaken]),
    ).toEqual([
      ["1", "NEW", 0],
      ["2", "IN_PROGRESS", 3],
      ["3", "WAITING_FOR_REQUESTER", 1],
      ["4", "RESOLVED", 2],
      ["5", "CLOSED", 1],
      ["6", "OPEN", 0],
      ["7", "CANCELLED", 0],
      ["8", "REOPENED", 0],
    ]);
  });

  it("shows work by two different people on one Ticket, with the latest needing follow-up", async () => {
    const actions = await db.actionTaken.findMany({
      where: { ticket: { ticketNumber: "TKT-2026-800002" } },
      // The order the application lists them in (BR-10).
      orderBy: [{ actionAt: "desc" }, { id: "desc" }],
      select: { followUpRequired: true, followUpNote: true, performedBy: { select: { email: true } } },
    });

    expect(new Set(actions.map((a) => a.performedBy.email)).size).toBe(2);
    expect(actions[0].followUpRequired).toBe(true);
    expect(actions[0].followUpNote).toBeTruthy();
    expect(actions.slice(1).every((a) => !a.followUpRequired && a.followUpNote === null)).toBe(true);
  });

  it("dates every Action Taken after its Ticket was created and before now", async () => {
    // BR-05, which the API enforces and the seed must not contradict.
    const actions = await db.actionTaken.findMany({
      select: { actionAt: true, createdAt: true, ticket: { select: { createdAt: true } } },
    });

    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.actionAt.getTime()).toBeGreaterThanOrEqual(action.ticket.createdAt.getTime());
      expect(action.actionAt.getTime()).toBeLessThan(Date.now());
      expect(action.createdAt.getTime()).toBeGreaterThanOrEqual(action.actionAt.getTime());
    }
  });

  it("moves a seeded Ticket that is too young back, once, instead of dating work in the future", async () => {
    // A database first seeded under Lab 3 moments before this migration: the
    // Ticket exists, was created just now, and has no Actions Taken yet.
    const ticket = await db.ticket.findUniqueOrThrow({ where: { ticketNumber: "TKT-2026-800002" } });
    await db.actionTaken.deleteMany({ where: { ticketId: ticket.id } });
    await db.ticket.update({ where: { id: ticket.id }, data: { createdAt: new Date() } });

    seed();

    const moved = await db.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: { createdAt: true, actionsTaken: { select: { actionAt: true } } },
    });
    expect(moved.actionsTaken).toHaveLength(3);
    for (const action of moved.actionsTaken) {
      expect(action.actionAt.getTime()).toBeGreaterThanOrEqual(moved.createdAt.getTime());
      expect(action.actionAt.getTime()).toBeLessThan(Date.now());
    }

    // Old enough now, so the next run leaves the creation time where it is.
    seed();
    const again = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id }, select: { createdAt: true } });
    expect(again.createdAt).toEqual(moved.createdAt);
  }, 60_000);

  it("records a resolution time for the Resolved and Closed Tickets only, inside the last 7 days", async () => {
    const tickets = await db.ticket.findMany({
      select: { currentStatus: true, resolvedAt: true, createdAt: true, version: true },
    });
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const ticket of tickets) {
      expect(ticket.version).toBe(1);
      if (ticket.currentStatus === "RESOLVED" || ticket.currentStatus === "CLOSED") {
        expect(ticket.resolvedAt).not.toBeNull();
        expect(ticket.resolvedAt!.getTime()).toBeGreaterThan(ticket.createdAt.getTime());
        expect(ticket.resolvedAt!.getTime()).toBeGreaterThan(weekAgo);
        expect(ticket.resolvedAt!.getTime()).toBeLessThan(Date.now());
      } else {
        expect(ticket.resolvedAt).toBeNull();
      }
    }
  });

  it("leaves one Requester with no Tickets and one active staff user with no work, for the zero metrics", async () => {
    const grace = await db.user.findUniqueOrThrow({
      where: { email: "grace.lim@toktickit.test" },
      select: { isActive: true, role: true, _count: { select: { ticketsRequested: true } } },
    });
    expect(grace).toMatchObject({ isActive: true, role: "REQUESTER", _count: { ticketsRequested: 0 } });

    const aiko = await db.user.findUniqueOrThrow({
      where: { email: "aiko.tanaka@toktickit.test" },
      select: {
        isActive: true,
        role: true,
        _count: { select: { ticketsOwned: true, actionsPerformed: true } },
      },
    });
    expect(aiko).toMatchObject({
      isActive: true,
      role: "IT_STAFF",
      _count: { ticketsOwned: 0, actionsPerformed: 0 },
    });
  });
});
