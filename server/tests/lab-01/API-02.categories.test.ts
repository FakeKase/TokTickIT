import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";

// API-02 (Issue 3): the four seeded IT request categories. Tests against the
// real database to verify seeds were created and are fetchable via REST.
describe("API-02 GET /api/categories", () => {
  it("returns HTTP 200", async () => {
    const response = await request(createApp()).get("/api/categories");

    expect(response.status).toBe(200);
  });

  it("returns an array", async () => {
    const response = await request(createApp()).get("/api/categories");

    expect(Array.isArray(response.body)).toBe(true);
  });

  it("returns the four seeded categories", async () => {
    const response = await request(createApp()).get("/api/categories");

    expect(response.body).toHaveLength(4);
    expect(response.body.map((c: any) => c.name)).toEqual([
      "Account and Access",
      "Hardware",
      "Software",
      "Network",
    ]);
  });

  it("each category has id, name, and description", async () => {
    const response = await request(createApp()).get("/api/categories");

    response.body.forEach((category: any) => {
      expect(category).toHaveProperty("id");
      expect(category).toHaveProperty("name");
      expect(category).toHaveProperty("description");
      expect(typeof category.id).toBe("number");
      expect(typeof category.name).toBe("string");
      expect(typeof category.description).toBe("string");
    });
  });
});
