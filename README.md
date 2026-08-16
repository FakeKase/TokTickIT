# TokTickIT

An IT service desk application for Account and Access, Hardware, Software, and Network requests.

Built for **CPE 334 — Introduction to Software Engineering in the Age of AI Agents**, Semester 1/2026.
This repository holds the individual sprints; Lab 1 delivers the first full-stack vertical slice.

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
│   └── tests/lab-01/       Vitest UI tests
├── server/                 Express + TypeScript API
│   ├── prisma/             Prisma schema and migrations
│   ├── src/
│   └── tests/lab-01/       Supertest API tests
├── docs/
│   ├── lab-01/             Lab 1 submission evidence
│   └── labSheet/           Course-issued lab sheet
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

Both suites need PostgreSQL running and migrated first, since `API-02.categories.test.ts`
queries the real database rather than mocking it.

```bash
# One-time setup, from server/
npx prisma migrate deploy   # creates the Category table
npx tsx prisma/seed.ts      # inserts the four categories

# Run the suites
cd server && npm test       # Supertest API tests
cd client && npm test       # Vitest UI tests
```

Expected output:

```
$ cd server && npm test
 Test Files  3 passed (3)
      Tests  8 passed (8)

$ cd client && npm test
 Test Files  3 passed (3)
      Tests  9 passed (9)
```

Test files live in `server/tests/lab-01/` and `client/tests/lab-01/`.
See [`docs/lab-01/tests.md`](docs/lab-01/tests.md) for the full test list.

## Available scripts

### `server/`

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the API with file watching |
| `npm start` | Start the API once |
| `npm test` | Run the Supertest suite |
| `npm run typecheck` | Type-check without emitting |
| `npm run db:check` | Verify PostgreSQL connectivity |
| `npm run prisma:generate` | Regenerate the Prisma client |

### `client/`

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm test` | Run the Vitest suite |
| `npm run lint` | Run oxlint |

## Git workflow

`main` is the stable release branch. `lab1-staging` is the Lab 1 integration branch.
All work happens on feature branches and reaches `main` through `lab1-staging`.

| Issue | Feature branch | PR target |
| --- | --- | --- |
| 1. Project Foundation | `feature/1-project-foundation` | `lab1-staging` |
| 2. API Health Check | `feature/2-health-check` | `lab1-staging` |
| 3. Create and Seed Categories | `feature/3-category-seed` | `lab1-staging` |
| 4. Display Category List | `feature/4-category-list` | `lab1-staging` |

Every pull request requires peer review before merging.
