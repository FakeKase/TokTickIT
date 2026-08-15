import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";

// API-01 (Issue 2): the health endpoint the frontend polls when [Check System]
// is pressed. The exact JSON shape is fixed by the lab sheet, so it is asserted
// with toEqual rather than a partial match.
describe("API-01 GET /api/health", () => {
  it("returns HTTP 200", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(200);
  });

  it("reports status ok and the service name", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.body).toEqual({
      status: "ok",
      service: "TokTickIT API",
    });
  });

  it("responds as JSON", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.headers["content-type"]).toMatch(/application\/json/);
  });
});
