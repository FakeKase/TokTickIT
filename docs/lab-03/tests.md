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
| UNIT-01 | Unit | BR-07 | Password hash and verify helper | A hash never equals the plaintext; verify accepts the right password and rejects a wrong one; two hashes of the same password differ (salted) | `server/tests/lab-03/password.unit.test.ts` | Planned |
| UNIT-02 | Unit | BR-09, BR-11 | Session token and expiry helper | Token is 32 random bytes, never repeats across 1000 draws; expiry is exactly 8 hours ahead; an expired row is reported expired | `server/tests/lab-03/session.unit.test.ts` | Planned |
| UNIT-03 | Unit | BR-22, BR-23 | Status transition matrix helper | Every cell of §5.2 permitted; every other pair rejected; Resolved/Closed rejected without an owner | `server/tests/lab-03/status-transitions.unit.test.ts` | Planned |
| UNIT-04 | Unit | BR-13, BR-37 | User and password validation | Name 2–80, email ≤120 and syntactically valid, password 8–72, new ≠ current, confirmation must match | `server/tests/lab-03/user-validation.unit.test.ts` | Planned |
| UNIT-05 | Unit | BR-30, BR-31, AC-26 | Queue query parser | Defaults `updatedAt` desc, page 1, size 10; out-of-range and non-numeric values clamped, not rejected; unknown sort key falls back to the default | `server/tests/lab-03/staff-queue.unit.test.ts` | Planned |

### API — authentication

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| API-01 | API | AC-01 | Valid login | Authenticated response; safe user data; session cookie set `HttpOnly`; no `passwordHash` in the body | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-02 | API | AC-06, BR-08 | Wrong password vs unknown email | Both `401` with byte-identical bodies; no session created | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-03 | API | AC-05, BR-01 | Inactive account with the correct password | `401`, same body as API-02; no session created | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-04 | API | AC-08, BR-10 | Logout then reuse the cookie | Logout `204`; the session row is gone; the same cookie then returns `401` | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-05 | API | AC-09, BR-11 | Expired session | A session backdated past its expiry is treated as unauthenticated and the row is removed | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-06 | API | AC-11, BR-13 | Change-password validation | Too short, mismatched confirmation, and same-as-current each `400`; the flag stays set | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-07 | API | AC-12 | Change password successfully | `200`, `mustChangePassword` false; the old password then fails and the new one works | `server/tests/lab-03/auth.api.test.ts` | Planned |

### API — authorization, comments and notes

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| API-08 | API | AC-04, BR-29 | Requester requests Internal Notes | Forbidden; no note data returned; the same call as IT Staff returns the notes, proving they exist | `server/tests/lab-03/comments-notes.api.test.ts` | Planned |
| API-09 | API | AC-02, BR-14 | Password-change gate | With `mustChangePassword` set, every endpoint except me/change-password/logout returns `403 PASSWORD_CHANGE_REQUIRED` | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-10 | API | AC-03, BR-03 | Spoofed `requesterId` | Supplying another user's id in the body or query changes nothing; the session's identity is used | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-11 | API | AC-14, BR-16 | Requester calls staff and admin endpoints | `403` on the queue, staff detail, and every `/api/users` route; no data in the body | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-12 | API | AC-17, BR-18 | Another Requester's Ticket, Attachment, and download | `404`, byte-identical to a nonexistent id | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-13 | API | AC-10, BR-12 | Session of a deactivated user | The next request after deactivation is `401` | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-14 | API | AC-15, BR-40 | Migration regression | Tickets and Attachments seeded before the migration are still listed, still owned by the same person, and still downloadable afterwards | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-15 | API | AC-21, BR-05 | Requester attempts a status change | `403`; status unchanged | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-16 | API | AC-18, BR-27 | Post a Public Comment | `201`; author and timestamp come from the server even when the body supplies others; visible to IT Staff | `server/tests/lab-03/comments-notes.api.test.ts` | Planned |
| API-17 | API | AC-19, BR-25 | Empty and whitespace-only bodies, and one over 2000 characters | `400`; nothing stored | `server/tests/lab-03/comments-notes.api.test.ts` | Planned |
| API-18 | API | AC-34, BR-04 | Visibility filtering | A Requester's comment list contains the public entries and no trace of the internal ones — not a redacted entry, not a count | `server/tests/lab-03/comments-notes.api.test.ts` | Planned |
| API-19 | API | BR-04, BR-16 | Requester posts with `visibility: INTERNAL` | `403`; nothing stored | `server/tests/lab-03/comments-notes.api.test.ts` | Planned |
| API-20 | API | AC-20, BR-24 | Problem appears resolved | `200`; `requesterResolvedAt` set; `currentStatus` unchanged; an accompanying Public Comment exists | `server/tests/lab-03/comments-notes.api.test.ts` | Planned |

### API — IT Staff queue and detail

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| API-21 | API | AC-22, FR-13 | Queue lists every Requester's Tickets | Tickets from at least two Requesters, each with owner, status, and both priorities | `server/tests/lab-03/staff-queue.api.test.ts` | Planned |
| API-22 | API | AC-23, BR-30 | Search with no match | `200`; empty `data`, `totalItems: 0` — distinct from an unfiltered empty queue | `server/tests/lab-03/staff-queue.api.test.ts` | Planned |
| API-23 | API | AC-24, BR-30 | Status and IT Priority filters combined | Only Tickets matching both are returned | `server/tests/lab-03/staff-queue.api.test.ts` | Planned |
| API-24 | API | AC-25, BR-31 | Sort by IT Priority descending | Urgent → High → Medium → Low, tie-broken by Last Updated descending | `server/tests/lab-03/staff-queue.api.test.ts` | Planned |
| API-25 | API | AC-26, BR-30 | Invalid pagination parameters | Clamped to the nearest valid bound; `pagination` block correct | `server/tests/lab-03/staff-queue.api.test.ts` | Planned |
| API-26 | API | BR-30 | `owner=me` and `owner=unassigned` | Each returns exactly the matching set | `server/tests/lab-03/staff-queue.api.test.ts` | Planned |
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
| API-44 | API | AC-44, BR-17 | Safe errors across the surface | No response body contains a stack trace, SQL fragment, hash, or internal identifier | `server/tests/lab-03/authorization.api.test.ts` | Planned |

### UI component

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| UI-01 | UI | AC-01, FR-01 | Login submits and stores identity | Valid submission calls the API once and routes to the role's landing screen | `client/tests/lab-03/Login.test.tsx` | Planned |
| UI-02 | UI | AC-06, BR-08 | Login failure message | A `401` renders one generic alert; nothing indicates which field or account state was wrong | `client/tests/lab-03/Login.test.tsx` | Planned |
| UI-03 | UI | AC-07 | Login busy state | The submit control is disabled and labelled while the request is in flight; a second click sends nothing | `client/tests/lab-03/Login.test.tsx` | Planned |
| UI-04 | UI | AC-44 | Login API failure | An unreachable API renders a safe failure with no internal detail | `client/tests/lab-03/Login.test.tsx` | Planned |
| UI-05 | UI | AC-02 | Password-change gate in the router | A user with `mustChangePassword` is redirected from every route to Change Password | `client/tests/lab-03/ChangePassword.test.tsx` | Planned |
| UI-06 | UI | AC-11 | Password-change validation | Short password, mismatched confirmation, and same-as-current each show a field-level message and send nothing | `client/tests/lab-03/ChangePassword.test.tsx` | Planned |
| UI-07 | UI | AC-12 | Password-change success | Success routes into the application and the gate no longer fires | `client/tests/lab-03/ChangePassword.test.tsx` | Planned |
| UI-08 | UI | AC-13, FR-05 | Role-specific navigation | Requester, IT Staff, and Administrator each see only their permitted destinations; the name and role badge render; Logout is present | `client/tests/lab-03/AppShellAuth.test.tsx` | Planned |
| UI-09 | UI | AC-08 | Logout from the shell | Logout calls the API and returns to Login; a protected route afterwards shows Login | `client/tests/lab-03/AppShellAuth.test.tsx` | Planned |
| UI-10 | UI | AC-22, FR-13 | Queue renders rows | Ticket Number, Summary, both priority badges, status badge, owner or "Unassigned" | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Planned |
| UI-11 | UI | AC-23 | Queue empty vs no-results | Different copy and different actions for the two states | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Planned |
| UI-12 | UI | AC-24, AC-26 | Queue filters and paging | Changing a filter refetches with the right query; page controls move the page and clamp at the bounds | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Planned |
| UI-13 | UI | AC-44 | Queue failure state | A failed load renders a safe failure with Retry, which refetches | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Planned |
| UI-14 | UI | AC-27, AC-28 | Ownership controls | Claim appears when unassigned; reassign lists only assignable users; both send the documented request | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
| UI-15 | UI | AC-30, AC-31 | Priority and status controls | The status select offers only permitted transitions; a rejected transition shows the conflict message and reverts the control | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
| UI-16 | UI | BR-04, ui-spec §5 | Two conversation streams | Public and internal composers are separate controls with distinct labels; posting through one never sends the other's visibility | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
| UI-17 | UI | AC-34 | Requester Ticket Detail comments | Public comments render; no internal-note heading, composer, or entry exists in the tree | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
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

Every AC has at least one test, and every test names a file that will exist. Rows are flipped from
Planned to Pass by the PR that implements them, never in advance.

## 4. Responsive and Visual Checklist

The checklist itself lives in `ui-spec.md` §10, where each box names the assertion that backs it.
It is completed in Issue #47 and its result recorded here.

## 5. Test Commands

```bash
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
| 37 — Sprint 3 contract | `npm run typecheck` | Pending |

## 7. Known Limitations or Deferred Tests

- No load or performance testing of the queue at scale — out of scope, as in Lab 2.
- No automated cross-browser matrix; Playwright runs on Chromium only.
- Password hashing cost is not benchmarked; cost 10 is taken as the documented default rather than tuned.
- Rate limiting and account lockout after repeated failed logins are not implemented, and therefore not tested: the handout excludes account unlocking and advanced identity management. This is a known gap, recorded here rather than left to be discovered.
- Session fixation across a password change is out of scope: the current session survives a change by design (`api-spec.md` §4), and rotating it is deferred with the rest of session hardening.
- The dark appearance is asserted at the `data-theme` level, as in Lab 2, not by computed contrast ratio.
