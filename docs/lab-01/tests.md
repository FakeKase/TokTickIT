# Lab 1 — Automated Tests

Lab 1 tests prove that the initial TokTickIT vertical slice works correctly:
React UI → Express REST API → Prisma ORM → PostgreSQL.

## Where the tests live

The lab sheet asks for test files under `tests/lab-01/`. Because Supertest runs against
the Express app and Vitest UI tests need a browser-like environment with React, the
folder exists in both workspaces:

- `server/tests/lab-01/` — Supertest API tests (node environment)
- `client/tests/lab-01/` — Vitest UI tests (jsdom environment)

## How to run

```bash
cd server && npm test    # API tests
cd client && npm test    # UI tests
```

## Test list

| Test File | Tool | Test Description | Issue | Status |
| --- | --- | --- | --- | --- |
| `server/tests/lab-01/API-00.smoke.test.ts` | Supertest | Express app mounts and serves the service name | 1 | ✅ |
| `server/tests/lab-01/API-01.health.test.ts` | Supertest | Health endpoint returns 200 and expected JSON | 2 | ✅ |
| `server/tests/lab-01/API-02.categories.test.ts` | Supertest | Categories endpoint returns the four seeded categories | 4 | planned |
| `client/tests/lab-01/UI-01.heading.test.tsx` | Vitest | TokTickIT heading renders | 2 | ✅ |
| `client/tests/lab-01/UI-02.loading.test.tsx` | Vitest | Loading state changes to category list | 4 | planned |
| `client/tests/lab-01/UI-03.error.test.tsx` | Vitest | API failure displays a useful error message | 2 | ✅ |

API-00 is a foundation smoke test added in Issue 1 to prove the Supertest toolchain is
configured. API-01 through UI-03 are the tests required by the lab sheet.

UI-01 and UI-03 land in Issue 2 rather than Issue 4 because that is when the heading, the
[Check System] button and the error path are built. UI-02 stays in Issue 4 because it
asserts the loading state resolving into the *category list*, which does not exist yet.

A `UI-00.smoke.test.tsx` existed in Issue 1 to prove the Vitest toolchain worked. It was
removed in Issue 2 once UI-01 covered the same assertion for real.

## Results

Latest run on `feature/2-health-check`:

```
$ cd server && npm test
 Test Files  2 passed (2)
      Tests  4 passed (4)

$ cd client && npm test
 Test Files  2 passed (2)
      Tests  5 passed (5)
```

_Final evidence from `main` is added once all four issues are merged._
