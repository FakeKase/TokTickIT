# Peer Review — Lab 2

## My reviewer

The classmate who reviews my pull requests.

| Field | Value |
| :-: | :-: |
| Name | Jakkaphat Chalermphanaphan |
| Student ID | 67070501056 |
| GitHub username | [@gxjakkap](https://github.com/gxjakkap) |
| Repository reviewed | [FakeKase/TokTickIT](https://github.com/FakeKase/TokTickIT) |

Every Lab 2 pull request was reviewed by @gxjakkap. Twelve PRs, of which **nine came back
with changes requested** before approval and three were approved first time (#23, #25,
#27). Every one of those nine findings was a real defect, and none was a matter of taste.

Counts in this document were produced by querying the GitHub reviews API for each PR, not
by reading the table below and estimating.

### Pull requests they reviewed for me

| PR | Title | Rounds | Final |
| :-: | :-- | :-: | :-: |
| [#22](https://github.com/FakeKase/TokTickIT/pull/22) | Sprint specification, API/UI spec, test plan | 2 | Approved |
| [#23](https://github.com/FakeKase/TokTickIT/pull/23) | Database schema — Requester, Ticket, Attachment, RelatedSystem | 1 | Approved |
| [#24](https://github.com/FakeKase/TokTickIT/pull/24) | Zen Green theme, reusable components, router shell | 2 | Approved |
| [#25](https://github.com/FakeKase/TokTickIT/pull/25) | chore: gitignore local docker-compose overrides | 1 | Approved |
| [#26](https://github.com/FakeKase/TokTickIT/pull/26) | Requester selection and context, theme switch, wider layout | 2 | Approved |
| [#27](https://github.com/FakeKase/TokTickIT/pull/27) | chore: remove Lab 1 boilerplate stylesheets | 1 | Approved |
| [#28](https://github.com/FakeKase/TokTickIT/pull/28) | Create Ticket (API + UI + validation + attachments) | 2 | Approved |
| [#29](https://github.com/FakeKase/TokTickIT/pull/29) | My Tickets (search, filter, sort, pagination) | 2 | Approved |
| [#30](https://github.com/FakeKase/TokTickIT/pull/30) | Requester Ticket Detail (read-only) | 2 | Approved |
| [#31](https://github.com/FakeKase/TokTickIT/pull/31) | Attachments (download and soft removal) | 2 | Approved |
| [#32](https://github.com/FakeKase/TokTickIT/pull/32) | Responsive and visual QA | 2 | Approved |
| [#33](https://github.com/FakeKase/TokTickIT/pull/33) | End-to-end requester ticket flow test | 2 | Approved |

### Review comments I received, and how I responded

| PR | Their comment | My response |
| :-: | :-- | :-- |
| [#22](https://github.com/FakeKase/TokTickIT/pull/22) | *Changes requested:* the test plan didn't cover BR-14, BR-10/FR-06 or BR-22, and `api-spec.md` documented a `status` filter that no requirement asked for. | Added AC-27 + API-20 (Description bounds), AC-30 + API-23 (combined filters), AC-35 + API-28 (Ticket survives a failed attachment upload). Removed the undocumented `status` filter from `api-spec.md`, keeping `sortBy=currentStatus` since FR-07 requires sorting by status. While auditing I found six further business rules with no direct coverage and added AC-28/29/31/32/33/34 with tests API-21/22/24/25/26/27. |
| [#24](https://github.com/FakeKase/TokTickIT/pull/24) | *Changes requested:* the mobile header didn't stay a fixed height when the hamburger nav opened — the open menu pushed onto a second row. | Confirmed the bug directly in the CSS. Made the open menu an absolutely-positioned dropdown anchored to the header rather than an inline flex item, so it never affects the header's box. Header stays 64px on toggle. |
| [#26](https://github.com/FakeKase/TokTickIT/pull/26) | *Changes requested:* the theme flashed light before dark on every load, because `ThemeProvider` stamped `data-theme` from a `useEffect` that runs after first paint. Also, `ui-spec.md` §6.1 hadn't been updated for the two-sentence explanation text. | Both correct, and the comment I had written on that effect was wrong. `main.tsx` is a module script, so React doesn't mount until after the first paint — nothing on the React side could have fixed it. Added a parser-blocking inline script in `index.html` and switched the provider to `useLayoutEffect`. Added UI-19, which executes the real inline script out of `index.html` and asserts it agrees with `initialTheme()`. Updated §6.1. |
| [#28](https://github.com/FakeKase/TokTickIT/pull/28) | *Changes requested:* the 5-attachment cap had a race, and the comment justifying it was wrong — `$transaction` runs at READ COMMITTED, so count-then-insert doesn't block a second transaction. He also noted the test uploaded six files sequentially, so it could never have caught it. | Both right. Reproduced the race first: six overlapping uploads stored 6 attachments on a Ticket capped at 5. Locked the Ticket row `FOR UPDATE` before counting. His point about the test was the more useful half — added a case that fires six uploads at once, and verified it fails 3/3 without the lock. |
| [#29](https://github.com/FakeKase/TokTickIT/pull/29) | *Changes requested:* AC-16 was named in a describe block that never sorted by Requested Priority, and the sort only worked because of the Postgres enum declaration order, which nothing guarded. Separately, mobile had no way to change sort at all, since the table holding the sort headers is hidden under 768px. | Both right, and the first was hiding a third problem: AC-16 requires **Created Date** as the tie-break and my `orderBy` used only `id`. Every fixture had `createdAt` ascending in step with `id`, so the two were identical on that data and nothing failed. Added a backdated fixture so they diverge, fixed the `orderBy`, and verified the tie-break test fails against the old ordering. Added a sort control outside the table for mobile (UI-21). |
| [#30](https://github.com/FakeKase/TokTickIT/pull/30) | *Changes requested:* Ticket Detail distinguished a 404 by regex-matching the error *message*, not the status, because `ApiError` never carried one — and the test hardcoded the same string the server did, so it checked the client against itself. | Right on both. `ApiError` now carries the HTTP status and the page branches on `status === 404`. Added two tests covering the seam in both directions — a 404 worded differently still shows not-found with no Retry, and a 500 containing "not found" stays retryable — and verified both fail against the old logic. |
| [#31](https://github.com/FakeKase/TokTickIT/pull/31) | *Changes requested:* soft removal had the same race as #28, unfixed here — read, check `isRemoved`, then update, with no transaction and no guard on the update's `where`. | Right, and the #28 fix hadn't generalised. Reproduced it: three overlapping deletes returned `[200, 200, 409]`, with the second write overwriting the first's reason. The update now guards on `isRemoved: false` in its own `WHERE`. Audited every other read-then-write in `app.ts` rather than wait for a third instance. |
| [#32](https://github.com/FakeKase/TokTickIT/pull/32) | *Changes requested:* the success-path e2e test submits a real Ticket through the form, and its description didn't carry the marker the cleanup script filters on — so it leaked into the database on every run, the exact problem that script exists to prevent. | Counted before fixing: five had accumulated, one per run. The marker is now exported once and used by every path that creates a Ticket. Since the failure was that nothing connected the two sides, added `cleanup-contract.spec.ts`, which asserts the cleanup script's `MARKER` still equals the suite's and that every description fill goes through it. |
| [#33](https://github.com/FakeKase/TokTickIT/pull/33) | *Changes requested:* the empty-state test resolved an "empty" Requester before creating a Ticket for the first one — and on a clean database, or when run alone under `--grep`, those are the same person. The full suite only passed because an earlier test in the file happened to run first. | Reproduced by running the test alone, where it failed. Moved the ticket creation before the lookup. His observation that this was incidental file ordering was the part worth acting on, so I ran all 22 specs individually; all 22 pass alone, so nothing else is leaning on a neighbour for its state. |

**The pattern across these.** Of the nine findings, **six included a point that the test
could not have failed for the reason it claimed to check** — the attachment-cap race and
the soft-removal race both covered by sequential tests (#28, #31), an AC named in a
describe block that never exercised it (#29), a test comparing the client to itself
(#30), a cleanup script leaking around itself (#32), and a spec depending on file order
(#33). Two were purely code defects: the mobile header height (#24) and the theme flash
(#26). One was a test-plan coverage gap found before any code existed (#22).

So in two thirds of the rounds the implementation was defensible and the evidence for it
was not. That is the single most useful thing this review relationship produced, and it
is the reason the Definition of Done in `specification.md` §10 now records *how* each item
was verified rather than only that it was.

## Reviews I gave

Pull requests I reviewed for my partner.

| Field | Value |
| :-: | :-: |
| Author name | Jakkaphat Chalermphanaphan |
| Student ID | 67070501056 |
| GitHub username | [@gxjakkap](https://github.com/gxjakkap) |
| Repository | [gxjakkap/soften-toktickit](https://github.com/gxjakkap/soften-toktickit) |

Eight pull requests, of which **three came back with changes requested** before approval
(#28, #29, #32) and five were approved first time. Each review was written after reading
the diff against his own `specification.md` and `api-spec.md`, rather than against his PR
description.

| PR | Title | My comment | How they responded |
| :-: | :-- | :-- | :-- |
| [#25](https://github.com/gxjakkap/soften-toktickit/pull/25) | Development requester context and selection screen | "LGTM! everything works just fine sub" — reviewed the context, the selection screen and the route guard; found nothing to raise. | No changes needed. |
| [#26](https://github.com/gxjakkap/soften-toktickit/pull/26) | Ticket, Attachment and RelatedSystem schema | "Valid! Approve kub" — checked the schema against his `specification.md` §7.2/§7.4/§11 field by field, and the integration tests against real Postgres constraint violations. | No changes needed. |
| [#27](https://github.com/gxjakkap/soften-toktickit/pull/27) | Ticket creation API and active-only reference-data endpoints | "LGTM kubbbb". I investigated one suspected bug — an unguarded `req.body.summary` — and traced the code path to confirm the requester-context check always runs first and short-circuits, so it was not reachable. Reported nothing rather than raise a false positive. | No changes needed. |
| [#28](https://github.com/gxjakkap/soften-toktickit/pull/28) | Create Ticket screen with attachment dropzone and clipboard paste | *Changes requested,* five points: system-generated fields rendered in the *Disabled* visual state instead of *Read-only*, contradicting his `ui-spec.md` §3; `tests.md` not updated, so 13 implemented rows still said `Planned`; the 201 response returned the raw Prisma row, leaking `storedFileName`; the 5-attachment cap was check-then-insert; and an uploaded file could be orphaned on disk if the insert threw. | Fixed all five, going further than asked on the last two. Verified each fix myself rather than trusting the commit message. |
| [#29](https://github.com/gxjakkap/soften-toktickit/pull/29) | My Tickets screen and ticket-list API | *Changes requested,* three points: seeded Ticket Numbers (`TKT-SEED-…`) violated his own BR-06 format, and those are the rows every My Tickets screenshot would show; `categoryRows[index]` depended on `findMany` order that Postgres does not guarantee, so a reseed could silently reassign categories; and `api-spec.md` §5 and the implementation disagreed on how an unknown `categoryId` should fail. | Fixed all three. For the third he chose to fix the code rather than the spec. Approving, I noted that his fix for the first introduced a new idempotency issue — the upsert key now takes its year from `Date.now()`, so two seed runs either side of New Year produce duplicates — flagged as non-blocking since it cannot bite before submission. |
| [#30](https://github.com/gxjakkap/soften-toktickit/pull/30) | Requester Ticket Detail and attachment lifecycle | Approved. Checked the security-shaped parts specifically: ownership runs before the 410 so a non-owner still gets a plain 404; the id guards stop `Number('abc')` reaching Prisma; the `Content-Disposition` strip closes header injection. Raised one non-blocking nit — non-ASCII filenames are not RFC 6266 encoded, so a Thai filename downloads mangled. | Noted. |
| [#31](https://github.com/gxjakkap/soften-toktickit/pull/31) | Zen Green styling, badges and responsive nav audit | Approved after opening the screenshots rather than only reading the CSS — the tablet table renders without clipping, mobile drops to cards, and both of my earlier findings were visibly fixed in his evidence. Noted that the PR also moved Create Ticket's whole post-submit upload path, which is a functional refactor inside a styling audit. | Noted. |
| [#32](https://github.com/gxjakkap/soften-toktickit/pull/32) | Consolidated test suite, traceability and screenshot audit | *Changes requested:* the PR claimed AC-25 now had automated evidence via a `document.body.scrollWidth` assertion, but there was exactly one such assertion in the whole e2e tree and it ran only on Create Ticket. `tests.md` STYLE-03 stated "no horizontal scroll" for My Tickets — the seven-column table, the screen most likely to overflow — and marked it Pass. | Factored the check into a helper called after all three navigations and updated `tests.md` to match the code. Approving, I raised two non-blocking notes on his new `ai_use.md`: the filename uses an underscore where handout §12's tree specifies a hyphen, and there is no closing "My Reflection" section as Part 4 requires. |

**How these reviews were done.** Each one started by checking out his branch and reading
the code against his own specification documents, not against mine — our specs differ in
places, and a finding is only worth raising if it contradicts the contract he wrote. Two
of the eight involved running or simulating something to avoid guessing: an Express
body-parser test to settle whether an unguarded field was reachable on #27, and a
simulation of the seed's upsert keys across a year boundary on #29.
