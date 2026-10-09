import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";
import { GATE_FOLLOW_UP, GATE_NO_ACTION } from "../../src/lib/status-transitions.js";
import { TICKET_STATUSES, type TicketStatusValue } from "../../src/lib/ticket-query.js";
import { fixtureUser } from "../helpers/users.js";
import { signInAs } from "../helpers/session.js";

// API-18 to API-29 (Lab 4 AC-18 to AC-27; BR-12 to BR-19).
//
// Every rule here is asserted against the endpoint, with the screen nowhere
// in sight, and "nothing was written" is read back from the row.

const prisma = createPrismaClient();
const app = createApp();

const TAG = "ticket-workflow.api.test";
const email = (who: string) => `${who}.${TAG}@toktickit.test`;
const HOUR = 60 * 60_000;
const NO_OWNER = "A Ticket needs a Ticket Owner before it can be Resolved";

let requesterId: number;
let staffId: number;
let colleagueId: number;
let ticketId: number;

let requesterCookie: string;
let staffCookie: string;
let colleagueCookie: string;
let adminCookie: string;

/** Written out by hand from specification.md §5.2. */
const PERMITTED: Record<TicketStatusValue, TicketStatusValue[]> = {
  NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"],
  CANCELLED: [],
};

const row = () => prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });

interface SeedAction {
  /** Hours before now that the work was done. */
  hoursAgo: number;
  followUp?: boolean;
}

/** Writes an Action Taken straight to the table: the gate reads rows, and
 *  how they got there is another file's business. */
const addAction = ({ hoursAgo, followUp = false }: SeedAction) =>
  prisma.actionTaken.create({
    data: {
      ticketId,
      performedById: staffId,
      requestKey: randomUUID(),
      actionAt: new Date(Date.now() - hoursAgo * HOUR),
      description: "Fixture work",
      result: "Fixture result",
      followUpRequired: followUp,
      followUpNote: followUp ? "Come back to this." : null,
    },
  });

/** Puts the fixture Ticket into a known state: In Progress, owned, with the
 *  given Actions Taken (one, asking for nothing, unless said otherwise). */
async function reset(
  state: { currentStatus?: TicketStatusValue; ownerId?: number | null; itPriority?: string } = {},
  actions: SeedAction[] = [{ hoursAgo: 2 }],
) {
  await prisma.actionTaken.deleteMany({ where: { ticketId } });
  await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      currentStatus: "IN_PROGRESS",
      ownerId: staffId,
      itPriority: "LOW",
      requesterResolvedAt: null,
      resolvedAt: null,
      ...state,
    } as never,
  });
  for (const action of actions) await addAction(action);
  return row();
}

type What = "owner" | "it-priority" | "status";

/** One workflow change. Sends the Ticket's current version unless the body
 *  names one, which is what a screen that had just loaded it would do. */
const patch = async (what: What, body: Record<string, unknown>, cookie = staffCookie) =>
  request(app)
    .patch(`/api/staff/tickets/${ticketId}/${what}`)
    .set("Cookie", cookie)
    .send("expectedVersion" in body ? body : { ...body, expectedVersion: (await row()).version });

const moveTo = (currentStatus: TicketStatusValue, cookie = staffCookie) =>
  patch("status", { currentStatus }, cookie);

const detail = (cookie = staffCookie) =>
  request(app).get(`/api/staff/tickets/${ticketId}`).set("Cookie", cookie);

async function removeFixtures() {
  const mine = { email: { contains: TAG } };
  await prisma.actionTaken.deleteMany({ where: { ticket: { requester: mine } } });
  await prisma.ticketComment.deleteMany({ where: { ticket: { requester: mine } } });
  await prisma.ticket.deleteMany({ where: { requester: mine } });
  await prisma.user.deleteMany({ where: mine });
}

beforeAll(async () => {
  await removeFixtures();

  const make = (who: string, role: "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR" = "REQUESTER") =>
    prisma.user.create({ data: fixtureUser({ name: `${who} ${TAG}`, email: email(who), role }) });
  const [requester, staff, colleague, admin] = await Promise.all([
    make("requester"),
    make("staff", "IT_STAFF"),
    make("colleague", "IT_STAFF"),
    make("admin", "ADMINISTRATOR"),
  ]);
  requesterId = requester.id;
  staffId = staff.id;
  colleagueId = colleague.id;

  [requesterCookie, staffCookie, colleagueCookie, adminCookie] = await Promise.all(
    [requester, staff, colleague, admin].map((user) => signInAs(app, user.email)),
  );

  const category = await prisma.category.findFirstOrThrow();
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow();
  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-95${String(Date.now() % 10000).padStart(4, "0")}`,
      requesterId,
      ownerId: staffId,
      categoryId: category.id,
      relatedSystemId: relatedSystem.id,
      summary: `Workflow fixture ${TAG}`,
      description: "A Ticket that exists to be moved through its statuses.",
      requestedPriority: "MEDIUM",
      itPriority: "LOW",
      currentStatus: "IN_PROGRESS",
      createdAt: new Date(Date.now() - 72 * HOUR),
    },
  });
  ticketId = ticket.id;
});

beforeEach(async () => {
  await reset();
});

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

describe("API-18 the whole matrix through the route (BR-12, AC-18)", () => {
  const pairs = TICKET_STATUSES.flatMap((from) =>
    TICKET_STATUSES.filter((to) => to !== from).map((to) => [from, to] as const),
  );

  it("covers all 56 ordered pairs of different statuses, 18 of them permitted", () => {
    expect(pairs).toHaveLength(56);
    expect(pairs.filter(([from, to]) => PERMITTED[from].includes(to))).toHaveLength(18);
  });

  it.each(pairs)("%s to %s", async (from, to) => {
    // An owner and a met gate, so the matrix is the only thing deciding.
    const before = await reset({ currentStatus: from });

    const response = await moveTo(to);
    const after = await row();

    if (PERMITTED[from].includes(to)) {
      expect(response.status).toBe(200);
      expect(response.body.currentStatus).toBe(to);
      expect(after.currentStatus).toBe(to);
      expect(after.version).toBe(before.version + 1);
    } else {
      expect(response.status).toBe(409);
      expect(response.body.code).toBeUndefined();
      expect(after.currentStatus).toBe(from);
      expect(after.version).toBe(before.version);
      expect(after.updatedAt).toEqual(before.updatedAt);
    }
  });

  it("refuses a move to the status the Ticket already has", async () => {
    for (const status of TICKET_STATUSES) {
      const before = await reset({ currentStatus: status });

      const response = await moveTo(status);

      expect([status, response.status]).toEqual([status, 409]);
      expect((await row()).version).toBe(before.version);
    }
  });

  it("holds for an Administrator exactly as for IT Staff", async () => {
    await reset({ currentStatus: "IN_PROGRESS" });
    expect((await moveTo("CLOSED", adminCookie)).status).toBe(409);
    expect((await moveTo("RESOLVED", adminCookie)).status).toBe(200);
  });
});

describe("API-19 the gate: no Action Taken (BR-13, AC-19)", () => {
  it.each(["IN_PROGRESS", "WAITING_FOR_REQUESTER"] as const)(
    "refuses to resolve an owned %s Ticket with no work recorded",
    async (from) => {
      const before = await reset({ currentStatus: from }, []);

      const response = await moveTo("RESOLVED");

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: GATE_NO_ACTION, code: "RESOLUTION_GATE" });
      const after = await row();
      expect(after.currentStatus).toBe(from);
      expect(after.version).toBe(before.version);
      expect(after.resolvedAt).toBeNull();
    },
  );

  it("does not stop any other move from that Ticket", async () => {
    await reset({ currentStatus: "IN_PROGRESS" }, []);
    expect((await moveTo("WAITING_FOR_REQUESTER")).status).toBe(200);
    expect((await moveTo("CANCELLED")).status).toBe(200);
  });
});

describe("API-20 the gate: follow-up on the latest Action Taken (BR-13, AC-20)", () => {
  it("refuses while the latest requires follow-up, even though an earlier one does not", async () => {
    await reset({}, [{ hoursAgo: 10 }, { hoursAgo: 2, followUp: true }]);

    const response = await moveTo("RESOLVED");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: GATE_FOLLOW_UP, code: "RESOLUTION_GATE" });
    expect((await row()).currentStatus).toBe("IN_PROGRESS");
  });

  it("allows it once a later Action Taken with no follow-up is recorded", async () => {
    await reset({}, [{ hoursAgo: 10, followUp: true }]);
    expect((await moveTo("RESOLVED")).status).toBe(409);

    // Recorded through the API, as a person would close a follow-up.
    const recorded = await request(app)
      .post(`/api/tickets/${ticketId}/actions`)
      .set("Cookie", colleagueCookie)
      .send({
        requestKey: randomUUID(),
        actionAt: new Date(Date.now() - HOUR).toISOString(),
        description: "Followed up as asked.",
        result: "Nothing further needed.",
        followUpRequired: false,
      });
    expect(recorded.status).toBe(201);

    expect((await moveTo("RESOLVED")).status).toBe(200);
  });

  it("does not ask about follow-up on an earlier Action Taken", async () => {
    await reset({}, [{ hoursAgo: 10, followUp: true }, { hoursAgo: 2 }]);

    expect((await moveTo("RESOLVED")).status).toBe(200);
  });

  it("takes 'latest' from when the work was done, not from when it was entered", async () => {
    // Entered first, but dated later: this is the latest.
    await reset({}, [{ hoursAgo: 1, followUp: true }, { hoursAgo: 20 }]);
    expect((await moveTo("RESOLVED")).body.code).toBe("RESOLUTION_GATE");

    // And the other way round: entered last, dated earlier, so it is not.
    await reset({}, [{ hoursAgo: 1 }, { hoursAgo: 20, followUp: true }]);
    expect((await moveTo("RESOLVED")).status).toBe(200);
  });

  it("breaks a tie on the time by the later id", async () => {
    const at = new Date(Date.now() - 3 * HOUR);
    const write = (followUp: boolean) =>
      prisma.actionTaken.create({
        data: {
          ticketId,
          performedById: staffId,
          requestKey: randomUUID(),
          actionAt: at,
          description: "Same minute",
          result: "r",
          followUpRequired: followUp,
          followUpNote: followUp ? "More to do." : null,
        },
      });
    await reset({}, []);
    await write(false);
    await write(true);

    expect((await moveTo("RESOLVED")).body).toEqual({ error: GATE_FOLLOW_UP, code: "RESOLUTION_GATE" });
  });
});

describe("API-21 resolving, closing and reopening (BR-18, BR-19, AC-21)", () => {
  it("records when the Ticket was resolved, keeps it on closing, and clears it on reopening", async () => {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { requesterResolvedAt: new Date("2026-10-01T00:00:00.000Z") },
    });
    const before = Date.now();

    const resolved = await moveTo("RESOLVED");
    expect(resolved.status).toBe(200);
    const resolvedAt = new Date(resolved.body.resolvedAt).getTime();
    expect(resolvedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(resolvedAt).toBeLessThanOrEqual(Date.now() + 1000);
    // Resolving agrees with the Requester, so their signal stays as it was.
    expect((await row()).requesterResolvedAt).not.toBeNull();

    const closed = await moveTo("CLOSED");
    expect(closed.status).toBe(200);
    expect(closed.body.resolvedAt).toBe(resolved.body.resolvedAt);

    const reopened = await moveTo("REOPENED");
    expect(reopened.status).toBe(200);
    expect(reopened.body.resolvedAt).toBeNull();
    const after = await row();
    expect(after.resolvedAt).toBeNull();
    expect(after.requesterResolvedAt).toBeNull();
  });

  it("leaves resolvedAt empty on every move that is not into Resolved", async () => {
    for (const to of ["WAITING_FOR_REQUESTER", "IN_PROGRESS", "CANCELLED"] as const) {
      expect((await moveTo(to)).body.resolvedAt).toBeNull();
    }
  });

  it("stamps a new time when a reopened Ticket is resolved again", async () => {
    const first = (await moveTo("RESOLVED")).body.resolvedAt;
    await moveTo("REOPENED");
    await moveTo("IN_PROGRESS");
    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = (await moveTo("RESOLVED")).body.resolvedAt;

    expect(new Date(second).getTime()).toBeGreaterThan(new Date(first).getTime());
  });
});

describe("API-22 the order of refusal (BR-13, AC-22)", () => {
  it("names the missing owner before the missing work", async () => {
    await reset({ ownerId: null }, []);

    const response = await moveTo("RESOLVED");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: NO_OWNER, code: "RESOLUTION_GATE" });
  });

  it("names the missing work before the follow-up, which cannot exist without it", async () => {
    await reset({}, []);
    expect((await moveTo("RESOLVED")).body.error).toBe(GATE_NO_ACTION);
  });

  it("reports a move outside the matrix before anything about the gate", async () => {
    await reset({ currentStatus: "NEW", ownerId: null }, []);

    const response = await moveTo("RESOLVED");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Cannot move a Ticket from New to Resolved" });
  });

  it("reports a stale version before all of them", async () => {
    const before = await reset({ currentStatus: "NEW", ownerId: null }, []);

    const response = await patch("status", { currentStatus: "RESOLVED", expectedVersion: before.version + 5 });

    expect(response.body.code).toBe("STALE_TICKET");
  });
});

describe("API-23 Tickets resolved before Lab 4 (BR-14, AC-23)", () => {
  it("can be Closed with no Action Taken, and must pass the gate after a reopen", async () => {
    // As the migration leaves one: Resolved, owned, no recorded work.
    await reset({ currentStatus: "RESOLVED" }, []);

    expect((await moveTo("CLOSED")).status).toBe(200);
    expect((await moveTo("REOPENED")).status).toBe(200);
    expect((await moveTo("IN_PROGRESS")).status).toBe(200);

    const refused = await moveTo("RESOLVED");
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("RESOLUTION_GATE");

    await addAction({ hoursAgo: 1 });
    expect((await moveTo("RESOLVED")).status).toBe(200);
  });

  it("still needs an owner to be Closed, in the Lab 3 words", async () => {
    await reset({ currentStatus: "RESOLVED", ownerId: null }, []);

    const response = await moveTo("CLOSED");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "A Ticket needs a Ticket Owner before it can be Closed" });
  });
});

describe("API-24 the Requester and the gate (BR-15, AC-24)", () => {
  it("refuses a Requester's status request with 403, on their own Ticket", async () => {
    const before = await row();

    const response = await moveTo("RESOLVED", requesterCookie);

    expect(response.status).toBe(403);
    const after = await row();
    expect(after.currentStatus).toBe("IN_PROGRESS");
    expect(after.version).toBe(before.version);
  });

  it("leaves the status alone when they say it appears resolved, and that does not open the gate", async () => {
    const before = await reset({}, []);

    const signalled = await request(app)
      .post(`/api/tickets/${ticketId}/requester-resolved`)
      .set("Cookie", requesterCookie);
    expect(signalled.status).toBe(200);

    const after = await row();
    expect(after.requesterResolvedAt).not.toBeNull();
    expect(after.currentStatus).toBe("IN_PROGRESS");
    expect(after.resolvedAt).toBeNull();
    // Advisory in every sense: not a workflow change either.
    expect(after.version).toBe(before.version);

    const response = await moveTo("RESOLVED");
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: GATE_NO_ACTION, code: "RESOLUTION_GATE" });
  });
});

describe("API-25 a stale or missing version (BR-16, AC-25)", () => {
  const changes: [What, Record<string, unknown>][] = [
    ["status", { currentStatus: "WAITING_FOR_REQUESTER" }],
    ["owner", { ownerId: null }],
    ["it-priority", { itPriority: "URGENT" }],
  ];

  it.each(changes)("%s: refuses a version that is no longer current, and writes nothing", async (what, body) => {
    const before = await row();
    // Somebody else changes the Ticket; this request still names the old one.
    expect((await patch("it-priority", { itPriority: "HIGH" }, colleagueCookie)).status).toBe(200);
    const moved = await row();

    const response = await patch(what, { ...body, expectedVersion: before.version });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "This Ticket was changed by someone else. Reload it and try again.",
      code: "STALE_TICKET",
    });
    const after = await row();
    expect(after.version).toBe(moved.version);
    expect(after.currentStatus).toBe("IN_PROGRESS");
    expect(after.ownerId).toBe(staffId);
    expect(after.itPriority).toBe("HIGH");
    expect(after.updatedAt).toEqual(moved.updatedAt);
  });

  it("refuses a stale version even when the change would have been a no-op", async () => {
    const before = await row();
    await patch("it-priority", { itPriority: "HIGH" }, colleagueCookie);

    // Naming the owner it already has, and the priority it now has.
    const owner = await patch("owner", { ownerId: staffId, expectedVersion: before.version });
    const priority = await patch("it-priority", { itPriority: "HIGH", expectedVersion: before.version });

    expect(owner.body.code).toBe("STALE_TICKET");
    expect(priority.body.code).toBe("STALE_TICKET");
  });

  it("refuses a version from the future as well as one from the past", async () => {
    const before = await row();

    const response = await patch("status", { currentStatus: "CANCELLED", expectedVersion: before.version + 1 });

    expect(response.body.code).toBe("STALE_TICKET");
    expect((await row()).currentStatus).toBe("IN_PROGRESS");
  });

  it.each(changes)("%s: rejects a missing or malformed version with 400", async (what, body) => {
    const before = await row();

    for (const expectedVersion of [undefined, null, "1", 0, -1, 1.5]) {
      const response = await request(app)
        .patch(`/api/staff/tickets/${ticketId}/${what}`)
        .set("Cookie", staffCookie)
        .send({ ...body, expectedVersion });

      expect([expectedVersion, response.status]).toEqual([expectedVersion, 400]);
      expect(Object.keys(response.body.fields)).toEqual(["expectedVersion"]);
    }
    expect((await row()).version).toBe(before.version);
  });

  it("reports the route's own field and the version together when both are wrong", async () => {
    const response = await request(app)
      .patch(`/api/staff/tickets/${ticketId}/status`)
      .set("Cookie", staffCookie)
      .send({ currentStatus: "DONE" });

    expect(response.status).toBe(400);
    expect(Object.keys(response.body.fields).sort()).toEqual(["currentStatus", "expectedVersion"]);
  });

  it("answers 404 for a Ticket that does not exist, version or no version", async () => {
    const response = await request(app)
      .patch("/api/staff/tickets/2000000000/status")
      .set("Cookie", staffCookie)
      .send({ currentStatus: "OPEN", expectedVersion: 1 });

    expect(response.status).toBe(404);
  });
});

describe("API-26 two changes at the same moment (BR-16, AC-26)", () => {
  it("lets exactly one of two different changes from the same version through, 20 times", async () => {
    for (let run = 0; run < 20; run++) {
      const before = await reset();

      const [mine, theirs] = await Promise.all([
        patch("it-priority", { itPriority: "URGENT", expectedVersion: before.version }),
        patch("status", { currentStatus: "WAITING_FOR_REQUESTER", expectedVersion: before.version }, colleagueCookie),
      ]);

      expect([run, [mine.status, theirs.status].sort()]).toEqual([run, [200, 409]]);
      const loser = mine.status === 409 ? mine : theirs;
      expect(loser.body.code).toBe("STALE_TICKET");

      const after = await row();
      expect(after.version).toBe(before.version + 1);
      // The winner's change is there and the loser's is not.
      expect([after.itPriority, after.currentStatus]).toEqual(
        mine.status === 200 ? ["URGENT", "IN_PROGRESS"] : ["LOW", "WAITING_FOR_REQUESTER"],
      );
    }
  });

  it("lets one of two simultaneous claims win", async () => {
    const before = await reset({ ownerId: null });

    const [mine, theirs] = await Promise.all([
      patch("owner", { ownerId: staffId, expectedVersion: before.version }),
      patch("owner", { ownerId: colleagueId, expectedVersion: before.version }, colleagueCookie),
    ]);

    expect([mine.status, theirs.status].sort()).toEqual([200, 409]);
    expect((await row()).ownerId).toBe(mine.status === 200 ? staffId : colleagueId);
  });
});

describe("API-27 what the Ticket says it may do next (FR-08, AC-27)", () => {
  it("carries its version and when it was resolved", async () => {
    const before = await row();

    const response = await detail();

    expect(response.body.version).toBe(before.version);
    expect(response.body.resolvedAt).toBeNull();
  });

  it("lists exactly the matrix row for its status", async () => {
    for (const from of TICKET_STATUSES) {
      await reset({ currentStatus: from });

      const moves = (await detail()).body.transitions.map((move: { to: string }) => move.to);

      expect([from, moves]).toEqual([from, PERMITTED[from]]);
    }
  });

  it.each([
    ["no owner", { ownerId: null }, [{ hoursAgo: 2 }], NO_OWNER],
    ["no Action Taken", {}, [], GATE_NO_ACTION],
    ["follow-up on the latest", {}, [{ hoursAgo: 2, followUp: true }], GATE_FOLLOW_UP],
  ] as const)("blocks Resolved with the sentence the route then refuses with: %s", async (_what, state, actions, sentence) => {
    await reset(state, [...actions]);

    const offered = (await detail()).body.transitions as { to: string; blockedReason: string | null }[];
    const refused = await moveTo("RESOLVED");

    expect(offered.find((move) => move.to === "RESOLVED")?.blockedReason).toBe(sentence);
    expect(refused.body.error).toBe(sentence);
    // Nothing else on offer is blocked by it.
    expect(offered.filter((move) => move.to !== "RESOLVED").every((move) => move.blockedReason === null)).toBe(true);
  });

  it("stops blocking as soon as the gate is met, and the route then accepts", async () => {
    await reset({}, []);
    expect((await detail()).body.transitions.find((move: { to: string }) => move.to === "RESOLVED").blockedReason).toBe(
      GATE_NO_ACTION,
    );

    await addAction({ hoursAgo: 1 });

    expect(
      (await detail()).body.transitions.find((move: { to: string }) => move.to === "RESOLVED").blockedReason,
    ).toBeNull();
    expect((await moveTo("RESOLVED")).status).toBe(200);
  });

  it("returns the same shape from every workflow change", async () => {
    const response = await patch("it-priority", { itPriority: "HIGH" });

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(Object.keys((await detail()).body).sort());
    expect(response.body.transitions[0]).toHaveProperty("blockedReason");
  });
});

describe("API-28 what moves the version, and what does not (BR-16)", () => {
  it("rises by one for a real change of owner or priority", async () => {
    const start = (await row()).version;

    expect((await patch("owner", { ownerId: colleagueId })).body.version).toBe(start + 1);
    expect((await patch("it-priority", { itPriority: "URGENT" })).body.version).toBe(start + 2);
    expect((await row()).version).toBe(start + 2);
  });

  it("does not rise, and Last Updated does not move, for a change that changes nothing", async () => {
    const before = await row();

    const owner = await patch("owner", { ownerId: staffId });
    const priority = await patch("it-priority", { itPriority: "LOW" });

    expect([owner.status, priority.status]).toEqual([200, 200]);
    const after = await row();
    expect(after.version).toBe(before.version);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("does not rise when an Action Taken is recorded or edited", async () => {
    const before = await row();

    const recorded = await request(app)
      .post(`/api/tickets/${ticketId}/actions`)
      .set("Cookie", staffCookie)
      .send({
        requestKey: randomUUID(),
        actionAt: new Date(Date.now() - HOUR).toISOString(),
        description: "More work.",
        result: "Done.",
        followUpRequired: false,
      });
    expect(recorded.status).toBe(201);

    const after = await row();
    expect(after.version).toBe(before.version);
    // So a change based on the copy from before the action is still current.
    expect((await patch("it-priority", { itPriority: "HIGH", expectedVersion: before.version })).status).toBe(200);
  });

  it("rises on every Ticket handed back when its owner is deactivated", async () => {
    const leaver = await prisma.user.create({
      data: fixtureUser({ name: `leaver ${TAG}`, email: email(`leaver-${Date.now()}`), role: "IT_STAFF" }),
    });
    const before = await reset({ ownerId: leaver.id });

    const deactivated = await request(app)
      .patch(`/api/users/${leaver.id}`)
      .set("Cookie", adminCookie)
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);

    const after = await row();
    expect(after.ownerId).toBeNull();
    expect(after.version).toBe(before.version + 1);
    // Somebody who still had it open as owned by the leaver is told so.
    const stale = await patch("status", { currentStatus: "RESOLVED", expectedVersion: before.version });
    expect(stale.body.code).toBe("STALE_TICKET");
  });
});

describe("API-28 an owner change racing the deactivation of that owner", () => {
  it("never answers either request with a 500, in 40 runs", async () => {
    // The owner route locks the Ticket and then reads the User. Deactivation
    // locks the User and then unassigns their Tickets. Taken in opposite
    // orders those two deadlock, Postgres kills one, and that route answers
    // 500. The case that reaches it is an owner request naming the user who
    // already owns the Ticket, while that user is being deactivated.
    const owner = await prisma.user.create({
      data: fixtureUser({ name: `racer ${TAG}`, email: email(`racer-${Date.now()}`), role: "IT_STAFF" }),
    });
    const outcomes = new Set<string>();

    for (let run = 0; run < 40; run++) {
      await prisma.user.update({ where: { id: owner.id }, data: { isActive: true } });
      const before = await reset({ ownerId: owner.id });

      const [assign, deactivate] = await Promise.all([
        patch("owner", { ownerId: owner.id, expectedVersion: before.version }, colleagueCookie),
        request(app).patch(`/api/users/${owner.id}`).set("Cookie", adminCookie).send({ isActive: false }),
      ]);

      expect([run, assign.status]).not.toEqual([run, 500]);
      expect([run, deactivate.status]).toEqual([run, 200]);
      outcomes.add(`${assign.status}`);

      // Whichever came first, the rule holds afterwards: a deactivated user
      // owns no live Ticket (Lab 3 BR-19).
      expect((await row()).ownerId).toBeNull();
    }

    // The owner request is refused one of two ways, and never accepted in a
    // way that leaves the Ticket with its deactivated owner.
    for (const status of outcomes) expect(["200", "409"]).toContain(status);
  }, 60_000);
});

describe("API-29 resolving while a colleague records a follow-up (BR-13, AC-20)", () => {
  it("never leaves a Resolved Ticket whose latest Action Taken asks for follow-up, in 20 runs", async () => {
    const outcomes = new Set<string>();

    for (let run = 0; run < 20; run++) {
      const before = await reset();

      const [resolve, record] = await Promise.all([
        patch("status", { currentStatus: "RESOLVED", expectedVersion: before.version }),
        request(app)
          .post(`/api/tickets/${ticketId}/actions`)
          .set("Cookie", colleagueCookie)
          .send({
            requestKey: randomUUID(),
            actionAt: new Date().toISOString(),
            description: "Found something else while checking.",
            result: "Needs another visit.",
            followUpRequired: true,
            followUpNote: "Return with the replacement part.",
          }),
      ]);

      const after = await row();
      const latest = await prisma.actionTaken.findFirst({
        where: { ticketId },
        orderBy: [{ actionAt: "desc" }, { id: "desc" }],
      });

      if (resolve.status === 200) {
        // The resolve was first, so the Ticket was finished when the action
        // arrived and the action was refused.
        expect(record.status).toBe(409);
        expect(record.body.code).toBe("TICKET_NOT_ACTIVE");
        expect(after.currentStatus).toBe("RESOLVED");
        expect(latest?.followUpRequired).toBe(false);
        outcomes.add("resolved first");
      } else {
        // The action was first, so the gate saw it.
        expect(record.status).toBe(201);
        expect(resolve.status).toBe(409);
        expect(resolve.body).toEqual({ error: GATE_FOLLOW_UP, code: "RESOLUTION_GATE" });
        expect(after.currentStatus).toBe("IN_PROGRESS");
        outcomes.add("recorded first");
      }
      // Whichever way it went, this is the state that must never exist.
      expect(after.currentStatus === "RESOLVED" && latest?.followUpRequired === true).toBe(false);
    }

    expect(outcomes.size).toBeGreaterThan(0);
  });
});
