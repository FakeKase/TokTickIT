import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/prisma.js";
import { fixtureUser } from "../helpers/users.js";

/**
 * REG-05: the end-to-end teardown still works once Tickets can hold Actions
 * Taken.
 *
 * An Action Taken restricts the deletion of its Ticket and of the user who
 * performed or edited it. The teardown deletes both, so without the changes
 * made for Lab 4 it would throw on the first run that recorded an action,
 * and, being non-fatal by design, would leave every fixture behind without
 * failing anything. This runs the real script against real rows.
 */
const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// The two strings the teardown searches for, written out rather than imported:
// the point is that rows shaped the way the e2e suite shapes them are found.
const MARKER = "TokTickIT walkthrough";
const E2E_DOMAIN = "@e2e.toktickit.test";

const prisma = createPrismaClient();
const RUN = `cleanup-${Date.now()}`;

let keptTicketId: number;
let markedTicketId: number;
let keptActionId: number;
let stayingStaffId: number;
let output = "";

beforeAll(async () => {
  const [requester, staying, leaving] = await Promise.all([
    prisma.user.create({ data: fixtureUser({ name: "Cleanup Requester", email: `${RUN}.requester@toktickit.test` }) }),
    prisma.user.create({
      data: fixtureUser({ name: "Cleanup Staff", email: `${RUN}.staff@toktickit.test`, role: "IT_STAFF" }),
    }),
    // A user the e2e suite would have created through User Management.
    prisma.user.create({
      data: fixtureUser({ name: "Cleanup E2E Staff", email: `${RUN}${E2E_DOMAIN}`, role: "IT_STAFF" }),
    }),
  ]);
  stayingStaffId = staying.id;

  const category = await prisma.category.findFirstOrThrow();
  const system = await prisma.relatedSystem.findFirstOrThrow();
  const ticket = (n: number, description: string) =>
    prisma.ticket.create({
      data: {
        ticketNumber: `TKT-2026-97${String(Date.now() % 1000).padStart(3, "0")}${n}`,
        requesterId: requester.id,
        categoryId: category.id,
        relatedSystemId: system.id,
        summary: "Cleanup contract fixture",
        description,
        requestedPriority: "LOW",
        itPriority: "LOW",
      },
    });
  // One Ticket the suite made, one it did not.
  const marked = await ticket(1, `Created during the ${MARKER}.`);
  const kept = await ticket(2, "Created by hand, with no marker.");
  markedTicketId = marked.id;
  keptTicketId = kept.id;

  const action = (ticketId: number, performedById: number, key: string) =>
    prisma.actionTaken.create({
      data: {
        ticketId,
        performedById,
        requestKey: `${RUN}:${key}`,
        actionAt: new Date(),
        description: "Fixture work",
        result: "Fixture result",
      },
    });
  await action(marked.id, staying.id, "on-marked");
  // On the kept Ticket: one by the user who is leaving, and one by the user
  // who is staying that the leaving user then edited.
  await action(kept.id, leaving.id, "by-leaver");
  const edited = await action(kept.id, staying.id, "edited-by-leaver");
  keptActionId = edited.id;
  await prisma.actionTaken.update({
    where: { id: edited.id },
    data: { editedById: leaving.id, editedAt: new Date(), version: 2 },
  });

  output = execFileSync("npx", ["tsx", "src/scripts/e2e-cleanup.ts"], {
    cwd: SERVER_DIR,
    encoding: "utf8",
    // stderr too: the script reports its own failure there and still exits 0.
    stdio: ["ignore", "pipe", "pipe"],
  });
}, 60_000);

afterAll(async () => {
  const mine = { email: { startsWith: RUN } };
  await prisma.actionTaken.deleteMany({ where: { requestKey: { startsWith: RUN } } });
  await prisma.ticket.deleteMany({ where: { requester: mine } });
  await prisma.user.deleteMany({ where: mine });
  await prisma.$disconnect();
});

describe("e2e cleanup with Actions Taken present", () => {
  it("finishes, and says how many Actions Taken it removed", () => {
    expect(output).toMatch(/e2e cleanup: removed \d+ tickets, .*\d+ actions taken/);
    expect(output).not.toMatch(/failed/);
  });

  it("removes a marked Ticket together with the Actions Taken under it", async () => {
    expect(await prisma.ticket.findUnique({ where: { id: markedTicketId } })).toBeNull();
    expect(await prisma.actionTaken.count({ where: { ticketId: markedTicketId } })).toBe(0);
  });

  it("removes a user the suite created, and the work they recorded", async () => {
    expect(await prisma.user.count({ where: { email: `${RUN}${E2E_DOMAIN}` } })).toBe(0);
    expect(await prisma.actionTaken.count({ where: { requestKey: `${RUN}:by-leaver` } })).toBe(0);
  });

  it("keeps an unmarked Ticket, and an action a remaining user performed, without its edit mark", async () => {
    expect(await prisma.ticket.findUnique({ where: { id: keptTicketId } })).not.toBeNull();

    const action = await prisma.actionTaken.findUniqueOrThrow({ where: { id: keptActionId } });
    expect(action.performedById).toBe(stayingStaffId);
    // Both halves cleared together, never one without the other.
    expect(action.editedById).toBeNull();
    expect(action.editedAt).toBeNull();
  });
});
