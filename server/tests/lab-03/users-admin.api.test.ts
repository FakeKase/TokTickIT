import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/prisma.js";
import { FIXTURE_HASH, FIXTURE_PASSWORD, fixtureUser } from "../helpers/users.js";
import { signInAs } from "../helpers/session.js";

// API-35 to API-43 (FR-20..FR-25, BR-06, BR-32..BR-38; AC-14, AC-35..AC-41).

const prisma = createPrismaClient();
const app = createApp();

const TAG = "usersadmin-api-test";
const email = (who: string) => `${who}.${TAG}@toktickit.test`;
const INITIAL = "Initial123!";

let adminId: number;
let adminCookie: string;
let staffCookie: string;
let requesterCookie: string;

const cleanup = async () => {
  const stale = { email: { contains: TAG } };
  await prisma.ticketComment.deleteMany({ where: { ticket: { requester: stale } } });
  await prisma.ticket.deleteMany({ where: { requester: stale } });
  await prisma.ticket.updateMany({ where: { owner: stale }, data: { ownerId: null } });
  await prisma.session.deleteMany({ where: { user: stale } });
  await prisma.user.deleteMany({ where: stale });
};

/** A fresh fixture user, so no test depends on what another left behind. */
let counter = 0;
const makeUser = (
  role: "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR" = "REQUESTER",
  overrides: { isActive?: boolean; name?: string } = {},
) => {
  counter += 1;
  return prisma.user.create({
    data: fixtureUser({
      name: overrides.name ?? `Subject ${counter} ${TAG}`,
      email: email(`subject${counter}`),
      role,
      isActive: overrides.isActive,
    }),
  });
};

beforeAll(async () => {
  await cleanup();

  const [admin, staff, requester] = await Promise.all([
    prisma.user.create({
      data: fixtureUser({ name: `Admin ${TAG}`, email: email("admin"), role: "ADMINISTRATOR" }),
    }),
    prisma.user.create({
      data: fixtureUser({ name: `Staff ${TAG}`, email: email("staff"), role: "IT_STAFF" }),
    }),
    prisma.user.create({
      data: fixtureUser({ name: `Requester ${TAG}`, email: email("requester") }),
    }),
  ]);
  adminId = admin.id;

  [adminCookie, staffCookie, requesterCookie] = await Promise.all([
    signInAs(app, admin.email),
    signInAs(app, staff.email),
    signInAs(app, requester.email),
  ]);
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const list = (query: Record<string, string> = {}, cookie = adminCookie) =>
  request(app).get("/api/users").query(query).set("Cookie", cookie);

const create = (body: unknown, cookie = adminCookie) =>
  request(app).post("/api/users").set("Cookie", cookie).send(body as object);

const edit = (id: number | string, body: unknown, cookie = adminCookie, target = app) =>
  request(target).patch(`/api/users/${id}`).set("Cookie", cookie).send(body as object);

const resetPassword = (id: number | string, body: unknown, cookie = adminCookie) =>
  request(app).post(`/api/users/${id}/initial-password`).set("Cookie", cookie).send(body as object);

const login = (address: string, password: string) =>
  request(app).post("/api/auth/login").send({ email: address, password });

const userRow = (id: number) => prisma.user.findUniqueOrThrow({ where: { id } });

const newUser = (overrides: Record<string, unknown> = {}) => {
  counter += 1;
  return {
    name: `Created ${counter} ${TAG}`,
    email: email(`created${counter}`),
    role: "REQUESTER",
    initialPassword: INITIAL,
    ...overrides,
  };
};

describe("who may manage users (AC-14, BR-16)", () => {
  it("refuses a Requester and IT Staff on every endpoint, with 403, no user data, and nothing written", async () => {
    const subject = await makeUser();
    const before = await prisma.user.count();

    for (const cookie of [requesterCookie, staffCookie]) {
      const attempts = [
        await list({}, cookie),
        await create(newUser(), cookie),
        await edit(subject.id, { name: "Changed By Stranger" }, cookie),
        await resetPassword(subject.id, { initialPassword: INITIAL }, cookie),
      ];

      for (const response of attempts) {
        expect(response.status).toBe(403);
        expect(JSON.stringify(response.body)).not.toContain("@toktickit.test");
      }
    }

    expect(await prisma.user.count()).toBe(before);
    const after = await userRow(subject.id);
    expect(after.name).toBe(subject.name);
    expect(after.passwordHash).toBe(FIXTURE_HASH);
  });

  it("refuses an anonymous caller with 401", async () => {
    const responses = [
      await request(app).get("/api/users"),
      await request(app).post("/api/users").send(newUser()),
      await request(app).patch(`/api/users/${adminId}`).send({ name: "Nobody" }),
      await request(app).post(`/api/users/${adminId}/initial-password`).send({ initialPassword: INITIAL }),
    ];

    for (const response of responses) expect(response.status).toBe(401);
  });

  it("API-43: has no way to delete a user (BR-35)", async () => {
    const subject = await makeUser();

    const response = await request(app).delete(`/api/users/${subject.id}`).set("Cookie", adminCookie);

    expect([404, 405]).toContain(response.status);
    expect(await prisma.user.count({ where: { id: subject.id } })).toBe(1);
  });
});

describe("API-35 listing users (AC-35, FR-20)", () => {
  it("returns every user with name, email, role and status, and never a hash", async () => {
    const response = await list();

    expect(response.status).toBe(200);
    expect(response.body.length).toBe(await prisma.user.count());

    const admin = response.body.find((user: { id: number }) => user.id === adminId);
    expect(admin).toEqual({
      id: adminId,
      name: `Admin ${TAG}`,
      email: email("admin"),
      role: "ADMINISTRATOR",
      isActive: true,
      mustChangePassword: false,
      createdAt: expect.any(String),
      isLastActiveAdministrator: false,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it("includes inactive users: deactivated is not deleted", async () => {
    const inactive = await makeUser("IT_STAFF", { isActive: false });

    const response = await list({ search: inactive.email });

    expect(response.body).toHaveLength(1);
    expect(response.body[0].isActive).toBe(false);
  });

  it("orders by name", async () => {
    const response = await list({ search: TAG });
    const names: string[] = response.body.map((user: { name: string }) => user.name);

    // The API sorts in the database, whose collation is not JavaScript's, so
    // compare case-insensitively the way the names are actually shown.
    const sorted = [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    expect(names).toEqual(sorted);
  });
});

describe("API-36 search and role filter (AC-36, BR-38)", () => {
  it("matches part of a name or part of an email, whatever the case", async () => {
    const subject = await makeUser("IT_STAFF", { name: `Zebediah Quill ${TAG}` });

    const byName = await list({ search: "zEbEdIaH qu" });
    expect(byName.body.map((user: { id: number }) => user.id)).toEqual([subject.id]);

    const byEmail = await list({ search: subject.email.slice(0, 12).toUpperCase() + subject.email.slice(12) });
    expect(byEmail.body.map((user: { id: number }) => user.id)).toContain(subject.id);
  });

  it("narrows by role, and combines role with search", async () => {
    const ours = await list({ search: TAG, role: "IT_STAFF" });

    expect(ours.body.length).toBeGreaterThan(0);
    expect(ours.body.every((user: { role: string; email: string }) => user.role === "IT_STAFF" && user.email.includes(TAG))).toBe(true);

    const admins = await list({ role: "ADMINISTRATOR" });
    expect(admins.body.every((user: { role: string }) => user.role === "ADMINISTRATOR")).toBe(true);
    expect(admins.body.some((user: { id: number }) => user.id === adminId)).toBe(true);
  });

  it("returns an empty list for a search that matches nobody", async () => {
    const response = await list({ search: `nobody-at-all-${TAG}` });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("ignores a role it does not know", async () => {
    const response = await list({ search: TAG, role: "SUPERUSER" });
    const unfiltered = await list({ search: TAG });

    expect(response.body.length).toBe(unfiltered.body.length);
  });
});

describe("API-37 creating a user (AC-37, FR-22)", () => {
  it("creates the account, which can sign in once and must then change its password", async () => {
    const body = newUser({ role: "IT_STAFF" });

    const response = await create(body);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(Number),
      name: body.name,
      email: body.email,
      role: "IT_STAFF",
      isActive: true,
      mustChangePassword: true,
      createdAt: expect.any(String),
    });

    const row = await userRow(response.body.id);
    // Stored as a hash of the password, never the password.
    expect(row.passwordHash).not.toContain(INITIAL);
    expect(row.passwordHash).toMatch(/^\$2[aby]\$10\$/);

    const signedIn = await login(body.email, INITIAL);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user.mustChangePassword).toBe(true);

    // Signed in, but held at the gate until the password is their own.
    const cookie = (signedIn.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
    const blocked = await request(app).get("/api/staff/tickets").set("Cookie", cookie);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("requires a password change whatever the body says about it", async () => {
    const response = await create(newUser({ mustChangePassword: false }));

    expect(response.status).toBe(201);
    expect(response.body.mustChangePassword).toBe(true);
    expect((await userRow(response.body.id)).mustChangePassword).toBe(true);
  });

  it("stores the email lower-cased, so the address typed is the address that signs in (BR-06)", async () => {
    const body = newUser();
    const typed = `  ${body.email.toUpperCase()}  `;

    const response = await create({ ...body, email: typed });

    expect(response.status).toBe(201);
    expect(response.body.email).toBe(body.email);
    expect((await userRow(response.body.id)).email).toBe(body.email);
    expect((await login(body.email.toUpperCase(), INITIAL)).status).toBe(200);
  });

  it("can create an account switched off, which then cannot sign in", async () => {
    const body = newUser({ isActive: false });

    const response = await create(body);

    expect(response.status).toBe(201);
    expect(response.body.isActive).toBe(false);
    expect((await login(body.email, INITIAL)).status).toBe(401);
  });

  it("reports every invalid field at once and writes nothing", async () => {
    const before = await prisma.user.count();

    const response = await create({ name: "J", email: "not-an-address", role: "ROOT", isActive: "yes", initialPassword: "short" });

    expect(response.status).toBe(400);
    expect(Object.keys(response.body.fields).sort()).toEqual(["email", "initialPassword", "isActive", "name", "role"]);
    expect(await prisma.user.count()).toBe(before);
  });

  it("holds the initial password to 8 characters and 72 bytes (BR-13)", async () => {
    for (const initialPassword of ["a".repeat(7), "ก".repeat(25), "", undefined]) {
      const response = await create(newUser({ initialPassword }));
      expect([initialPassword, response.status]).toEqual([initialPassword, 400]);
      expect(response.body.fields.initialPassword).toBeTruthy();
    }
    expect((await create(newUser({ initialPassword: "ก".repeat(24) }))).status).toBe(201);
  });

  it("answers 400, not 500, when there is no body", async () => {
    const response = await request(app).post("/api/users").set("Cookie", adminCookie);
    expect(response.status).toBe(400);
  });

  it("never echoes the password back, in a success or a failure", async () => {
    const secret = "Unmistakable-Secret-99";
    const ok = await create(newUser({ initialPassword: secret }));
    const bad = await create(newUser({ initialPassword: secret, name: "" }));

    expect(JSON.stringify(ok.body)).not.toContain(secret);
    expect(JSON.stringify(bad.body)).not.toContain(secret);
  });
});

describe("API-38 duplicate email (AC-38, BR-34)", () => {
  it("refuses a create with an address already held, in any case, and writes nothing", async () => {
    const existing = await makeUser();
    const before = await prisma.user.count();

    for (const address of [existing.email, existing.email.toUpperCase(), ` ${existing.email} `]) {
      const response = await create(newUser({ email: address }));

      expect([address, response.status]).toEqual([address, 409]);
      expect(response.body).toEqual({ error: "That email address is already in use" });
    }
    expect(await prisma.user.count()).toBe(before);
  });

  it("refuses an edit to an address somebody else holds, and changes nothing", async () => {
    const [first, second] = [await makeUser(), await makeUser()];

    const response = await edit(second.id, { email: first.email.toUpperCase(), name: "Should Not Stick" });

    expect(response.status).toBe(409);
    const after = await userRow(second.id);
    expect(after.email).toBe(second.email);
    // The whole edit is refused, not just the one field.
    expect(after.name).toBe(second.name);
  });

  it("lets a user keep their own address in an edit", async () => {
    const subject = await makeUser();

    const response = await edit(subject.id, { email: subject.email.toUpperCase(), name: `Renamed ${TAG}` });

    expect(response.status).toBe(200);
    expect(response.body.email).toBe(subject.email);
  });
});

describe("API-39 editing a user (FR-23)", () => {
  it("changes name, email, role and activation, each on its own", async () => {
    const subject = await makeUser();
    const renamedEmail = email(`renamed${subject.id}`);

    expect((await edit(subject.id, { name: `  Edited ${TAG}  ` })).body.name).toBe(`Edited ${TAG}`);
    expect((await edit(subject.id, { email: renamedEmail.toUpperCase() })).body.email).toBe(renamedEmail);
    expect((await edit(subject.id, { role: "IT_STAFF" })).body.role).toBe("IT_STAFF");
    expect((await edit(subject.id, { isActive: false })).body.isActive).toBe(false);

    expect(await userRow(subject.id)).toMatchObject({
      name: `Edited ${TAG}`,
      email: renamedEmail,
      role: "IT_STAFF",
      isActive: false,
      // An edit is not a password reset.
      passwordHash: FIXTURE_HASH,
      mustChangePassword: false,
    });
  });

  it("returns the user, without a hash", async () => {
    const subject = await makeUser();
    const response = await edit(subject.id, { name: `Shape ${TAG}` });

    expect(Object.keys(response.body).sort()).toEqual(
      ["createdAt", "email", "id", "isActive", "mustChangePassword", "name", "role"],
    );
  });

  it("applies a role change on the user's very next request", async () => {
    const subject = await makeUser("IT_STAFF");
    const cookie = await signInAs(app, subject.email);
    expect((await request(app).get("/api/staff/tickets").set("Cookie", cookie)).status).toBe(200);

    await edit(subject.id, { role: "REQUESTER" });

    // Same session, new role: the queue closes and My Tickets opens.
    expect((await request(app).get("/api/staff/tickets").set("Cookie", cookie)).status).toBe(403);
    expect((await request(app).get("/api/tickets").set("Cookie", cookie)).status).toBe(200);
  });

  it("ends a deactivated user's access at once, and restores it on reactivation (BR-12)", async () => {
    const subject = await makeUser("IT_STAFF");
    const cookie = await signInAs(app, subject.email);

    await edit(subject.id, { isActive: false });

    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
    expect(await prisma.session.count({ where: { userId: subject.id } })).toBe(0);
    expect((await login(subject.email, FIXTURE_PASSWORD)).status).toBe(401);

    await edit(subject.id, { isActive: true });

    expect((await login(subject.email, FIXTURE_PASSWORD)).status).toBe(200);
    // The old session does not come back with the account.
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("leaves another user's sessions alone when the edit is not a deactivation", async () => {
    const subject = await makeUser();
    const cookie = await signInAs(app, subject.email);

    await edit(subject.id, { name: `Still Here ${TAG}` });

    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
  });

  it("answers 400 for an invalid field and changes nothing", async () => {
    const subject = await makeUser();

    for (const body of [{ name: "" }, { name: "J" }, { email: "nope" }, { role: "ROOT" }, { isActive: "false" }]) {
      const response = await edit(subject.id, body);
      expect([body, response.status]).toEqual([body, 400]);
    }
    expect(await userRow(subject.id)).toMatchObject({ name: subject.name, email: subject.email, isActive: true });
  });

  it("accepts an edit that changes nothing", async () => {
    const subject = await makeUser();
    const response = await edit(subject.id, {});

    expect(response.status).toBe(200);
    expect(response.body.name).toBe(subject.name);
  });

  it("cannot be used to set a password or clear the change-password flag", async () => {
    const subject = await prisma.user.create({
      data: fixtureUser({ name: `Gated ${TAG}`, email: email("gated-edit"), mustChangePassword: true }),
    });

    await edit(subject.id, { passwordHash: "x", initialPassword: "Whatever123!", mustChangePassword: false, name: `Gated Still ${TAG}` });

    const after = await userRow(subject.id);
    expect(after.passwordHash).toBe(FIXTURE_HASH);
    expect(after.mustChangePassword).toBe(true);
  });

  it("answers 404 for a user that does not exist, and for an id that is not a number", async () => {
    for (const id of [99999999, "abc", "0", "1.5"]) {
      expect([id, (await edit(id, { name: "Nobody Home" })).status]).toEqual([id, 404]);
    }
  });
});

describe("a user who can no longer own Tickets hands the live ones back (BR-19)", () => {
  const ownedTickets = async (ownerId: number, requesterId: number) => {
    const category = await prisma.category.findFirstOrThrow();
    const relatedSystem = await prisma.relatedSystem.findFirstOrThrow();
    const make = (key: string, currentStatus: string) =>
      prisma.ticket.create({
        data: {
          ticketNumber: `UA-${TAG}-${ownerId}-${key}`,
          requesterId,
          ownerId,
          categoryId: category.id,
          relatedSystemId: relatedSystem.id,
          summary: `Handback fixture ${TAG}`,
          description: "A fixture for the hand-back rule.",
          requestedPriority: "LOW",
          itPriority: "LOW",
          currentStatus,
        } as never,
      });
    return {
      live: await make("live", "IN_PROGRESS"),
      waiting: await make("waiting", "WAITING_FOR_REQUESTER"),
      resolved: await make("resolved", "RESOLVED"),
      closed: await make("closed", "CLOSED"),
    };
  };
  const ownerOf = async (id: number) => (await prisma.ticket.findUniqueOrThrow({ where: { id } })).ownerId;

  it("unassigns their live Tickets on deactivation, and leaves the ones they finished", async () => {
    const requester = await makeUser();
    const staff = await makeUser("IT_STAFF");
    const tickets = await ownedTickets(staff.id, requester.id);

    await edit(staff.id, { isActive: false });

    expect(await ownerOf(tickets.live.id)).toBeNull();
    expect(await ownerOf(tickets.waiting.id)).toBeNull();
    // Resolved and Closed must keep an owner (BR-23), and who finished the
    // work stays on record.
    expect(await ownerOf(tickets.resolved.id)).toBe(staff.id);
    expect(await ownerOf(tickets.closed.id)).toBe(staff.id);
  });

  it("does the same when they are made a Requester", async () => {
    const requester = await makeUser();
    const staff = await makeUser("IT_STAFF");
    const tickets = await ownedTickets(staff.id, requester.id);

    await edit(staff.id, { role: "REQUESTER" });

    expect(await ownerOf(tickets.live.id)).toBeNull();
    expect(await ownerOf(tickets.resolved.id)).toBe(staff.id);
  });

  it("takes nothing away for an edit that leaves them eligible", async () => {
    const requester = await makeUser();
    const staff = await makeUser("IT_STAFF");
    const tickets = await ownedTickets(staff.id, requester.id);

    await edit(staff.id, { name: `Promoted ${TAG}`, role: "ADMINISTRATOR" });

    expect(await ownerOf(tickets.live.id)).toBe(staff.id);
  });

  it("means a deactivated user is refused as an owner afterwards", async () => {
    const requester = await makeUser();
    const staff = await makeUser("IT_STAFF");
    const tickets = await ownedTickets(staff.id, requester.id);
    await edit(staff.id, { isActive: false });

    const response = await request(app)
      .patch(`/api/staff/tickets/${tickets.live.id}/owner`)
      .set("Cookie", staffCookie)
      .send({ ownerId: staff.id });

    expect(response.status).toBe(409);
    expect(await ownerOf(tickets.live.id)).toBeNull();
  });
});

describe("API-40 an Administrator cannot deactivate themselves (AC-39, BR-32)", () => {
  it("refuses with 409 and leaves the account active and signed in", async () => {
    const response = await edit(adminId, { isActive: false });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "You cannot deactivate your own account" });
    expect((await userRow(adminId)).isActive).toBe(true);
    expect((await list()).status).toBe(200);
  });

  it("refuses it even when sent with other, valid changes, and applies none of them", async () => {
    const response = await edit(adminId, { isActive: false, name: `Should Not Stick ${TAG}` });

    expect(response.status).toBe(409);
    expect((await userRow(adminId)).name).toBe(`Admin ${TAG}`);
  });

  it("still lets them edit the rest of their own account", async () => {
    const response = await edit(adminId, { name: `Admin ${TAG}`, isActive: true });
    expect(response.status).toBe(200);
  });

  it("decides who is acting from the session, not from anything in the body", async () => {
    const other = await makeUser("ADMINISTRATOR");

    // Deactivating somebody else is allowed; claiming to be them is not a thing.
    const response = await edit(other.id, { isActive: false, id: adminId, actingUserId: other.id });

    expect(response.status).toBe(200);
    expect((await userRow(other.id)).isActive).toBe(false);
    expect((await userRow(adminId)).isActive).toBe(true);
  });
});

describe("API-41 the last active Administrator (AC-40, BR-33)", () => {
  /**
   * An app that sees only the users named, as though they were the whole
   * system.
   *
   * "Exactly one active Administrator" cannot be arranged for real here: this
   * database is shared with other test files, each with an Administrator of
   * its own, and deactivating theirs would break them. So the two queries the
   * rule reads are narrowed to this test's users. Everything else is the real
   * route against the real database, row locks included.
   */
  function worldOf(ids: number[]) {
    const scoped = createPrismaClient();
    const inWorld = new Set(ids);

    const realTransaction = scoped.$transaction.bind(scoped);
    vi.spyOn(scoped, "$transaction").mockImplementation(((fn: unknown, ...rest: unknown[]) => {
      if (typeof fn !== "function") return (realTransaction as never as (...a: unknown[]) => unknown)(fn, ...rest);
      return (realTransaction as never as (...a: unknown[]) => unknown)(async (tx: object) => {
        // A proxy over the transaction, not a change to it: Prisma reuses the
        // object, and a method replaced on it would outlive this transaction.
        const narrowed = new Proxy(tx, {
          get(target, property) {
            const value = Reflect.get(target, property, target) as unknown;
            if (property !== "$queryRaw") return value;
            return async (...args: unknown[]) =>
              (
                await (value as (...a: unknown[]) => Promise<{ id: number }[]>).apply(target, args)
              ).filter((row) => inWorld.has(row.id));
          },
        });
        return (fn as (t: unknown) => unknown)(narrowed);
      }, ...rest);
    }) as never);

    const realCount = scoped.user.count.bind(scoped.user);
    vi.spyOn(scoped.user, "count").mockImplementation(((args?: { where?: Record<string, unknown> }) =>
      realCount({ ...args, where: { ...args?.where, id: { in: ids } } } as never)) as never);

    return { world: createApp(scoped), done: () => scoped.$disconnect() };
  }

  const twoAdmins = async () => {
    const [first, second] = [await makeUser("ADMINISTRATOR"), await makeUser("ADMINISTRATOR")];
    const [firstCookie, secondCookie] = [await signInAs(app, first.email), await signInAs(app, second.email)];
    return { first, second, firstCookie, secondCookie };
  };

  it("refuses to deactivate or demote the only active Administrator, with 409 and no change", async () => {
    const { first, second, secondCookie } = await twoAdmins();
    // Only `first` counts: `second` is the one acting, and is outside it.
    const { world, done } = worldOf([first.id]);

    for (const body of [{ isActive: false }, { role: "IT_STAFF" }, { role: "REQUESTER" }]) {
      const response = await edit(first.id, body, secondCookie, world);

      expect([body, response.status]).toEqual([body, 409]);
      expect(response.body).toEqual({ error: "The system must keep at least one active Administrator" });
    }
    await done();

    expect(await userRow(first.id)).toMatchObject({ role: "ADMINISTRATOR", isActive: true });
    expect(await userRow(second.id)).toMatchObject({ role: "ADMINISTRATOR", isActive: true });
  });

  it("allows both once a second active Administrator exists", async () => {
    const { first, second, secondCookie } = await twoAdmins();
    const third = await makeUser("ADMINISTRATOR");
    const { world, done } = worldOf([first.id, second.id, third.id]);

    expect((await edit(first.id, { isActive: false }, secondCookie, world)).status).toBe(200);
    expect((await edit(third.id, { role: "IT_STAFF" }, secondCookie, world)).status).toBe(200);
    // And now `second` is the last one standing.
    expect((await edit(second.id, { role: "IT_STAFF" }, secondCookie, world)).status).toBe(409);
    await done();
  });

  it("does not count an inactive Administrator as one of them", async () => {
    const { first, second, secondCookie } = await twoAdmins();
    const retired = await makeUser("ADMINISTRATOR", { isActive: false });
    const { world, done } = worldOf([first.id, retired.id]);

    expect((await edit(first.id, { isActive: false }, secondCookie, world)).status).toBe(409);
    await done();
    expect(second.id).toBeGreaterThan(0);
  });

  it("lets the last Administrator be edited in ways that keep them one", async () => {
    const { first, secondCookie } = await twoAdmins();
    const { world, done } = worldOf([first.id]);

    const response = await edit(first.id, { name: `Still Admin ${TAG}`, role: "ADMINISTRATOR", isActive: true }, secondCookie, world);
    await done();

    expect(response.status).toBe(200);
  });

  it("leaves one Administrator when two demote each other at the same moment", async () => {
    const { first, second, firstCookie, secondCookie } = await twoAdmins();
    const { world, done } = worldOf([first.id, second.id]);

    // Each counts two Administrators if it reads before the other writes. The
    // row locks are what make the second one count again.
    const [a, b] = await Promise.all([
      edit(second.id, { role: "IT_STAFF" }, firstCookie, world),
      edit(first.id, { role: "IT_STAFF" }, secondCookie, world),
    ]);
    await done();

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const roles = [(await userRow(first.id)).role, (await userRow(second.id)).role].sort();
    expect(roles).toEqual(["ADMINISTRATOR", "IT_STAFF"]);
  });

  it("flags the last active Administrator in the list, and nobody when there are two", async () => {
    const { first, second, secondCookie } = await twoAdmins();

    const alone = worldOf([first.id]);
    const one = await request(alone.world).get("/api/users").query({ search: first.email }).set("Cookie", secondCookie);
    await alone.done();
    expect(one.body[0].isLastActiveAdministrator).toBe(true);

    const pair = worldOf([first.id, second.id]);
    const two = await request(pair.world).get("/api/users").query({ search: first.email }).set("Cookie", secondCookie);
    await pair.done();
    expect(two.body[0].isLastActiveAdministrator).toBe(false);
  });

  it("really is counting active Administrators in the database", async () => {
    // The scoped tests above narrow the query's result; this checks the query
    // itself, unnarrowed, against the same count made independently.
    const active = await prisma.user.count({ where: { role: "ADMINISTRATOR", isActive: true } });
    expect(active).toBeGreaterThan(1);

    const response = await list({ role: "ADMINISTRATOR" });
    expect(response.body.some((user: { isLastActiveAdministrator: boolean }) => user.isLastActiveAdministrator)).toBe(false);
  });
});

describe("a user edit does not hold up unrelated writes", () => {
  it("lets a row that references a locked user be written while the edit is open", async () => {
    // The edit locks every active Administrator. Postgres checks a foreign key
    // by taking a lock of its own on the referenced row, and that lock
    // conflicts with FOR UPDATE: a comment posted by any Administrator would
    // wait for every user edit in the system to finish. FOR NO KEY UPDATE
    // leaves the key alone, so the insert goes straight through.
    const subject = await makeUser("IT_STAFF");
    const requester = await makeUser();
    const category = await prisma.category.findFirstOrThrow();
    const relatedSystem = await prisma.relatedSystem.findFirstOrThrow();
    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber: `LK-${TAG}-${subject.id}`,
        requesterId: requester.id,
        categoryId: category.id,
        relatedSystemId: relatedSystem.id,
        summary: `Lock fixture ${TAG}`,
        description: "A fixture for the lock strength test.",
        requestedPriority: "LOW",
        itPriority: "LOW",
      },
    });

    const holding = createPrismaClient();
    const realTransaction = holding.$transaction.bind(holding);
    let insert: "finished" | "blocked" | "not tried" = "not tried";
    // The write itself, kept so the test can wait for it to settle before it
    // ends. If it was blocked it only completes once the edit commits.
    let pending: Promise<unknown> = Promise.resolve();

    vi.spyOn(holding, "$transaction").mockImplementation(((fn: unknown, ...rest: unknown[]) =>
      (realTransaction as never as (...a: unknown[]) => unknown)(async (tx: object) => {
        const watched = new Proxy(tx, {
          get(target, property) {
            const value = Reflect.get(target, property, target) as unknown;
            if (property !== "$queryRaw") return value;
            return async (...args: unknown[]) => {
              const rows = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
              // The locks are held now, and the transaction is still open.
              // From a separate connection, write a comment authored by the
              // Administrator whose row is locked.
              const write = prisma.ticketComment
                .create({ data: { ticketId: ticket.id, authorId: adminId, visibility: "PUBLIC", body: "Written during a user edit." } })
                .then(() => "finished" as const);
              const giveUp = new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 1500));
              insert = await Promise.race([write, giveUp]);
              pending = write.catch(() => {});
              return rows;
            };
          },
        });
        return (fn as (t: unknown) => unknown)(watched);
      }, ...rest)) as never);

    const response = await edit(subject.id, { name: `Lock Subject ${TAG}` }, adminCookie, createApp(holding));
    // Now actually waited for, so a blocked insert cannot land after this
    // test has finished and race the cleanup.
    await pending;
    await holding.$disconnect();

    expect(response.status).toBe(200);
    expect(insert).toBe("finished");
  });
});

describe("API-42 setting a new initial password (AC-41, BR-36)", () => {
  it("replaces the password, signs the user out, and makes them change it", async () => {
    const subject = await makeUser("IT_STAFF");
    const oldCookie = await signInAs(app, subject.email);

    const response = await resetPassword(subject.id, { initialPassword: INITIAL });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: subject.id, mustChangePassword: true });
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|Initial123/);

    // The session they had is gone, and so is the password that opened it.
    expect((await request(app).get("/api/auth/me").set("Cookie", oldCookie)).status).toBe(401);
    expect(await prisma.session.count({ where: { userId: subject.id } })).toBe(0);
    expect((await login(subject.email, FIXTURE_PASSWORD)).status).toBe(401);

    const signedIn = await login(subject.email, INITIAL);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user.mustChangePassword).toBe(true);
  });

  it("holds the new password to the same bounds as any other (BR-13)", async () => {
    const subject = await makeUser();

    for (const initialPassword of ["a".repeat(7), "a".repeat(73), "", undefined, 12345678]) {
      const response = await resetPassword(subject.id, { initialPassword });
      expect([initialPassword, response.status]).toEqual([initialPassword, 400]);
    }

    const after = await userRow(subject.id);
    expect(after.passwordHash).toBe(FIXTURE_HASH);
    expect(after.mustChangePassword).toBe(false);
  });

  it("answers 404 for a user that does not exist, before hashing anything", async () => {
    expect((await resetPassword(99999999, { initialPassword: INITIAL })).status).toBe(404);
    expect((await resetPassword("abc", { initialPassword: INITIAL })).status).toBe(404);
  });

  it("changes only that user's password", async () => {
    const [subject, bystander] = [await makeUser(), await makeUser()];

    await resetPassword(subject.id, { initialPassword: INITIAL });

    expect((await userRow(bystander.id)).passwordHash).toBe(FIXTURE_HASH);
    expect((await login(bystander.email, FIXTURE_PASSWORD)).status).toBe(200);
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});
