import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
    // Sends each request to the test server over the address family it is
    // listening on. See the file for what happened without it.
    setupFiles: ["tests/helpers/setup.ts"],
    // The API tests run against one real Postgres, and some assert on
    // whole-table results (e.g. GET /api/requesters returning exactly the
    // seeded rows). Running files in parallel lets one suite's fixtures show
    // up in another's response, so they are serialized.
    fileParallelism: false,
  },
});
