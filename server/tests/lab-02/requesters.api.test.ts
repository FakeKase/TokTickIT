import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";

// API-18 (Issue 14): GET /api/requesters backs the Development Requester
// Selection screen. Runs against the real seeded database, like the lab-01
// API tests, so BR-04 is proved against an actual inactive row rather than a
// mock that could drift from the schema.
describe("API-18 GET /api/requesters", () => {
  it("returns HTTP 200 and an array", async () => {
    const response = await request(createApp()).get("/api/requesters");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it("BR-04: omits the inactive seeded Requester", async () => {
    const response = await request(createApp()).get("/api/requesters");

    const emails = response.body.map((r: { email: string }) => r.email);
    expect(emails).not.toContain("david.kim@toktickit.test");
    expect(emails).toContain("jennifer.anderson@toktickit.test");
  });

  it("returns every active seeded Requester", async () => {
    const response = await request(createApp()).get("/api/requesters");

    expect(response.body.map((r: { name: string }) => r.name)).toEqual([
      "Jennifer Anderson",
      "Marcus Lee",
      "Priya Natarajan",
      "Somchai Charoenkul",
    ]);
  });

  it("orders Requesters by name ascending", async () => {
    const response = await request(createApp()).get("/api/requesters");

    const names = response.body.map((r: { name: string }) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("exposes only id, name, and email", async () => {
    const response = await request(createApp()).get("/api/requesters");

    response.body.forEach((requester: Record<string, unknown>) => {
      expect(Object.keys(requester).sort()).toEqual(["email", "id", "name"]);
      expect(typeof requester.id).toBe("number");
      expect(typeof requester.name).toBe("string");
      expect(typeof requester.email).toBe("string");
    });
  });

  it("returns a safe error message when the database is unreachable", async () => {
    const failing = {
      requester: {
        findMany: async () => {
          throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
        },
      },
    } as unknown as Parameters<typeof createApp>[0];

    const response = await request(createApp(failing)).get("/api/requesters");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "Unable to load Development Requesters",
    });
    expect(JSON.stringify(response.body)).not.toMatch(/ECONNREFUSED/);
  });
});
