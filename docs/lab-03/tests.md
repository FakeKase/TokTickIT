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
| UNIT-03 | Unit | BR-22, BR-23 | Status transition matrix helper | Every cell of §5.2, checked against a copy of the table written out by hand rather than derived from the helper; nothing returns to New; a move to the same status is refused; Resolved and Closed, and only those, need an owner; the matrix is reported before the owner when a move fails both; the moves offered are exactly the moves accepted | `server/tests/lab-03/status-transitions.unit.test.ts` | Pass |
| UNIT-04 | Unit | BR-13, BR-37 | Password validation | At least 8 characters and at most 72 UTF-8 bytes, both bounds inclusive, with Thai and emoji inputs that `.length` would wave through; new ≠ current; confirmation mismatch reported on the confirmation field | `server/tests/lab-03/password.unit.test.ts` | Pass |
| UNIT-06 | Unit | BR-06, BR-13, BR-37 | User field validation | Name 2–80 after trimming, both ends inclusive; email ≤120, syntactically valid, trimmed and lower-cased; the three roles as spelled; `isActive` a real boolean; create requires everything and reports every problem at once, edit validates only what is sent; unknown fields never pass through; initial password 8 characters to 72 bytes, counted in bytes | `server/tests/lab-03/user-validation.unit.test.ts` | Pass |
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
| API-08 | API | AC-04, BR-29 | Requester requests Internal Notes | `403` for `?visibility=INTERNAL`, with no note data; the same Ticket read by IT Staff and by an Administrator returns the note, proving it exists. Lives with API-18 and API-19 | `server/tests/lab-03/comments-notes.api.test.ts` | Pass |
| API-09 | API | AC-02, BR-14 | Password-change gate | With `mustChangePassword` set, every endpoint except me/change-password/logout returns `403 PASSWORD_CHANGE_REQUIRED` | `server/tests/lab-03/authorization.api.test.ts` | Pass |
| API-10 | API | AC-03, BR-03 | Spoofed `requesterId` | Supplying another user's id in the body or query changes nothing; the session's identity is used | `server/tests/lab-03/authorization.api.test.ts` | Pass |
| API-11 | API | AC-14, BR-16 | Role refusal across the Requester boundary | IT Staff are refused a Requester route with `403` and no data; a Requester is refused the staff queue (`staff-queue.api.test.ts`) and the staff Ticket endpoints (`staff-ticket-detail.api.test.ts`); a Requester and IT Staff are both refused every user endpoint (`users-admin.api.test.ts`). The guard itself is covered by the probe router | `server/tests/lab-03/authorization.api.test.ts` | Pass |
| API-12 | API | AC-17, BR-18 | Another Requester's Ticket, Attachment, download and removal | All four `404`, and the Attachment's body byte-identical to a nonexistent id. Lab 2's `attachments.api.test.ts` covers the same rules from the owner's side | `server/tests/lab-03/authorization.api.test.ts` | Pass |
| API-13 | API | AC-10, BR-12 | Session of a deactivated user | The next request after deactivation is `401`, on a converted Lab 2 endpoint as well as the probe | `server/tests/lab-03/authorization.api.test.ts` | Pass |
| API-14 | API | AC-15, BR-40 | Migration regression, API half | An account carried through the rename signs in with the documented password, lists its Ticket, opens it, and downloads an Attachment the test uploads itself. It does **not** distinguish a migrated row from a seeded one — the seed upserts these accounts on every run — so the migration itself is proved by `npm run db:migration-check`, on a throwaway database, and this row covers only that the authenticated API serves a carried-over account | `server/tests/lab-03/authorization.api.test.ts` | Pass |
| API-15 | API | AC-21, BR-05, AC-14 | Requester attempts a status change | `403` for Resolved and for Closed on their own Ticket, and for every other staff Ticket endpoint; no Ticket data in the response; status, owner, priority and `updatedAt` all unchanged. Moved from `authorization.api.test.ts`, where the staff fixtures it needs do not exist | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
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
| API-27 | API | AC-27, BR-20 | Claim an unassigned Ticket | `200`; the acting user is the owner; `updatedAt` advances; the Ticket appears under `owner=me` in the queue; a Ticket held by a colleague can be claimed | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-28 | API | AC-28, BR-20 | Reassign to another active IT Staff user | `200`; ownership moves and `updatedAt` advances; an Administrator is accepted as owner; naming the current owner writes nothing; `null` unassigns, except on a Resolved or Closed Ticket (`409`), which may still change hands | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-29 | API | AC-29, BR-19 | Assign a Requester, and an inactive staff user | `409` for both and for an id that is nobody, with byte-identical bodies; ownership and `updatedAt` unchanged. `400` for an `ownerId` that is not an id or `null`, and for a request with no body | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-30 | API | AC-30, BR-21 | Set IT Priority | `200`; `requestedPriority` untouched, including when the body sends one; `400` for a value not among the four; the same value writes nothing | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-31 | API | AC-31, BR-22 | Illegal transition (In Progress → Closed) | `409` with the message naming both statuses; status and `updatedAt` unchanged. Also: the matrix holds for an Administrator; a move to the same status is refused; a status the body claims to be coming from is ignored; a whole lifecycle walks through ten legal moves and stops at Cancelled | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-32 | API | AC-32, BR-22 | Legal transition (In Progress → Resolved, owned) | `200`; status updated; the response carries the next permitted moves. Reopening clears the Requester's resolved signal, resolving does not, and the Requester can then signal again | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-33 | API | AC-33, BR-23 | Resolve an unassigned Ticket | `409` for Resolved and for Closed; status unchanged. Concurrency: a move decided on a status that has since changed, and a resolve on a Ticket unassigned in the meantime, are both refused, tested by forcing a write between the route's read and its write; two simultaneous incompatible moves yield exactly one `200`; two simultaneous claims both succeed without a `500` | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-34 | API | FR-15, BR-19 | Assignable-user list | Active IT Staff and Administrators only, ordered by name, with id, name and role and nothing else; checked against the whole list, not just the fixtures; every entry listed is accepted as an owner | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |

### API — Administrator user management

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| API-35 | API | AC-35, FR-20, AC-14 | List users | Every user with name, email, role and status, inactive ones included, ordered by name; no hash on any row. A Requester and IT Staff are refused all four user endpoints with `403`, no user data and nothing written; anonymous is `401` | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-36 | API | AC-36, BR-38 | Search and role filter | Partial case-insensitive match on name and on email; role filter narrows; the two combine; no match is an empty list; an unknown role is ignored | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-37 | API | AC-37, FR-22, BR-06 | Create a user | `201`; `mustChangePassword` true whatever the body says; the account signs in with the initial password and is held at the first-login gate; the email is stored lower-cased and signs in in any case; an account created inactive cannot sign in; every invalid field reported at once with nothing written; the password bounds in bytes; the password never echoed | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-38 | API | AC-38, BR-34 | Duplicate email on create and on edit | `409` both times, in any case and with surrounding spaces; nothing written, including the other fields of the same edit; a user keeping their own address is not a duplicate | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-39 | API | FR-23, BR-12, BR-19 | Edit name, email, role, activation | Each field updated on its own; a role change applies on the user's next request; deactivation ends their session at once and reactivation does not restore it; an edit that is not a deactivation leaves sessions alone; an edit cannot set a password or clear the change-password flag; `400` and `404` cases; a row that references a locked user, such as a comment by an Administrator, can still be written while an edit holds its locks. A user who is deactivated or made a Requester hands back their live Tickets and keeps their Resolved and Closed ones, and is refused as an owner afterwards | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-40 | API | AC-39, BR-32 | Administrator deactivates themselves | `409`; account still active and signed in; refused even alongside other valid changes, none of which apply; the acting user comes from the session, not the body | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-41 | API | AC-40, BR-33 | Last active Administrator deactivated or demoted | `409` for deactivation and for either demotion; with a second Administrator present both succeed; an inactive Administrator does not count; two Administrators demoting each other at the same moment leave exactly one; the list flags the last one. Run against a client narrowed to this test's users, because the shared test database always holds other files' Administrators; the row locking is real, and one unnarrowed test checks the count against the database | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-42 | API | AC-41, BR-36, BR-13 | Set a new initial password | `200`; the old password fails; the new one works and demands a change; the user's existing session is refused and its row gone; the same bounds as any password; `404` for an unknown user; nobody else's password changes | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-43 | API | BR-35 | No delete endpoint | `DELETE /api/users/:id` is `404` and the row is still there | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-44 | API | AC-44, BR-17 | Safe errors across the surface | No response body contains a stack trace, SQL fragment, hash, or internal identifier | `server/tests/lab-03/authorization.api.test.ts` | Partial — the unhandled-rejection path is covered; the rest lands with each Issue's endpoints |
| API-45 | API | AC-45, BR-18 | Staff attachment access | IT Staff and an Administrator read an Attachment's metadata and download its bytes on a Ticket they do not own; upload and removal are `403` and change nothing; a removed Attachment keeps its row and reason and is `404` to download; the staff Ticket lists Attachments without the stored filename | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |

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
| UI-14 | UI | AC-27, AC-28 | Ownership controls | Claim appears when unassigned or held by a colleague, not when it is already yours, and sends the acting user's id; reassign lists the assignable users without the current owner and sends the one chosen; Unassign sends `null`; a refusal shows the server's reason and reloads the Ticket; Claim still works if the assignable list fails to load | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Pass |
| UI-15 | UI | AC-30, AC-31 | Priority and status controls | IT Priority saves on change, leaves Requested Priority alone, shows a saving indicator, and returns to the saved value on failure without repeating the server's words. The status select offers only the moves in the response; Resolved is disabled on an unowned Ticket with the reason beside it, and enabled once claimed; nothing is sent until the button is pressed; a refused move shows the conflict message and the screen catches up; a final status offers no control | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Pass |
| UI-16 | UI | BR-04, ui-spec §5 | Two conversation streams | Each entry appears only in its own stream, under a heading naming who reads it; two composers with distinct labels and buttons and no visibility switch of any kind; each sends its own visibility; a draft in one is neither sent nor cleared by the other; a body with markup renders as text; a failed thread leaves the Ticket and workflow usable. Also: read-only facts, read-only attachments (AC-45), not-found, forbidden, failure, and Back to the queue view the Ticket came from | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Pass |
| UI-17 | UI | AC-34, AC-18, AC-20 | Requester Ticket Detail thread and resolved signal | Each entry shows its author, role and time; posting trims and clears only on success; a failed post keeps the text; no edit or delete control exists; nothing mentions Internal Notes; the signal confirms first, survives a reload, and is absent on a finished Ticket; a refused signal (`409`) reloads the Ticket instead of offering a Retry, so the screen ends up showing what the server actually holds; and the "IT Staff will confirm" promise disappears once the Ticket is settled | `client/tests/lab-03/RequesterComments.test.tsx` | Pass |
| UI-18 | UI | AC-35, AC-36 | User list, search, role filter | Rows show Name, Email, Role, Status and Edit, inactive users included, with the viewer's own row marked; no delete, pagination or bulk selection; search on submit, trimmed; the role filter takes the search box with it; Empty and No-Results are different states | `client/tests/lab-03/UserManagement.test.tsx` | Pass |
| UI-19 | UI | AC-37 | Create-user dialog | Validates name, email, role and initial password before sending, the password ceiling in bytes; sends once, including when the form is submitted again while saving; sends Active as set; closes, reloads the list and says the user must change the password; a `400` lands on its field; a failure keeps the typing and repeats nothing the server said | `client/tests/lab-03/UserManagement.test.tsx` | Pass |
| UI-20 | UI | AC-38 | Duplicate email | A `409` attaches its message to the email field, once, and not to a banner, on create and on edit | `client/tests/lab-03/UserManagement.test.tsx` | Pass |
| UI-21 | UI | AC-39, AC-40 | Guard-rails | Active is disabled on your own account with the reason beside it; Active and Role are both disabled on the last active Administrator with the reason; both are enabled for anyone else; a refusal from the server is still shown when it disagrees with what the dialog allowed. Editing sends only what changed and nothing when nothing did. Editing your own account re-reads the session, so a new name shows in the header and a self-demotion leaves header, nav and page agreeing; editing someone else does not | `client/tests/lab-03/UserManagement.test.tsx` | Pass |
| UI-22 | UI | AC-41 | Set a new initial password | Asks first and sends nothing until confirmed; one request; the result says the user is signed out and must change it; validated before sending; not offered on your own account, which links to Change Password. The dialog is labelled, takes focus, closes on Escape and returns focus, traps Tab both ways, and does all of that even after focus has fallen out of it. Escape is ignored while a save or a password reset is in flight, so a failure still has the dialog to appear in | `client/tests/lab-03/UserManagement.test.tsx` | Pass |

### Responsive, style, and end-to-end

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| RESP-01 | Style | AC-42, ui-spec §10 | No horizontal overflow | Login, Change Password, Queue and its mobile filter panel, Staff Detail, User Management and its dialog, and the Requester's My Tickets and Ticket Detail, at 375/820/1280px in both themes, with the offending element named on failure and no label, badge or button clipped. The fixtures hold text that cannot wrap. The header's name, role badge and Log out never overlap, for any role | `e2e/lab-03/visual-regression.spec.ts` | Pass |
| RESP-02 | Style | ui-spec §3 | Editable vs read-only on Staff Detail | Computed background colours of the workflow panel and the ticket header differ, an editable control differs from a read-only value, and the read-only card contains no control | `e2e/lab-03/visual-regression.spec.ts` | Pass |
| RESP-03 | Style | ui-spec §3, §5 | Public vs internal streams | Computed background colours differ, not only the headings; the internal stream has a left rule of at least 3px in a different colour; each states its audience | `e2e/lab-03/visual-regression.spec.ts` | Pass |
| RESP-04 | Style | ui-spec §3 | Badge families | Status, IT Priority, and Role badges are mutually distinct by computed colour, and each carries a text label; Requested and IT Priority differ; every badge label has at least 4.5:1 contrast on its fill in both themes; Urgent is the only filled badge. Role navigation shows only permitted destinations, on desktop and in the mobile menu | `e2e/lab-03/visual-regression.spec.ts` | Pass |
| RESP-05 | Style | AC-43 | Focus visibility and dialog focus trap | Every control reached by Tab on Login, Change Password, User Management, the queue and the staff Ticket shows a focus ring; the user dialog traps focus and restores it on close. Validation messages sit directly below their own field on Login, Change Password and the user dialog; a disabled guard-rail control has its reason beside it; the new screens' buttons and fields have the same computed style as Lab 2's | `e2e/lab-03/visual-regression.spec.ts` | Pass |
| E2E-01 | E2E | AC-01, AC-05, AC-06, AC-08, AC-13 | Login, wrong password, logout, direct access blocked | A protected URL with no session goes to Login; a wrong password, an unknown address and an inactive account all show the same message; a valid login enters the app; after logout a protected URL returns to Login and the old cookie is `401`. Each role lands on its own screen with its own navigation, and is shown Forbidden on a route that is not theirs | `e2e/lab-03/authentication.spec.ts` | Pass |
| E2E-02 | E2E | AC-02 | Initial password login and change | An account created by the Administrator signs in and is held on Change Password, in the browser and at the API; a mismatched confirmation changes nothing; a valid change opens the screen for their role; the initial password then fails and the new one works | `e2e/lab-03/authentication.spec.ts` | Pass |
| E2E-03 | E2E | AC-27, AC-30, AC-31, AC-33, AC-34 | IT Staff workflow | Sign in, find a Ticket through the queue search, open it, see Resolved unavailable while unowned, claim it, set IT Priority with Requested Priority unchanged, move the status, be refused an illegal move by the API, post a public comment and an internal note, and return to the same search with the queue showing the new owner | `e2e/lab-03/staff-ticket-flow.spec.ts` | Pass |
| E2E-04 | E2E | AC-18, AC-20, AC-32, AC-34 | Requester regression and visibility | The Requester sees their Tickets, opens the one from E2E-03, sees the public comment and neither the note nor any trace of it in what the API sent, has no status control, posts a comment, and indicates the problem appears resolved with the status unchanged. IT Staff then see the signal and the reply and resolve it, and the Requester sees it Resolved with nothing left to signal | `e2e/lab-03/staff-ticket-flow.spec.ts` | Pass |
| E2E-05 | E2E | AC-35, AC-36, AC-37, AC-38, AC-41, AC-10 | User administration | The Administrator creates a user, finds them by search and role filter, and is refused a duplicate address on the Email field. That user signs in with the initial password and is held on Change Password; a new initial password ends their session and the old one stops working; after changing it they land on the screen for their role; deactivation refuses their next request and their next login | `e2e/lab-03/user-administration.spec.ts` | Pass |
| E2E-06 | E2E | AC-39, AC-40, AC-14 | Administrator guard-rails | The dialog disables Active and Role on the sole Administrator with both reasons shown; the API refuses self-deactivation and demotion of the last Administrator, and the account is unchanged; a Requester, IT Staff and an anonymous caller are refused the user list | `e2e/lab-03/user-administration.spec.ts` | Pass |

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

Updated as each Issue's PR lands in `lab3-staging`. Every planned test in §2 is now Pass.

### Final run

Every suite, run together on the release candidate: the head of `lab3-staging` with Issue #48's
branch applied, which is the tree the release PR merges to `main`. Recorded on 4 October 2026.

| Suite | Command | Result |
| --- | --- | --- |
| Server: API, unit and integration | `cd server && npm test` | 21 files, 353 tests passed, on a freshly seeded database |
| Migration: Lab 2 data through the Lab 3 migration | `cd server && npm run db:migration-check` | All checks passed |
| Client: UI | `cd client && npm test` | 17 files, 256 tests passed |
| End to end, flows and visual checks, Labs 2 and 3 | `npm run e2e:fresh` | 91 specs passed, on a database built for the run |
| End to end, on a development database | `npm run e2e` | 68 specs passed, 23 evidence captures skipped |
| Type checks | `npm run typecheck` in `server/`, `client/` and the root | Clean |
| Lint | `cd client && npm run lint` | Clean |
| Production build | `cd client && npm run build` | Built |

The handout asks for this output to come from `main`. It cannot be captured from `main` inside
the PR that has to merge before `main` contains it, so the table above is from the release
candidate. The same commands are run again on `main` once the release PR has merged, and the
result is recorded below.

### Run on `main` after release

_To be filled in after the release PR merges._

### Per Issue

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
| 44 — IT Staff Ticket Detail | `cd server && npm test` | 19 files, 285 tests passed |
| 44 — IT Staff Ticket Detail | `cd client && npm test` | 16 files, 211 tests passed |
| 44 — IT Staff Ticket Detail | `npm run e2e` | 27 specs passed |
| 45 — Administrator user management | `cd server && npm test` | 21 files, 353 tests passed |
| 45 — Administrator user management | `cd client && npm test` | 17 files, 255 tests passed |
| 45 — Administrator user management | `npm run e2e` | 27 specs passed |
| 46 — E2E suite and evidence | `cd server && npm test` | 21 files, 353 tests passed, on a freshly seeded database |
| 46 — E2E suite and evidence | `cd client && npm test` | 17 files, 255 tests passed |
| 46 — E2E suite and evidence | `npm run e2e:fresh` | 60 specs passed, on a database built for the run; 33 screenshots and `api-authorization.json` written |
| 46 — E2E suite and evidence | `npm run e2e` | 44 specs passed, 16 evidence captures skipped, on the development database |
| 47 — Responsive and visual QA | `cd client && npm test` | 17 files, 256 tests passed |
| 47 — Responsive and visual QA | `npm run e2e:fresh` | 84 specs passed, on a database built for the run; 50 responsive captures written |
| 47 — Responsive and visual QA | `npm run e2e` | 68 specs passed, 16 evidence captures skipped, on the development database |
| 48 — Documentation and release | `npm run e2e:fresh` | 91 specs passed; the evidence spec grew from 16 to 23 tests, and 99 screenshots are written |

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
- **An assignment racing a deactivation is not tested as a race.** The two are ordered by a row
  lock on the user: the owner route reads it `FOR SHARE`, the edit takes it `FOR UPDATE`. Each
  outcome is tested on its own, a deactivated user is refused as an owner and a deactivation hands
  back what they owned, but no test forces the two to overlap. The last-Administrator lock, by
  contrast, is tested with two real simultaneous requests.
- **The client suite times out when the machine is heavily loaded.** With the load average above
  20, two consecutive runs failed 14 and 17 tests, every one a 5 s timeout and spread across
  unrelated files, and the suite took 77 to 90 s instead of about 13. The next three runs, on the
  same code, passed 255 of 255. It is the 5 s default meeting a starved CPU, not a failing
  assertion, but it does mean a red run on a busy machine needs rerunning before it is believed.
- **The submission screenshots are captured only by `npm run e2e:fresh`** (Issue #46), on a
  database created, migrated and seeded for that run. On a development database the evidence spec
  is skipped: it would photograph whatever was left there and overwrite the committed images with
  it. The queue and user-list captures assert that they show seed rows only, and the suite cleans
  its own fixtures before the user-list capture, because an earlier test in the same file creates a
  user.
- **The "empty queue" screenshot is produced by answering the queue request with no Tickets.** The
  seed always has Tickets, so that state cannot be reached with real data. The screen in the
  capture is the real one; only that one response is supplied. Every other capture is of real data
  from the real API.
- **Direct API authorization evidence** is `artifacts/lab-03/api-authorization.json`, and the same
  thirteen requests rendered as `staff-ticket-detail/forbidden-api.png`. Each identity has a request
  context of its own. An earlier version shared one, and its "no session" row was really the last
  account signed in: Playwright's shared context keeps a cookie jar.
- **The User Management flow that surfaced the `Esc` bug** (Issue #45) is now E2E-05, which presses
  `Esc` after a refused duplicate address and expects the dialog to close.
- **The server suite depends on the seeded accounts being as the README describes them.**
  `seed-credentials.api.test.ts` signs in as each one. During Issue #46 it failed on the development
  database because `daniel.okafor`, one of the two accounts seeded with an initial password, had
  been signed in and had its password changed by hand. Reseeding does not undo that: the seed
  never rewrites a password. Against a freshly seeded database the suite passed 353 of 353 three
  times running. The intermittent single failure recorded above also appeared once in those runs,
  in `auth.api.test.ts`, and did not repeat.
- **The My Tickets overflow recorded during Issue #45 was misdiagnosed there.** It was put down to
  the longer status labels from Issue #43. The cause was one Ticket whose Summary was a single
  unbroken word: a table cell cannot be narrower than its longest word, so the table grew wider
  than the page, at desktop width as well. It was found in Issue #47 only once the fixtures were
  given text that cannot wrap; the same checks passed on the seed, whose every Summary is a tidy
  sentence. Fixed, and the visual spec's fixtures stay awkward on purpose.
- **Visual checks are computed, not looked at, and that has limits.** Overflow, clipping, overlap,
  contrast, focus rings and placement are measured from the rendered page. Whether a screen is
  pleasant is not something these assert. Every capture was also looked at once by eye during
  Issue #47, which is how the page scrolling behind the mobile dialog was noticed.
- **One client test failed once and did not repeat** (Issue #47): `AppShellNav.test.tsx`, "keeps My
  Tickets active on a Ticket Detail route". It passed three times alone and twice in the full suite
  immediately afterwards, at a normal machine load. Not explained.
