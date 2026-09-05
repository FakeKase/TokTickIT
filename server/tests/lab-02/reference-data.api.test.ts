import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";

// API-19 (FR-14): the reference lists behind Create Ticket's classification
// row. Categories already had coverage in lab-01; this adds Related Systems
// and pins the contract both endpoints share.

const app = createApp();

describe("API-19 GET /api/related-systems", () => {
  it("returns HTTP 200 and an array", async () => {
    const response = await request(app).get("/api/related-systems");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it("returns the seeded Related Systems", async () => {
    const response = await request(app).get("/api/related-systems");

    // Handout §5.3 requires at least six.
    expect(response.body.length).toBeGreaterThanOrEqual(6);
    expect(response.body.map((s: { name: string }) => s.name)).toContain(
      "Corporate Laptop",
    );
  });

  it("orders Related Systems by name ascending", async () => {
    const response = await request(app).get("/api/related-systems");

    const names = response.body.map((s: { name: string }) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("exposes only id and name", async () => {
    const response = await request(app).get("/api/related-systems");

    response.body.forEach((system: Record<string, unknown>) => {
      expect(Object.keys(system).sort()).toEqual(["id", "name"]);
    });
  });

  it("returns a safe error message when the database is unreachable", async () => {
    const failing = {
      relatedSystem: {
        findMany: async () => {
          throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
        },
      },
    } as unknown as Parameters<typeof createApp>[0];

    const response = await request(createApp(failing)).get("/api/related-systems");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Unable to load Related Systems" });
    expect(JSON.stringify(response.body)).not.toMatch(/ECONNREFUSED/);
  });
});

describe("API-19 GET /api/categories still serves Create Ticket", () => {
  it("returns the four seeded Categories", async () => {
    const response = await request(app).get("/api/categories");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(4);
  });
});
