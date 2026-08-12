import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";

// Foundation smoke test (Issue 1): proves the Vitest + Supertest toolchain is
// wired up and that the Express app can be mounted without a live listener.
describe("API-00 foundation smoke", () => {
  it("serves the service name from the root route", async () => {
    const response = await request(createApp()).get("/");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ service: "TokTickIT API" });
  });
});
