# Lab 2 — AI Use

## LLM used

**Claude Opus 5**, driven through **Claude Code** (the CLI agent) inside the repository,
so the model could read the handout and the specs, run the test suites, and open pull
requests directly rather than working from pasted snippets.

Two distinct roles, as the handout's §11 separates them:

- **Specification agent** — Issue 11 only, producing `specification.md`, `api-spec.md`,
  `ui-spec.md` and `tests.md` before any implementation began.
- **Coding agent** — Issues 12 onward, one issue per feature branch, always written
  against the documents agreed in Issue 11.

For two issues the coding agent was directed to **delegate to a specialist sub-agent**
(`database-engineer`, `frontend-engineer`) with a written brief rather than implement
directly. Those briefs are prompts 1 and 2 below, and they are the most substantial
prompts of the sprint — each is the point where an approved specification is handed to
something that writes code.

> **To confirm before submitting:** the model and settings above cover the sessions from
> Issue 14 onward. If Issues 11–13 ran with a different model or thinking level, correct
> this section — it should describe what was actually used.

## Selected key prompts

Six prompts. The first two are the sub-agent briefs (excerpted here, in full in
Appendix A); the rest are typed instructions, quoted as written, typos included.

| # | Prompt | What it produced | Why this one |
| --- | --- | --- | --- |
| 1 | **Sub-agent brief — `database-engineer`, Issue 12.** *"Read `docs/lab-02/specification.md` section 7 ("Data Changes") yourself for the authoritative field list — the summary below is for orientation, not a substitute. […] Implement ONLY the database layer for this issue — no API routes, no ticket-number generation logic, no anything from later issues. Scope creep here will conflict with later issues' PRs. […] Don't run `git commit`/`git push`/open a PR — leave the working tree as-is when you're done. I'll review the diff and handle git myself."* | The Prisma schema for Requester, Ticket, Attachment and RelatedSystem, its migration, and the idempotent seed extension | Points the sub-agent at the spec as the authority instead of trusting the summary in the prompt; fences the scope against the next issue's PR; and keeps the diff under review rather than letting the agent push. |
| 2 | **Sub-agent brief — `frontend-engineer`, Issue 13.** *"The existing Lab 1 'Check System' flow must keep working and must keep passing its existing tests, unmodified in behavior. […] Read all three before touching anything so you know the exact assertions. […] `npm run typecheck`, `npm run lint`, and `npm test` all pass in `client/` (run all three yourself before considering this done — do not just claim it works). […] be precise and honest about what actually passed vs. what you didn't get to."* | The Zen Green token file, seven reusable components, the app shell and the router | Names the three Lab 1 tests that must not break and makes the agent read them first, then demands it run the checks rather than assert success — the handout's §2 point about not accepting an agent's claim that work is done, applied to a sub-agent. |
| 3 | `We will going to do pr by pr okay? no parallel` | A standing constraint applied for the rest of the sprint | Directing *process*, not code. Said after the agent offered to start Issue 14 while an unrelated PR was still open. Every later issue waited for the previous PR to merge. |
| 4 | `delete the text underline when click and keep only green ui underline and make sure it work on both theme` | The nav active-state fix, plus a bug found in the process | "Make sure it works on both themes" was the important half. The green underline used `--zg-secondary`, which is 1.23:1 against the header in the light theme — invisible. The text underline had been carrying the active state all along. |
| 5 | `And I found the UI bug when I click create ticket, my ticket is still underlined` | Fix for both nav items showing active, and `aria-current="page"` on both | A bug found by using the app, not by reading code. The tests had passed throughout, and the accessibility half of the defect was worse than the visible half. |
| 6 | `But first let me check if the name is editable? please ref the labsheet` | A quote of handout §5.3 before the change proceeded | Checking the source rather than trusting the agent's summary of it. §5.3 turned out to permit custom Requester names but require them to be "realistic" — a constraint neither of us had noticed. |

> **Two notes on this table.**
>
> Only two sub-agent dispatches exist in the whole sprint (Issues 12 and 13); every other
> issue was implemented by the main agent directly. So prompts 1 and 2 are all of them —
> there is no third to add.
>
> That left five entries, one short of the handout's minimum of six, so prompt 6 was kept
> from the earlier draft. Cut it if you would rather, but the table then falls below the
> required range.

## What the AI got wrong

Included because "AI use" that only lists successes is not an honest account of it.

- **Concurrency fixes written with sequential tests, three times.** The attachment cap,
  the soft-removal race, and an `AC-16` sort assertion were each implemented correctly
  but covered by tests that awaited every call in turn, so none of them could have
  failed. My peer caught all three; the tests now overlap the calls and were each
  verified to fail without the fix.
- **A cleanup script that leaked around itself.** The e2e teardown removed fixture
  tickets by a marker, but one spec submitted a ticket through the form with an unmarked
  description, so it escaped every run. Five had accumulated before my peer spotted it.
- **A test that checked the client against itself.** Ticket Detail decided whether a
  failure was a 404 by matching the error *text*, and the test hardcoded the same string
  the server did, with nothing connecting them.

The pattern in all three: the code was right and the evidence for it was not. That is the
specific thing to watch for when an agent reports that something passes — and it is why
both sub-agent briefs above insist the agent run the checks rather than claim them.

## My Reflection

<!--
  TODO — write 3-5 sentences in your own voice. The handout (Part 4) asks for "a very
  brief My Reflection on your AI use experience". Worth touching on:
    - what the agent was genuinely good at versus where it needed correcting
    - whether reviewing its output cost more or less than writing the code yourself
    - whether delegating to sub-agents (Issues 12-13) worked better or worse than
      directing the main agent yourself (Issues 14-20)
    - what you would direct differently in Lab 3
  Leave nothing here that you did not actually think — this section has to be yours.
-->

---

## Appendix A — Sub-agent briefs in full

Reproduced verbatim. They are long because each one hands an approved specification to
something that writes code unsupervised, and the constraints are what kept the result
inside its issue's scope.

### A.1 `database-engineer` — Issue 12 (Database schema)

```text
Repo: /Users/kase/Downloads/Lab01/TocktikIT (TokTickIT, a CPE334 course project). You're on branch `feature/lab2-schema`, cut from `lab2-staging`, which already has the approved Lab 2 spec docs at `docs/lab-02/{specification.md,api-spec.md,ui-spec.md,tests.md}`. Read `docs/lab-02/specification.md` section 7 ("Data Changes") yourself for the authoritative field list — the summary below is for orientation, not a substitute.

This is GitHub Issue #12: "Lab 2: Database schema — Requester, Ticket, Attachment, RelatedSystem". Implement ONLY the database layer for this issue — no API routes, no ticket-number generation logic, no anything from later issues (Create Ticket, My Tickets, Requester selector screens are separate issues). Scope creep here will conflict with later issues' PRs.

## Stack conventions (Lab 1, already in the repo — follow them exactly)
- `server/prisma/schema.prisma` currently has one model, `Category` (id, name unique, description, createdAt) — from Lab 1, reuse unchanged, do not touch it.
- Prisma 7 with the `PrismaPg` driver adapter (see `server/src/prisma.ts`) — datasource has no `url` in schema.prisma, connection comes from `DATABASE_URL` env var at runtime via the adapter. Don't add a `url` field to the datasource block.
- `server/prisma/seed.ts` currently seeds only the 4 Categories via `prisma.category.upsert({ where: { name }, update, create })` in a loop, called from `main()`. Idempotent seeding is done via `upsert` keyed on a unique field — never `create`. Extend this same file/pattern for the new entities; keep the existing Category seed block as-is.
- Migrations live in `server/prisma/migrations/`, Prisma-generated timestamped folders. Never hand-edit an applied migration — only `npx prisma migrate dev --name <name>` to add new ones.
- `server/.env` already has a working `DATABASE_URL` pointing at `postgresql://postgres:postgres@localhost:5433/toktickit_dev` (port 5433, not 5432 — this machine's native Postgres already owns 5432, so the project's Postgres container is remapped via `docker-compose.override.yaml`). Before running any `prisma migrate` command, check `docker ps` for a healthy `toktickit-postgres` container; if it's not running, `docker compose up -d postgres` from the repo root and wait for it to report healthy.

## Data model to add (full detail is in specification.md §7 — read it, this is a summary)
- **Requester**: id, name, email (unique), isActive (Boolean, default true), createdAt.
- **RelatedSystem**: id, name (unique), createdAt.
- **Ticket**: id, ticketNumber (String, unique — no generation logic here, just the column), requesterId (FK → Requester), categoryId (FK → Category), relatedSystemId (FK → RelatedSystem), summary (String), description (String), requestedPriority (enum: LOW/MEDIUM/HIGH), currentStatus (enum — Lab 2 only ever reaches `NEW`, so define the enum with just `NEW` for now; later labs will extend it with a new migration), createdAt, updatedAt.
- **Attachment**: id, ticketId (FK → Ticket), originalFilename (String), storedFilename (String, unique — e.g. UUID + extension), mimeType (String), sizeBytes (Int), isRemoved (Boolean, default false), removedAt (DateTime, nullable), removedReason (String, nullable), createdAt.

Required indexes (also in spec §7): `Requester.email` unique, `RelatedSystem.name` unique, `Ticket.ticketNumber` unique, `Ticket.requesterId` indexed (every ownership-scoped query filters on it), `Attachment.ticketId` indexed (attachment list is always fetched per ticket).

## Seed data (per Issue #12 acceptance + the course handout's §5.3)
Add to `server/prisma/seed.ts`, same upsert pattern as the existing Category block:
- **Related Systems** (≥6, upsert on `name`): use the handout's suggested list — Email, Campus Wi-Fi, VPN, LEB2 App, Grade Submission App, Printer, Corporate Laptop (7 total).
- **Requesters** (≥4 active + ≥1 inactive, upsert on `email`): realistic names/emails, at least one with `isActive: false`. The inactive one exists in the DB but must never appear in any "active requesters" query later (this issue doesn't build that query — just make sure `isActive: false` is actually set correctly on one row).
- Do NOT seed any Tickets or Attachments — no ticket-creation flow exists yet.

## What "done" looks like (Issue #12's stated acceptance criteria)
1. `npx prisma migrate dev` runs clean against an empty/fresh DB (you can verify by dropping and recreating, or just running it once cleanly here).
2. Re-running the seed script does NOT create duplicates (run it twice, confirm row counts are stable — e.g. via `npx prisma studio` is overkill, just query counts with a quick script or `docker exec` psql).
3. The inactive Requester row genuinely has `isActive: false` in the DB after seeding.
4. `cd server && npm run typecheck` passes.
5. `cd server && npm test` still passes (existing Lab 1 tests shouldn't break — you're only adding models, not touching Category or existing API routes).

## Boundaries
- Don't add any new Express routes, don't touch `server/src/app.ts`.
- Don't implement ticket-number generation (`TKT-{year}-{6-digit id}` format from BR-01) — that's Issue #15 (Create Ticket), not this one.
- Don't run `git commit`/`git push`/open a PR — leave the working tree as-is when you're done. I'll review the diff and handle git myself.

When done, report: the exact commands you ran (especially the migration name and any DB commands), confirmation of each acceptance criterion above, and anything ambiguous in the spec you had to make a judgment call on.
```

### A.2 `frontend-engineer` — Issue 13 (Zen Green theme, shell, routing)

The full brief is long; these are the parts that did the work. The complete text is in
the session transcript.

```text
You're implementing GitHub Issue #13 on the TokTickIT repo (student project, CPE334 course, `client/` is a Vite + React 19 + TypeScript app). [...] You are already on branch `feature/lab2-shell` [...] — do not create a new branch, just commit to this one.

Read `docs/lab-02/ui-spec.md` yourself in full for exact values — sections 1-5 are the ones in scope, but skim 6-9 too since later issues will consume the components you're building today, so don't paint yourself into a corner (e.g. Field needs to support the invalid/aria-describedby pattern described in §3 and §9 even though no form uses it yet).

## Critical constraints — read carefully

1. **Do NOT add a Requester-selection route guard, RequesterContext, or any "current Requester" data fetching in this PR.** That's a separate issue (#14, not yet started). [...] Coordinate the shell so it's trivial for Issue #14 to plug a real context in later, but don't build that context now.

2. **The existing Lab 1 "Check System" flow must keep working and must keep passing its existing tests, unmodified in behavior.** [...] Three test files depend on this rendering immediately when `<App />` is rendered directly [...] Read all three before touching anything so you know the exact assertions. You may restyle this screen with the new Zen Green components/CSS (drop the old inline `style={{}}` objects, drop the light/dark theme toggle — the sun/moon icon toggle is NOT part of the Zen Green spec, which is a single fixed palette, and no test asserts it exists, so removing it is correct, not a regression), but the heading text, button text, and role-based queries the tests use must keep working.

3. **Stub routes for the 4 Lab 2 screens** [...] Each stub page: minimal placeholder content ("This screen arrives in a later Lab 2 issue" style is fine), but should use the new Card/shell components so it's visually consistent, not a bare `<div>`.

4. **No commit attribution.** Do not add `Co-Authored-By`, `Claude`, or any AI-attribution trailer to commit messages [...]

5. **Reuse existing patterns.** [...] you're not required to add new tests for this issue since it's UI/theme scaffolding without new business logic, but you MAY add a minimal smoke test for the shell/routing if you think it adds real value — don't pad for the sake of it.

## Deliverables checklist
[...]
- [ ] `npm run typecheck`, `npm run lint`, and `npm test` all pass in `client/` (run all three yourself before considering this done — do not just claim it works)
- [ ] Commit the work with a clear, human-style commit message (no AI attribution), on the current branch `feature/lab2-shell`

Do not touch `server/` at all — this issue is client-only. Do not open a PR yourself; just get the branch into a clean, tested, committed state and report back what you built, which files you touched, and the exact typecheck/lint/test output. I will review your diff independently before anything gets pushed or a PR is opened, so be precise and honest about what actually passed vs. what you didn't get to.
```

> Worth noting for the reflection: constraint 2 in A.2 told the sub-agent to drop the
> light/dark theme toggle, on the reasoning that the Zen Green spec is a single fixed
> palette. That was later reversed — the toggle was restored in Issue 14's PR as a proper
> token-based dark theme after I asked where it had gone. The brief was followed exactly;
> the judgment inside it was wrong.
