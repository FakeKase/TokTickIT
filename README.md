# TokTickIT

An IT service desk application for Account and Access, Hardware, Software, and Network requests.

Built for **CPE 334 — Introduction to Software Engineering in the Age of AI Agents**, Semester 1/2026.
This repository holds the individual sprints. Lab 1 delivered the first full-stack vertical
slice; Lab 2 adds the Requester-facing ticketing MVP — a temporary Development Requester
selector, Create Ticket with attachments, My Tickets, and read-only Ticket Detail.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React + TypeScript + Vite + Bootstrap |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL + Prisma |
| Architecture | REST-style APIs |
| Testing | Vitest (UI) + Supertest (API) |

## Repository structure

```
toktickit/
├── client/                 React + TypeScript + Vite frontend
│   ├── src/
│   └── tests/
│       ├── lab-01/         Vitest UI tests
│       └── lab-02/         Vitest UI tests
├── server/                 Express + TypeScript API
│   ├── prisma/             Prisma schema and migrations
│   ├── src/
│   ├── uploads/            Attachment storage (gitignored)
│   └── tests/
│       ├── lab-01/         Supertest API tests
│       └── lab-02/         Supertest API tests
├── docs/
│   ├── lab-01/             Lab 1 submission evidence
│   ├── lab-02/             Lab 2 specification, API/UI spec, tests, review record
│   └── labSheet/           Course-issued lab sheet
├── e2e/lab-02/             Playwright visual and end-to-end specs
├── artifacts/lab-02/       Captured screenshots
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
npx prisma migrate deploy   # creates the Lab 1 + Lab 2 tables
npm run db:seed             # categories, related systems, requesters

# Run the suites
cd server && npm test       # Supertest API + unit tests
cd client && npm test       # Vitest UI tests
npm run e2e                 # Playwright, from the repository root
```

Expected output:

```
$ cd server && npm test
 Test Files  10 passed (10)
      Tests  115 passed (115)

$ cd client && npm test
 Test Files  12 passed (12)
      Tests  111 passed (111)

$ npm run e2e
  22 passed
```

`npm run e2e` starts the API and the Vite dev server itself, so nothing needs to be
running first. It writes screenshots to `artifacts/lab-02/screenshots/` and removes the
Tickets it created afterwards, so repeated runs do not fill the demo database.

Test files live in `server/tests/lab-0{1,2}/`, `client/tests/lab-0{1,2}/` and `e2e/lab-02/`.
See [`docs/lab-01/tests.md`](docs/lab-01/tests.md) and
[`docs/lab-02/tests.md`](docs/lab-02/tests.md) for the full test lists and their
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
| `npm run db:seed` | Seed categories, related systems and requesters (idempotent) |
| `npm run prisma:generate` | Regenerate the Prisma client |

### `client/`

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm test` | Run the Vitest suite |
| `npm run lint` | Run oxlint |
| `npm run typecheck` | Type-check without emitting |

## Git workflow

`main` is the stable release branch. Each lab has its own integration branch —
`lab1-staging`, then `lab2-staging`. All work happens on feature branches and reaches
`main` through the staging branch for that lab.

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

Every pull request requires peer review before merging. The review record for both labs
is in `docs/lab-0{1,2}/reviewer.md`.
