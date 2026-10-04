# Lab 3 Test Plan and Results

## 1. Test Strategy

Tests are planned from `specification.md`'s FR/BR/AC **before** implementation (Test DD), then
written to fail first and implemented against until green (TDD), one Issue at a time. This
document is written in Issue #37, before any Lab 3 implementation PR opens; each later PR flips
its own rows from Planned to Pass. It is not reconstructed afterwards from whatever the coding
agent produced.

Levels: unit, API/integration, UI component, UI style and responsive, security/authorization,
migration/regression, and end-to-end — the handout's full minimum.

Where a rule is a security boundary, the test that proves it calls the API directly. A UI test
that finds no "Internal Notes" heading proves the heading is absent, not that the data is
unreachable; only `GET /api/tickets/:id/comments` as a Requester proves BR-04. UI tests cover the
corresponding screen states, and nothing about authorization rests on them alone.

Server tests use Supertest against `createApp()` with a real PostgreSQL database and a
per-file fixture user set. Client tests use Vitest and Testing Library with
`vi.spyOn(globalThis, 'fetch')`. E2E tests use Playwright against a running dev stack, signing in
through the real Login screen rather than by injecting a cookie — the login path is part of what
is under test.

## 2. Planned Tests

### Unit

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| UNIT-01 | Unit | BR-07 | Password hash and verify helper | A hash never equals the plaintext; verify accepts the right password and rejects a wrong one; two hashes of the same password differ (salted) | `server/tests/lab-03/password.unit.test.ts` | Pass |
| UNIT-02 | Unit | BR-09, BR-11 | Session token and expiry helper | Token is 32 random bytes, never repeats across 1000 draws; expiry is exactly 8 hours ahead; an expired row is reported expired | `server/tests/lab-03/session.unit.test.ts` | Pass |
| UNIT-03 | Unit | BR-22, BR-23 | Status transition matrix helper | Every cell of §5.2 permitted; every other pair rejected; Resolved/Closed rejected without an owner | `server/tests/lab-03/status-transitions.unit.test.ts` | Planned |
| UNIT-04 | Unit | BR-13, BR-37 | Password validation | At least 8 characters and at most 72 UTF-8 bytes, both bounds inclusive, with Thai and emoji inputs that `.length` would wave through; new ≠ current; confirmation mismatch reported on the confirmation field | `server/tests/lab-03/password.unit.test.ts` | Pass |
| UNIT-06 | Unit | BR-37 | User field validation | Name 2–80, email ≤120 and syntactically valid | `server/tests/lab-03/user-validation.unit.test.ts` | Planned (Issue #45) |
| UNIT-05 | Unit | BR-30, BR-31, AC-26 | Queue query parser | Defaults `updatedAt` desc, page 1, size 10; out-of-range values clamped and non-numeric ones defaulted, never rejected; unknown sort key, status, priority or owner dropped; `requestedPriority` is not a queue sort key although the two parsers share a file; `filtered` is true only for a filter that survived parsing | `server/tests/lab-03/staff-queue.unit.test.ts` | Pass |

### API — authentication

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| API-01 | API | AC-01 | Valid login | Authenticated response; safe user data; session cookie set `HttpOnly`; no `passwordHash` in the body | `server/tests/lab-03/auth.api.test.ts` | Pass |
| API-46 | API | BR-39, AC-01 | Seeded credentials match the README | Every account in the README's table signs in (or is refused, for the inactive one) with the documented password, and the first-login flag matches what the table claims | `server/tests/lab-03/seed-credentials.api.test.ts` | Pass |
| API-02 | API | AC-06, BR-08 | Wrong password vs unknown email | Both `401` with byte-identical bodies; no session created | `server/tests/lab-03/auth.api.test.ts` | Pass |
| API-03 | API | AC-05, BR-01 | Inactive account with the correct password | `401`, same body as API-02; no session created | `server/tests/lab-03/auth.api.test.ts` | Pass |
| API-04 | API | AC-08, BR-10 | Logout then reuse the cookie | Logout `204`; the session row is gone; the same cookie then returns `401` | `server/tests/lab-03/auth.api.test.ts` | Pass |
| API-05 | API | AC-09, BR-11 | Expired session | A session backdated past its expiry is treated as unauthenticated and the row is removed | `server/tests/lab-03/auth.api.test.ts` | Pass |
| API-06 | API | AC-11, BR-13 | Change-password validation | Too short, mismatched confirmation, and same-as-current each `400`; the flag stays set | `server/tests/lab-03/auth.api.test.ts` | Pass |
| API-07 | API | AC-12 | Change password successfully | `200`, `mustChangePassword` false; the old password then fails and the new one works | `server/tests/lab-03/auth.api.test.ts` | Pass |

### API — authorization, comments and notes

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| API-08 | API | AC-04, BR-29 | Requester requests Internal Notes | Forbidden; no note data returned; the same call as IT Staff returns the notes, proving they exist | `server/tests/lab-03/comments-notes.api.test.ts` | Planned |
| API-09 | API | AC-02, BR-14 | Password-change gate | With `mustChangePassword` set, every endpoint except me/change-password/logout returns `403 PASSWORD_CHANGE_REQUIRED` | `server/tests/lab-03/authorization.api.test.ts` | Pass |
| API-10 | API | AC-03, BR-03 | Spoofed `requesterId` | Supplying another user's id in the body or query changes nothing; the session's identity is used | `server/tests/lab-03/authorization.api.test.ts` | Pass |
| API-11 | API | AC-14, BR-16 | Role refusal across the Requester boundary | IT Staff are refused a Requester route with `403` and no data, and a Requester is refused the staff queue the same way (`staff-queue.api.test.ts`, Issue #43). The Administrator namespace lands with its endpoints in Issue #45; the guard itself is covered by the probe router | `server/tests/lab-03/authorization.api.test.ts` | Partial |
| API-12 | API | AC-17, BR-18 | Another Requester's Ticket, Attachment, download and removal | All four `404`, and the Attachment's body byte-identical to a nonexistent id. Lab 2's `attachments.api.test.ts` covers the same rules from the owner's side | `server/tests/lab-03/authorization.api.test.ts` | Pass |
| API-13 | API | AC-10, BR-12 | Session of a deactivated user | The next request after deactivation is `401`, on a converted Lab 2 endpoint as well as the probe | `server/tests/lab-03/authorization.api.test.ts` | Pass |
| API-14 | API | AC-15, BR-40 | Migration regression, API half | An account carried through the rename signs in with the documented password, lists its Ticket, opens it, and downloads an Attachment the test uploads itself. It does **not** distinguish a migrated row from a seeded one — the seed upserts these accounts on every run — so the migration itself is proved by `npm run db:migration-check`, on a throwaway database, and this row covers only that the authenticated API serves a carried-over account | `server/tests/lab-03/authorization.api.test.ts` | Pass |
| API-15 | API | AC-21, BR-05 | Requester attempts a status change | `403`; status unchanged | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-16 | API | AC-18, BR-27 | Post a Public Comment | `201`; author and timestamp come from the server even when the body supplies others; visible to IT Staff | `server/tests/lab-03/comments-notes.api.test.ts` | Pass |
| API-17 | API | AC-19, BR-25 | Empty and whitespace-only bodies, and one over 2000 characters | `400`; nothing stored | `server/tests/lab-03/comments-notes.api.test.ts` | Pass |
| API-18 | API | AC-34, BR-04 | Visibility filtering | A Requester's comment list contains the public entries and no trace of the internal ones — not a redacted entry, not a count | `server/tests/lab-03/comments-notes.api.test.ts` | Pass |
| API-19 | API | BR-04, BR-16 | Requester posts with `visibility: INTERNAL` | `403`; nothing stored | `server/tests/lab-03/comments-notes.api.test.ts` | Pass |
| API-20 | API | AC-20, BR-24 | Problem appears resolved | `200`; `requesterResolvedAt` set; `currentStatus` unchanged; an accompanying Public Comment exists. A second signal is `409` and writes no duplicate; the first timestamp does not move when one is refused; and a comment write that fails inside the transaction leaves neither the timestamp nor the comment | `server/tests/lab-03/comments-notes.api.test.ts` | Pass |

### API — IT Staff queue and detail

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| API-21 | API | AC-22, FR-13, AC-14 | Queue lists every Requester's Tickets | Tickets from two Requesters, each with owner (or `null`), status, and both priorities; names only, no email address or hash in the response. A Requester is refused `403` with no data, an anonymous caller `401`, staff at the first-login gate `403`, and an Administrator is served | `server/tests/lab-03/staff-queue.api.test.ts` | Pass |
| API-22 | API | AC-23, BR-30 | Search | Matches Ticket Number and Summary, partially and case-insensitively. No match is `200` with empty `data`, `totalItems: 0` and `filtered: true`; an unfiltered request, and one whose only filters were unrecognised, report `filtered: false` | `server/tests/lab-03/staff-queue.api.test.ts` | Pass |
| API-23 | API | AC-24, BR-30 | Status and IT Priority filters combined | Only Tickets matching both are returned, with a fixture that matches each alone to prove it is an AND; each filter also works alone, as does Category; unrecognised values are ignored | `server/tests/lab-03/staff-queue.api.test.ts` | Pass |
| API-24 | API | AC-25, BR-31 | Sorting | Default is Last Updated descending. IT Priority descending is Urgent → High → Medium → Low with ties by Last Updated descending, and the tie-break stays descending when the sort ascends. Status sorts in workflow order. Two Tickets updated in the same instant come back by id descending. The fixtures' Last Updated order deliberately differs from their id order, so dropping either tie-break changes the result | `server/tests/lab-03/staff-queue.api.test.ts` | Pass |
| API-25 | API | AC-26, BR-30 | Invalid pagination parameters | Paging neither repeats nor drops a Ticket. `page` below 1 or non-numeric becomes 1; a page past the end is served as the last real page with its rows, and `pagination.page` says so; `pageSize` is clamped into 1–50 and defaults when non-numeric | `server/tests/lab-03/staff-queue.api.test.ts` | Pass |
| API-26 | API | BR-30 | The owner filter | `me`, `unassigned` and a user id each return exactly the matching set; `me` is resolved from the session, so the same query returns a different set for a different caller; any other value is ignored | `server/tests/lab-03/staff-queue.api.test.ts` | Pass |
| API-27 | API | AC-27, BR-20 | Claim an unassigned Ticket | `200`; the acting user is the owner; `updatedAt` advances | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-28 | API | AC-28, BR-20 | Reassign to another active IT Staff user | `200`; ownership moves | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-29 | API | AC-29, BR-19 | Assign a Requester, and an inactive staff user | `409` for both; ownership unchanged | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-30 | API | AC-30, BR-21 | Set IT Priority | `200`; `requestedPriority` untouched | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-31 | API | AC-31, BR-22 | Illegal transition (In Progress → Closed) | `409`; status unchanged; nothing written | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-32 | API | AC-32, BR-22 | Legal transition (In Progress → Resolved, owned) | `200`; status updated | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-33 | API | AC-33, BR-23 | Resolve an unassigned Ticket | `409`; status unchanged | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-34 | API | FR-15, BR-19 | Assignable-user list | Active IT Staff and Administrators only; no Requester, no inactive user | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |

### API — Administrator user management

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| API-35 | API | AC-35, FR-20 | List users | Every user with name, email, role, status; no `passwordHash` on any row | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-36 | API | AC-36, BR-38 | Search and role filter | Partial case-insensitive match on name and email; role filter narrows correctly; the two combine | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-37 | API | AC-37, FR-22 | Create a user | `201`; `mustChangePassword` true; the new account can log in once with the initial password | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-38 | API | AC-38, BR-34 | Duplicate email on create and on edit | `409` both times; nothing written; comparison is case-insensitive | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-39 | API | FR-23 | Edit name, email, role, activation | `200`; each field updated; role change takes effect on the user's next request | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-40 | API | AC-39, BR-32 | Administrator deactivates themselves | `409`; account still active | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-41 | API | AC-40, BR-33 | Last active Administrator deactivated or demoted | `409` for both; with a second Administrator present, both succeed | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-42 | API | AC-41, BR-36 | Set a new initial password | `200`; the old password fails; the new one works and demands a change; existing sessions are gone | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-43 | API | BR-35 | No delete endpoint | `DELETE /api/users/:id` returns `404`/`405`, never removes a row | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-44 | API | AC-44, BR-17 | Safe errors across the surface | No response body contains a stack trace, SQL fragment, hash, or internal identifier | `server/tests/lab-03/authorization.api.test.ts` | Partial — the unhandled-rejection path is covered; the rest lands with each Issue's endpoints |
| API-45 | API | AC-45, BR-18 | Staff attachment access | IT Staff read and download an Attachment on a Ticket they do not own (`200`); upload and removal are `403`; a removed Attachment is still `404` for staff | `server/tests/lab-03/authorization.api.test.ts` | Planned |

### UI component

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| UI-01 | UI | AC-01, FR-01 | Login submits and stores identity | Valid submission calls the API once and routes to the role's landing screen | `client/tests/lab-03/Login.test.tsx` | Pass |
| UI-02 | UI | AC-06, BR-08 | Login failure message | A `401` renders one generic alert; nothing indicates which field or account state was wrong | `client/tests/lab-03/Login.test.tsx` | Pass |
| UI-03 | UI | AC-07 | Login busy state | The submit control is disabled and labelled while the request is in flight; a second click sends nothing | `client/tests/lab-03/Login.test.tsx` | Pass |
| UI-04 | UI | AC-44 | Login API failure | An unreachable API renders a safe failure with no internal detail | `client/tests/lab-03/Login.test.tsx` | Pass |
| UI-05 | UI | AC-02 | Password-change gate in the router | A user with `mustChangePassword` is redirected from every route to Change Password | `client/tests/lab-03/ChangePassword.test.tsx` | Pass |
| UI-06 | UI | AC-11 | Password-change validation | Short password, mismatched confirmation, and same-as-current each show a field-level message and send nothing | `client/tests/lab-03/ChangePassword.test.tsx` | Pass |
| UI-07 | UI | AC-12 | Password-change success | Success routes into the application and the gate no longer fires | `client/tests/lab-03/ChangePassword.test.tsx` | Pass |
| UI-08 | UI | AC-13, FR-05 | Role-specific navigation | Requester, IT Staff, and Administrator each see only their permitted destinations; the name and role badge render; Logout is present | `client/tests/lab-03/AppShellAuth.test.tsx` | Pass |
| UI-09 | UI | AC-08 | Logout from the shell | Logout calls the API and returns to Login; a protected route afterwards shows Login | `client/tests/lab-03/AppShellAuth.test.tsx` | Pass |
| UI-10 | UI | AC-22, FR-13 | Queue renders rows | Ticket Number linking to the detail route, Summary, Category, both priorities each under its own header, status as words, owner or "Unassigned", and Last Updated as a distance with the full time behind it. No Requester column. The default request carries sort and page only | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Pass |
| UI-11 | UI | AC-23 | Queue empty vs no-results | Different copy and different actions: Empty hides the controls and offers nothing to clear; No-Results keeps them and its Clear filters refetches unfiltered | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Pass |
| UI-12 | UI | AC-24, AC-26 | Queue filters, sorting and paging | Each filter refetches with the right query, and two together send both; search applies on submit, trimmed; Clear filters appears only while one is active; headers sort and reverse; Created Date is offered as a sort without a column; a filter change returns to page 1; paging stops at both ends. Search text typed but not submitted is applied with the next change, sends paging back to page 1, and is emptied by Clear filters. A new sort key starts descending from the select as from a header. The view is restored from the URL, written back to it, ignores values it does not recognise, and is corrected when the server clamps the page | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Pass |
| UI-13 | UI | AC-44, AC-14 | Queue failure, forbidden and loading | A failed load renders a safe failure that repeats nothing the server said, with a Retry that refetches; an unreachable API fails the same way; a `403` shows Forbidden with a way onward and no Retry; a Requester never triggers the request at all; loading is announced; and an older response landing late does not overwrite a newer one | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Pass |
| UI-14 | UI | AC-27, AC-28 | Ownership controls | Claim appears when unassigned; reassign lists only assignable users; both send the documented request | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
| UI-15 | UI | AC-30, AC-31 | Priority and status controls | The status select offers only permitted transitions; a rejected transition shows the conflict message and reverts the control | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
| UI-16 | UI | BR-04, ui-spec §5 | Two conversation streams | Public and internal composers are separate controls with distinct labels; posting through one never sends the other's visibility | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
| UI-17 | UI | AC-34, AC-18, AC-20 | Requester Ticket Detail thread and resolved signal | Each entry shows its author, role and time; posting trims and clears only on success; a failed post keeps the text; no edit or delete control exists; nothing mentions Internal Notes; the signal confirms first, survives a reload, and is absent on a finished Ticket; a refused signal (`409`) reloads the Ticket instead of offering a Retry, so the screen ends up showing what the server actually holds; and the "IT Staff will confirm" promise disappears once the Ticket is settled | `client/tests/lab-03/RequesterComments.test.tsx` | Pass |
| UI-18 | UI | AC-35, AC-36 | User list, search, role filter | Rows show Name, Email, Role, Status, Edit; search and filter refetch with the right query | `client/tests/lab-03/UserManagement.test.tsx` | Planned |
| UI-19 | UI | AC-37 | Create-user dialog | Validates name, email, role, and initial password before sending; sends once | `client/tests/lab-03/UserManagement.test.tsx` | Planned |
| UI-20 | UI | AC-38 | Duplicate email | A `409` attaches its message to the email field, not to a page-level banner | `client/tests/lab-03/UserManagement.test.tsx` | Planned |
| UI-21 | UI | AC-39, AC-40 | Guard-rails | Self-deactivation and last-Administrator controls are disabled with a visible reason | `client/tests/lab-03/UserManagement.test.tsx` | Planned |
| UI-22 | UI | AC-41 | Set a new initial password | Confirmation step, then one request; success feedback states that the user must change it at next login | `client/tests/lab-03/UserManagement.test.tsx` | Planned |

### Responsive, style, and end-to-end

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| RESP-01 | Style | AC-42, ui-spec §10 | No horizontal overflow | Login, Change Password, Queue, Staff Detail, and User Management at 375/820/1280px, with the offending element named on failure | `e2e/lab-03/visual-regression.spec.ts` | Planned |
| RESP-02 | Style | ui-spec §3 | Editable vs read-only on Staff Detail | Computed background colours of the workflow panel and the ticket header differ | `e2e/lab-03/visual-regression.spec.ts` | Planned |
| RESP-03 | Style | ui-spec §3, §5 | Public vs internal streams | Computed background colours differ, not only the headings | `e2e/lab-03/visual-regression.spec.ts` | Planned |
| RESP-04 | Style | ui-spec §3 | Badge families | Status, IT Priority, and Role badges are mutually distinct by computed colour, and each carries a text label | `e2e/lab-03/visual-regression.spec.ts` | Planned |
| RESP-05 | Style | AC-43 | Focus visibility and dialog focus trap | Every interactive control shows a focus ring; the user dialog traps focus and restores it on close | `e2e/lab-03/visual-regression.spec.ts` | Planned |
| E2E-01 | E2E | AC-01, AC-06, AC-08 | Login, wrong password, logout, direct access blocked | Valid login enters the app; a wrong password shows the generic message; after logout a protected URL returns to Login | `e2e/lab-03/authentication.spec.ts` | Planned |
| E2E-02 | E2E | AC-02 | Initial password login and change | Normal app opens only after a valid change; the old password then fails | `e2e/lab-03/authentication.spec.ts` | Planned |
| E2E-03 | E2E | AC-27, AC-30, AC-32, AC-34 | IT Staff workflow | Sign in, find a Ticket in the queue, open it, claim it, set IT Priority, move the status, post a public comment and an internal note | `e2e/lab-03/staff-ticket-flow.spec.ts` | Planned |
| E2E-04 | E2E | AC-18, AC-20, AC-34 | Requester regression and visibility | The Requester sees their Lab 2 Tickets, posts a comment, indicates the problem appears resolved, and never sees the internal note left in E2E-03 | `e2e/lab-03/staff-ticket-flow.spec.ts` | Planned |
| E2E-05 | E2E | AC-35, AC-37, AC-41 | User administration | Administrator creates a user, that user signs in with the initial password, is forced to change it, and lands on the right screen for their role | `e2e/lab-03/user-administration.spec.ts` | Planned |
| E2E-06 | E2E | AC-39, AC-40 | Administrator guard-rails | Self-deactivation and last-Administrator deactivation are both refused, in the UI and through the API | `e2e/lab-03/user-administration.spec.ts` | Planned |

## 3. Acceptance-Criterion Traceability

| AC | Covered by |
| --- | --- |
| AC-01 | API-01, UI-01, E2E-01 |
| AC-02 | API-09, UI-05, E2E-02 |
| AC-03 | API-10 |
| AC-04 | API-08 |
| AC-05 | API-03 |
| AC-06 | API-02, UI-02, E2E-01 |
| AC-07 | UI-03 |
| AC-08 | API-04, UI-09, E2E-01 |
| AC-09 | API-05, UNIT-02 |
| AC-10 | API-13 |
| AC-11 | API-06, UI-06, UNIT-04 |
| AC-12 | API-07, UI-07, E2E-02 |
| AC-13 | UI-08 |
| AC-14 | API-11 |
| AC-15 | API-14 |
| AC-16 | API-10 |
| AC-17 | API-12 |
| AC-18 | API-16, E2E-04 |
| AC-19 | API-17 |
| AC-20 | API-20, E2E-04 |
| AC-21 | API-15 |
| AC-22 | API-21, UI-10, E2E-03 |
| AC-23 | API-22, UI-11 |
| AC-24 | API-23, UI-12 |
| AC-25 | API-24 |
| AC-26 | API-25, UNIT-05, UI-12 |
| AC-27 | API-27, UI-14, E2E-03 |
| AC-28 | API-28, UI-14 |
| AC-29 | API-29, API-34 |
| AC-30 | API-30, UI-15, E2E-03 |
| AC-31 | API-31, UI-15, UNIT-03 |
| AC-32 | API-32, UNIT-03, E2E-03 |
| AC-33 | API-33, UNIT-03 |
| AC-34 | API-18, UI-17, E2E-04 |
| AC-35 | API-35, UI-18, E2E-05 |
| AC-36 | API-36, UI-18 |
| AC-37 | API-37, UI-19, E2E-05 |
| AC-38 | API-38, UI-20 |
| AC-39 | API-40, UI-21, E2E-06 |
| AC-40 | API-41, UI-21, E2E-06 |
| AC-41 | API-42, UI-22, E2E-05 |
| AC-42 | RESP-01 |
| AC-43 | RESP-05, UI-21 |
| AC-44 | API-44, UI-04, UI-13 |
| AC-45 | API-45 |

Every AC has at least one test, and every test names a file that will exist. Rows are flipped from
Planned to Pass by the PR that implements them, never in advance.

## 4. Responsive and Visual Checklist

The checklist itself lives in `ui-spec.md` §10, where each box names the assertion that backs it.
It is completed in Issue #47 and its result recorded here.

## 5. Test Commands

```bash
cd server && npm run db:migration-check   # proves Lab 2 data survives the Lab 3 migration
cd server && npm test    # unit + API tests (server/tests/lab-03/*, plus lab-01 and lab-02)
cd client && npm test    # UI component tests (client/tests/lab-03/*)
npm run e2e              # responsive/visual and end-to-end specs (starts the API and client itself)
npm run typecheck        # root: e2e/ and playwright.config.ts
```

The Lab 2 cleanup contract still applies: every Ticket an E2E spec creates carries the marker the
global teardown filters on, and `cleanup-contract.spec.ts` fails if a creating path stops carrying
it. Lab 3 adds users to that contract — accounts created by `user-administration.spec.ts` are
deactivated and removed by the same teardown, so repeated runs do not silently grow the user list.

## 6. Final Results

Updated as each Issue's PR lands in `lab3-staging`; a full final run is recorded here once
`lab3-staging` merges to `main`.

| Issue | Suite | Result |
| --- | --- | --- |
| 37 — Sprint 3 contract | `npm run typecheck` | Passed |
| 38 — User model and migration | `cd server && npm run db:migration-check` | 11 checks passed |
| 38 — User model and migration | `cd server && npm test` | 10 files, 117 tests passed |
| 38 — User model and migration | `cd client && npm test` | 12 files, 111 tests passed |
| 38 — User model and migration | `npm run e2e` | 29 specs passed |
| 39 — Authentication API | `cd server && npm test` | 15 files, 164 tests passed |
| 39 — Authentication API | `cd client && npm test` | 12 files, 111 tests passed |
| 39 — Authentication API | `npm run e2e` | 29 specs passed |
| 40 — Login, password change, app shell | `cd server && npm test` | 15 files, 164 tests passed |
| 40 — Login, password change, app shell | `cd client && npm test` | 13 files, 120 tests passed |
| 40 — Login, password change, app shell | `npm run e2e` | 27 specs passed |
| 41 — Requester regression | `cd server && npm test` | 14 files, 165 tests passed |
| 41 — Requester regression | `cd client && npm test` | 13 files, 121 tests passed |
| 41 — Requester regression | `npm run e2e` | 27 specs passed |
| 42 — Public Comments and resolved signal | `cd server && npm test` | 15 files, 185 tests passed |
| 42 — Public Comments and resolved signal | `cd client && npm test` | 14 files, 137 tests passed |
| 42 — Public Comments and resolved signal | `npm run e2e` | 27 specs passed |
| 43 — IT Staff Ticket Queue | `cd server && npm test` | 17 files, 227 tests passed |
| 43 — IT Staff Ticket Queue | `cd client && npm test` | 15 files, 174 tests passed |
| 43 — IT Staff Ticket Queue | `npm run e2e` | 27 specs passed |

## 7. Known Limitations or Deferred Tests

- No load or performance testing of the queue at scale — out of scope, as in Lab 2.
- No automated cross-browser matrix; Playwright runs on Chromium only.
- Password hashing cost is not benchmarked; cost 10 is taken as the documented default rather than tuned.
- Rate limiting and account lockout after repeated failed logins are not implemented, and therefore not tested: the handout excludes account unlocking and advanced identity management. This is a known gap, recorded here rather than left to be discovered.
- The dark appearance is asserted at the `data-theme` level, as in Lab 2, not by computed contrast ratio.
- **`GET /api/requesters` and its test file are gone with the selector** (Issue #41). The endpoint existed to populate a screen that no longer exists, and listing people is an Administrator capability from Issue #45 onward. `requesters.api.test.ts` (6 tests) went with it, and the e2e helpers name the seeded Requesters directly rather than discovering them.
- **Three Lab 2 create-ticket cases were replaced rather than deleted.** "Inactive requesterId", "non-Requester requesterId" and "unknown requesterId" tested a field the client can no longer send. Each moved to the layer that now answers it: an inactive account cannot obtain a session (API-03), a staff account is refused by role, and a supplied id is ignored (API-10, AC-03).
- A Lab 2 client test asserted the Requester Ticket Detail screen showed no comments at all, which handout §4.2 put out of scope for that sprint. Issue #42 adds them, so the test now asserts the boundary that still holds: no Internal Notes, no Actions Taken, and no control that changes status.
- A session that expires mid-use now sends the person to Login rather than leaving them on a failure state: `apiFetch` reports any 401 from a protected endpoint to `AuthProvider`, which clears the session and lets the route guards do the rest (Issue #41). The auth endpoints are excluded, because a 401 from `login` is a wrong password and a 401 from `me` is an ordinary anonymous visitor. The exclusion is pinned by `ChangePassword.test.tsx`'s wrong-current-password case, which is the only place it can be: on Login the user is already anonymous, so clearing the session there changes nothing and a test cannot tell the difference.
- **Lab 2's e2e coverage of the Development Requester selector was removed with the selector itself** (Issue #40). Seven specs and the Part 6 evidence block drove a screen that no longer exists. Their screenshots stay under `artifacts/lab-02/screenshots/` as evidence for a lab already submitted; Login's own evidence is captured by Lab 3's suite in Issue #46. The client suite likewise lost `RequesterContext.test.tsx` and `RequesterSelector.test.tsx`, 15 tests covering the deleted context.
- **BR-06's "stored lower-cased" is not yet enforced anywhere.** Login lower-cases what it is given before looking a user up, and every row written so far is lower-case, so nothing is broken today. But no constraint or write path prevents a future endpoint storing `Alex.Morgan@…`, and the moment one does, that user cannot log in — the lookup would normalise while the stored value would not. Issue #45 owns the write paths (`POST`/`PATCH /api/users`) and must normalise there; a `CHECK (email = lower(email))` would make it impossible to get wrong, at the cost of turning a mistyped address into a constraint violation the API has to translate.
- **The server suite fails intermittently with `socket hang up`, roughly one full run in ten.** It
  has only ever appeared in `authorization.api.test.ts`, inside the `cookieFor` login helper, and
  only when the whole suite runs: the file passes alone on repeat, and five consecutive full runs
  after the failure were clean. There is no configured `testTimeout`, so Vitest's 5 s default
  applies per test, and a login that exceeds it while files run in parallel would surface exactly
  this way — the request is still in flight when the ephemeral Supertest server goes away. That is
  a hypothesis, not a diagnosis: total suite duration on the failing run (9.05 s) was
  indistinguishable from a clean one (8.93 s), which is what a single slow test among parallel
  files looks like, but is not proof. Recorded rather than papered over with a longer timeout,
  because raising the limit would hide the symptom without establishing the cause. The run recorded
  in §6 is a clean one, and the discrepancy between 185 and the 182 first reported on PR #54 was
  this flake: 182 passed of 185 on that run.
- **The queue's `id` tie-break is tested as far as it can be.** Two Tickets with the same Last
  Updated are asserted to come back newest id first, and removing the key does fail that test here.
  But without the key the database's order is unspecified rather than reliably wrong, so the test
  is certain to pass with the key and only likely to fail without it.
- **The queue's responsive layout is not covered by an automated test yet** (Issue #43). It was
  checked by eye at 1440, 820 and 390px in both themes, with no horizontal overflow at any of them;
  the captures and the overflow assertion become RESP-01 in Issue #46. jsdom applies no media
  queries, so the client tests cannot see which of the table and the cards is showing.
- **Each row in the queue opens `/staff/tickets/:id`, which is a placeholder until Issue #44.** The
  route and its role guard are real, so the link lands somewhere and a Requester is refused; the
  screen behind it is not built.
- **In the header, the user's name runs into the role badge** at desktop and tablet widths. It
  predates the queue and is visible on every authenticated screen; left for Issue #47 rather than
  fixed in passing.
