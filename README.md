# TokTickIT

An IT service desk application for Account and Access, Hardware, Software, and Network requests.

Built for **CPE 334 — Introduction to Software Engineering in the Age of AI Agents**, Semester 1/2026.
This repository holds the individual sprints. Lab 1 delivered the first full-stack vertical
slice. Lab 2 added the Requester-facing ticketing MVP: Create Ticket with attachments, My
Tickets, and Ticket Detail. Lab 3 replaces Lab 2's temporary Requester selector with real
sign-in and three roles, and adds the IT Staff Ticket Queue and Ticket Detail, Public
Comments and Internal Notes, and Administrator User Management.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React + TypeScript + Vite + Bootstrap |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL + Prisma |
| Architecture | REST-style APIs |
| Authentication | Server-side sessions in an httpOnly cookie, bcrypt password hashes |
| Testing | Vitest (UI) + Supertest (API) + Playwright (end to end) |

## Repository structure

```
toktickit/
├── client/                 React + TypeScript + Vite frontend
│   ├── src/
│   └── tests/
│       ├── lab-01/         Vitest UI tests
│       ├── lab-02/         Vitest UI tests
│       └── lab-03/         Vitest UI tests
├── server/                 Express + TypeScript API
│   ├── prisma/             Prisma schema and migrations
│   ├── src/
│   ├── uploads/            Attachment storage (gitignored)
│   └── tests/
│       ├── lab-01/         Supertest API tests
│       ├── lab-02/         Supertest API tests
│       └── lab-03/         Supertest API and unit tests
├── docs/
│   ├── lab-01/             Lab 1 submission evidence
│   ├── lab-02/             Lab 2 specification, API/UI spec, tests, review record
│   ├── lab-03/             Lab 3 specification, API/UI spec, tests, review record, AI use
│   └── labSheet/           Course-issued lab sheet
├── e2e/
│   ├── lab-02/             Playwright visual and end-to-end specs
│   ├── lab-03/             Playwright flows, visual checks and submission evidence
│   └── run-fresh.mjs       Runs the suite on a database built for the run
├── artifacts/
│   ├── lab-02/             Lab 2 screenshots
│   └── lab-03/             Lab 3 screenshots and API authorization evidence
├── playwright.config.ts
├── docker-compose.yaml     Optional PostgreSQL container
├── .gitignore
└── README.md
```

## Prerequisites

- Node.js 20 or newer (developed on 24.15.0)
- npm 10 or newer
- PostgreSQL 17 on port 5432, either installed locally or run with Docker (see below)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/FakeKase/TokTickIT.git
cd TokTickIT

cd server && npm install
cd ../client && npm install
```

### 2. Start PostgreSQL

Pick one of the two options. Both end up with a `toktickit_dev` database on port 5432.

**Option A — Docker (no local PostgreSQL install needed)**

```bash
docker compose up -d
```

**Option B — locally installed PostgreSQL**

```bash
psql -U postgres -c "CREATE DATABASE toktickit_dev"
```

Do not run both at once; they compete for port 5432.
This project was developed against Option B, so that is the verified path.

### 3. Configure environment variables

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Then edit `server/.env` and set `DATABASE_URL` to your own PostgreSQL credentials:

```
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/toktickit_dev?schema=public"
PORT=3001
CLIENT_ORIGIN="http://localhost:5173"
```

`.env` is git-ignored. Only the `.env.example` files are committed.

### 4. Generate the Prisma client

```bash
cd server
npx prisma generate
```

## Seeded accounts

Every seeded account uses the same password:

```
ChangeMe123!
```

This is a local development fixture, not a secret. It exists only in a database seeded from
`server/prisma/seed.ts`, it is documented here precisely so nobody mistakes it for a credential,
and no real password belongs in this repository (BR-39).

| Email | Role | State |
| :-- | :-- | :-- |
| `peter.parker@toktickit.test` | Requester | Active |
| `ned.leeds@toktickit.test` | Requester | Active |
| `michelle.jones@toktickit.test` | Requester | Active |
| `roronoa.zoro@toktickit.test` | Requester | Active |
| `grace.lim@toktickit.test` | Requester | Active, owns no Tickets — the My Tickets Empty state (BR-28) |
| `nora.bennett@toktickit.test` | Requester | Active, **must change password at first login** |
| `david.kim@toktickit.test` | Requester | Inactive — cannot sign in (BR-01) |
| `sarah.chen@toktickit.test` | IT Staff | Active |
| `marcus.reed@toktickit.test` | IT Staff | Active |
| `aiko.tanaka@toktickit.test` | IT Staff | Active |
| `daniel.okafor@toktickit.test` | IT Staff | Active, **must change password at first login** |
| `viktor.hale@toktickit.test` | IT Staff | Inactive |
| `alex.morgan@toktickit.test` | Administrator | Active |

Requesters carried over from Lab 2 keep the addresses they had, so Tickets created before the
migration still belong to the same people. Re-running the seed never rewrites a password that has
since been changed.

The table above holds whether or not your database has been through the Lab 3 migration. The
migration marks every account it carries over as holding an initial password; seeding then puts
the roster back into the state shown here, so only the two accounts marked above are gated. A
database that ran Lab 2 and one created this morning behave identically once seeded.

## Running the app

Two terminals are needed.

```bash
# Terminal 1 - API on http://localhost:3001
cd server
npm run dev
```

```bash
# Terminal 2 - UI on http://localhost:5173
cd client
npm run dev
```

Open http://localhost:5173 in a browser.

## Verifying the setup

```bash
cd server
npm run db:check      # confirms PostgreSQL is reachable through Prisma
```

## Running the tests

Three suites. The unit suites need PostgreSQL running, migrated and seeded, because the
API tests query the real database rather than mocking it.

```bash
# One-time setup, from server/
npx prisma migrate deploy   # creates the Lab 1 + Lab 2 + Lab 3 tables
npm run db:seed             # categories, related systems, users, tickets, comments

# Run the suites
cd server && npm test       # Supertest API + unit tests
cd client && npm test       # Vitest UI tests
npm run e2e                 # Playwright, from the repository root
```

Expected output, on a freshly seeded database:

```
$ cd server && npm test
 Test Files  21 passed (21)
      Tests  353 passed (353)

$ cd client && npm test
 Test Files  17 passed (17)
      Tests  256 passed (256)

$ npm run e2e:fresh
  91 passed

$ npm run e2e
  23 skipped
  68 passed
```

The server suite signs in as every seeded account, so it expects them as the table above
describes them. If you have changed a seeded account's password by hand, one test in
`seed-credentials.api.test.ts` fails until an Administrator sets it back; reseeding does not
undo it, because the seed never rewrites a password.

`npm run e2e` starts the API and the Vite dev server itself, so nothing needs to be
running first. It writes screenshots to `artifacts/lab-02/screenshots/` and removes the
Tickets and users it created afterwards, so repeated runs do not fill the demo database.

`npm run e2e:fresh` runs the same suite against a database built for the run: it creates
`<your database>_e2e` beside the development one, migrates and seeds it, and starts its own
API and client on ports 3101 and 5273, so it does not matter what else is running. This is
the command that produces the Lab 3 submission screenshots in `artifacts/lab-03/screenshots/`;
they are only captured in this mode, so that they show the seed and nothing left in a
development database. Anything after `--` is passed to Playwright, for example
`npm run e2e:fresh -- e2e/lab-03`.

Test files live in `server/tests/lab-0{1,2,3}/`, `client/tests/lab-0{1,2,3}/` and
`e2e/lab-0{2,3}/`. See [`docs/lab-01/tests.md`](docs/lab-01/tests.md),
[`docs/lab-02/tests.md`](docs/lab-02/tests.md) and
[`docs/lab-03/tests.md`](docs/lab-03/tests.md) for the full test lists and their
traceability to acceptance criteria.

## Available scripts

### `server/`

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the API with file watching |
| `npm start` | Start the API once |
| `npm test` | Run the Supertest suite |
| `npm run typecheck` | Type-check without emitting |
| `npm run db:check` | Verify PostgreSQL connectivity |
| `npm run db:seed` | Seed categories, related systems, users, tickets and comments (idempotent) |
| `npm run db:migration-check` | Rebuild the Lab 2 schema on a throwaway database, apply the Lab 3 migration, and assert no Ticket, Attachment or owner was lost |
| `npm run prisma:generate` | Regenerate the Prisma client |

### Repository root

| Script | Purpose |
| --- | --- |
| `npm run e2e` | Run the Playwright suite against the development database |
| `npm run e2e:fresh` | Build a database for the run, then run the suite on its own ports; captures the Lab 3 evidence |
| `npm run typecheck` | Type-check the Playwright specs |

### `client/`

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm test` | Run the Vitest suite |
| `npm run lint` | Run oxlint |
| `npm run typecheck` | Type-check without emitting |

## Git workflow

`main` is the stable release branch. Each lab has its own integration branch:
`lab1-staging`, then `lab2-staging`, then `lab3-staging`. All work happens on feature
branches and reaches `main` through the staging branch for that lab, one pull request at a
time.

### Lab 3 branches

| Issue | Feature branch | PR target |
| :-- | :-- | :-: |
| 37. Sprint 3 engineering contract | `feature/lab3-specification` | `lab3-staging` |
| 38. User model, session store, migration, seed | `feature/lab3-user-model` | `lab3-staging` |
| 39. Authentication API | `feature/lab3-auth-api` | `lab3-staging` |
| 40. Login, password change, app shell | `feature/lab3-auth-ui` | `lab3-staging` |
| 41. Requester regression on the authenticated identity | `feature/lab3-requester-regression` | `lab3-staging` |
| 42. Public Comments and Problem Appears Resolved | `feature/lab3-comments` | `lab3-staging` |
| 43. IT Staff Ticket Queue | `feature/lab3-staff-queue` | `lab3-staging` |
| 44. IT Staff Ticket Detail | `feature/lab3-staff-detail` | `lab3-staging` |
| 45. Administrator user management | `feature/lab3-admin-users` | `lab3-staging` |
| 46. End-to-end suite and submission evidence | `feature/lab3-e2e` | `lab3-staging` |
| 47. Responsive and visual QA | `feature/lab3-visual-qa` | `lab3-staging` |
| 48. Documentation and release | `feature/lab3-docs-release` | `lab3-staging` |

### Lab 2 branches

| Issue | Feature branch | PR target |
| :-- | :-- | :-: |
| 11. Specification, API/UI spec, test plan | `feature/lab2-specification` | `lab2-staging` |
| 12. Database schema | `feature/lab2-schema` | `lab2-staging` |
| 13. Zen Green theme, shell, routing | `feature/lab2-shell` | `lab2-staging` |
| 14. Requester selection and context | `feature/lab2-requester-context` | `lab2-staging` |
| 15. Create Ticket | `feature/lab2-create-ticket` | `lab2-staging` |
| 16. My Tickets | `feature/lab2-my-tickets` | `lab2-staging` |
| 17. Requester Ticket Detail | `feature/lab2-ticket-detail` | `lab2-staging` |
| 18. Attachments (download, soft removal) | `feature/lab2-attachments` | `lab2-staging` |
| 19. Responsive and visual QA | `feature/lab2-visual-qa` | `lab2-staging` |
| 20. End-to-end requester flow | `feature/lab2-e2e` | `lab2-staging` |
| 21. Documentation and release | `feature/lab2-docs-release` | `lab2-staging` |

Every pull request requires peer review before merging. The review record for each lab
is in `docs/lab-0{1,2,3}/reviewer.md`.
