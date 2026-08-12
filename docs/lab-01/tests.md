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

| Test File | Tool | Test Description | Issue |
| --- | --- | --- | --- |
| `server/tests/lab-01/API-00.smoke.test.ts` | Supertest | Express app mounts and serves the service name | 1 |
| `server/tests/lab-01/API-01.health.test.ts` | Supertest | Health endpoint returns 200 and expected JSON | 2 |
| `server/tests/lab-01/API-02.categories.test.ts` | Supertest | Categories endpoint returns the four seeded categories | 4 |
| `client/tests/lab-01/UI-00.smoke.test.tsx` | Vitest | Bootstrap-styled app shell renders | 1 |
| `client/tests/lab-01/UI-01.heading.test.tsx` | Vitest | TokTickIT heading renders | 4 |
| `client/tests/lab-01/UI-02.loading.test.tsx` | Vitest | Loading state changes to category list | 4 |
| `client/tests/lab-01/UI-03.error.test.tsx` | Vitest | API failure displays a useful error message | 4 |

API-00 and UI-00 are foundation smoke tests added in Issue 1 to prove the Vitest and
Supertest toolchains are configured. API-01 through UI-03 are the tests required by the
lab sheet.

## Status

Rows for Issues 2 through 4 are planned and will be checked off as those issues are
implemented. Only API-00 and UI-00 exist as of Issue 1.

## Results

_Terminal output evidence is added once all four issues are merged into `main`._
