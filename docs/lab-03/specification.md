# Lab 3 Sprint Engineering Specification

## 1. Sprint Goal

Replace the temporary Development Requester selector with real authentication and
server-enforced role-based authorization, then deliver the first operational IT Staff workflow
and a minimalist Administrator user management screen — without losing a single Ticket,
Attachment, or Requester created in Lab 2.

## 2. Stakeholder Request Interpretation

Lab 2 shipped an intake path that trusted whatever identity the client asserted. That was
honest scaffolding for a sprint with no users, and it is now the first thing to go. IT needs
real accounts: people sign in with an email address and password, anyone holding a
password issued by an Administrator must replace it before doing anything else, and what a
person may do follows from their one role rather than from which buttons the UI happens to
render.

Three roles exist. A **Requester** keeps every Lab 2 function, now bound to their own signed-in
identity, and gains a public conversation on their Ticket plus a way to say "this looks fixed to
me". **IT Staff** get a shared queue to find work in, and a Ticket Detail screen where they take
ownership, set IT Priority, move a Ticket through its permitted statuses, answer the Requester in
public, and keep private operational notes. An **Administrator** manages accounts and nothing
else — the two responsibilities stay conceptually separate.

The security requirement is stated plainly in the handout and is treated here as the sprint's
sharpest constraint: hiding a button is not authorization. Every rule below is enforced by the
backend, and the tests that prove it call the API directly rather than clicking the UI.

## 3. Scope

### Included
- Email/password authentication, logout, current-user retrieval, and mandatory first-login password change
- Server-side authorization for Requester, IT Staff, and Administrator on every protected endpoint
- Migration of the Lab 2 `Requester` rows into a real `User` model, preserving all Ticket ownership
- Removal of the Development Requester selector and its client-side state
- Requester regression: every Lab 2 Ticket and Attachment function driven by the authenticated identity
- Public Comments (all roles) and Internal Notes (IT Staff and Administrator only)
- The "Problem Appears Resolved" indication for Requesters
- IT Staff Ticket Queue with search, filters, sorting, and pagination
- IT Staff Ticket Detail: claim/reassign ownership, IT Priority, permitted status transitions
- Minimalist Administrator User Management: list, search, optional role filter, create, edit, activate/deactivate, set a new initial password
- Zen Green extensions for all new screens, responsive at desktop/tablet/mobile

### Excluded
- Email invitations, password-reset email, multi-factor authentication, social login, single sign-on
- Self-registration and Requester-created accounts
- Actions Taken by IT Staff (deferred to Lab 4, along with the rule that blocks resolution while they remain incomplete)
- SLA calculation, escalation rules, notification services
- Dashboards and KPI analytics beyond simple queue counts
- Multi-tenant organizations, departments, customer administration
- Production deployment or cloud infrastructure changes
- Multiple roles per user, user deletion, bulk operations, import/export, account-history screens
- Extended user profiles (department, organization, profile photo)
- Account unlocking, administrator approval workflows
- Mandatory pagination, multi-column sorting, or multiple simultaneous filters on the user list

## 4. Functional Requirements

### Authentication
- **FR-01** Provide a Login screen accepting an email address and password, which authenticates an active user and establishes an authenticated session.
- **FR-02** Provide a Logout action that invalidates the session server-side, not merely in the browser.
- **FR-03** Expose the currently authenticated user's identity, role, and password-change state to the client.
- **FR-04** Provide a mandatory Change Password screen for any user flagged as holding an initial password, and block the rest of the application until a valid new password is saved.

### Authorization
- **FR-05** Render navigation and actions according to the authenticated user's single role, presenting no unauthorized destination.
- **FR-06** Enforce role and ownership on the backend for every protected endpoint, independently of what the client sends or displays.
- **FR-07** Migrate every Lab 2 Development Requester into a `User` with an initial password, and remove the selector, its route, and its stored client-side selection.

### Requester
- **FR-08** Create a Ticket owned by the authenticated Requester, with no requester identity supplied by the client.
- **FR-09** List, search, filter, sort, and paginate only the authenticated Requester's own Tickets.
- **FR-10** Open one owned Ticket and manage its Attachments exactly as in Lab 2, still scoped by ownership.
- **FR-11** Post a Public Comment on an owned Ticket.
- **FR-12** Indicate that the reported problem appears resolved, without changing the Ticket's formal status.

### IT Staff
- **FR-13** Provide a Ticket Queue listing all Tickets with search, filters, sorting, and pagination.
- **FR-14** Open any Ticket in an IT Staff Ticket Detail screen.
- **FR-15** Claim an unassigned Ticket, or reassign ownership to another active IT Staff or Administrator user.
- **FR-16** Set a Ticket's IT Priority independently of the Requested Priority submitted by the Requester.
- **FR-17** Move a Ticket through the permitted status transitions defined in §5.2.
- **FR-18** Post a Public Comment visible to the Requester.
- **FR-19** Create an Internal Note visible only to IT Staff and Administrators.

### Administrator
- **FR-20** List users showing Name, Email, Role, Status, and an Edit action.
- **FR-21** Search users by name or email address, with an optional role filter.
- **FR-22** Create a user with a name, email address, one permitted role, an activation state, and an initial password.
- **FR-23** Edit a user's name, email address, role, and activation state.
- **FR-24** Set a new initial password that the user must change at their next login.
- **FR-25** Prevent duplicate email addresses, self-deactivation, and the removal of the last active Administrator.

### Data
- **FR-26** Seed the database idempotently with Requesters, IT Staff, an Administrator, realistic Tickets across statuses and priorities, and example comments and notes.

## 5. Business Rules

| ID | Rule |
| --- | --- |
| BR-01 | Only an active user with valid credentials may authenticate. |
| BR-02 | A user marked as requiring a password change cannot enter the normal application until a new valid password is saved. |
| BR-03 | The authenticated user identity, not a `requesterId` supplied by the client, determines ownership of Requester operations. |
| BR-04 | Public Comments are visible to the Requester, IT Staff, and Administrator. Internal Notes are visible only to IT Staff and Administrator. |
| BR-05 | A Requester may indicate that the problem appears resolved, but cannot formally set the Ticket to Resolved or Closed. |
| BR-06 | Email addresses are unique across all users, compared case-insensitively and stored lower-cased. |
| BR-07 | Passwords are stored only as a bcrypt hash (cost 10) and are never returned by any endpoint, logged, or included in any error message. |
| BR-08 | A failed login returns one generic message for an unknown email address, a wrong password, and an inactive account alike, so that accounts cannot be enumerated. |
| BR-09 | A session is an opaque 32-byte random token delivered in an httpOnly, SameSite=Lax cookie, backed by a `Session` row with an 8-hour absolute expiry. |
| BR-10 | Logout deletes the session row. Presenting the same cookie afterwards is treated as unauthenticated. |
| BR-11 | An expired session is treated as unauthenticated, and the expired row is removed when encountered. |
| BR-12 | A session belonging to a user who has since been deactivated is rejected on its next request, so deactivation takes effect without waiting for expiry. |
| BR-13 | A new password must be 8 to 72 characters, must differ from the current password, and must match its confirmation field. |
| BR-14 | While a user holds an initial password, only current-user retrieval, change-password, and logout are permitted; every other endpoint returns 403 with a `PASSWORD_CHANGE_REQUIRED` code. |
| BR-15 | A user holds exactly one role: Requester, IT Staff, or Administrator. |
| BR-16 | Only an Administrator may create a user, change a role, change an activation state, or issue a new initial password. |
| BR-17 | Every protected endpoint distinguishes unauthenticated (401), authenticated but forbidden (403), invalid input (400), missing resource (404), conflict (409), and unexpected failure (500). |
| BR-18 | A Requester requesting a Ticket or Attachment they do not own receives 404, byte-identical to the response for a resource that never existed. |
| BR-19 | A Ticket Owner must be an active IT Staff or Administrator user. A Ticket may be unassigned. |
| BR-20 | Claiming sets the Ticket Owner to the acting IT Staff user. Reassignment sets it to another eligible user. Both are permitted for IT Staff and Administrators, and both are recorded with `updatedAt`. |
| BR-21 | Requested Priority is immutable after creation. IT Priority is initialised from it and may afterwards be changed only by IT Staff or an Administrator. |
| BR-22 | Ticket status changes follow the transition matrix in §5.2. A transition outside the matrix is rejected with 409 and nothing is written. |
| BR-23 | A Ticket may only be set to Resolved or Closed while it has a Ticket Owner. |
| BR-24 | A Requester's "Problem Appears Resolved" indication records a timestamp and posts an accompanying Public Comment. It never changes `currentStatus`. |
| BR-25 | Comment and note bodies are trimmed, must be 1 to 2000 characters after trimming, and whitespace-only content is rejected. |
| BR-26 | Comments and notes are append-only in Lab 3. No edit or delete endpoint exists. |
| BR-27 | The author and creation time of a comment or note are taken from the authenticated session and the server clock, never from the request body. |
| BR-28 | Comment bodies are rendered as text, never as HTML, so stored markup cannot execute. |
| BR-29 | A Requester requesting Internal Notes is rejected without any note content, count, or existence hint in the response. |
| BR-30 | The IT Staff Ticket Queue searches Ticket Number and Summary, filters by Current Status, IT Priority, Category, and owned/unassigned, sorts by Created Date, Last Updated, Ticket Number, IT Priority, or Current Status, and paginates with a default page size of 10 and a maximum of 50. An invalid or out-of-range parameter is clamped rather than rejected. |
| BR-31 | Default queue ordering is Last Updated descending, with id descending as a stable tie-break. |
| BR-32 | An Administrator may not deactivate their own account. |
| BR-33 | The system must always retain at least one active Administrator; deactivating or changing the role of the last active Administrator is rejected. |
| BR-34 | Creating or editing a user with an email address already held by another user is rejected with 409 and no change is written. |
| BR-35 | Users are deactivated, never deleted. No delete endpoint exists. |
| BR-36 | Setting a new initial password flags the account as requiring a password change and deletes that user's existing sessions. |
| BR-37 | A user name is 2 to 80 characters after trimming; an email address is at most 120 characters and must be syntactically valid. |
| BR-38 | The user list searches name and email case-insensitively and partially, accepts one optional role filter, and is returned unpaginated. |
| BR-39 | Seeded credentials are local development fixtures, documented in the README, and no real personal password or secret is committed to the repository. |
| BR-40 | The migration preserves every Lab 2 Ticket, Attachment, and Requester identity; no row is dropped and no ownership moves. |

### 5.1 Authorization matrix

Every row is enforced in the backend. "Own" means the authenticated user is the Ticket's Requester.

| Operation | Requester | IT Staff | Administrator |
| :-- | :-: | :-: | :-: |
| Log in, log out, read own identity | Yes | Yes | Yes |
| Change own password | Yes | Yes | Yes |
| Create a Ticket | Yes | No | No |
| List Tickets | Own only | Queue (all) | Queue (all) |
| Read one Ticket | Own only | Any | Any |
| Upload / download / remove an Attachment | Own only | Read any | Read any |
| Post a Public Comment | Own only | Any | Any |
| Read Public Comments | Own only | Any | Any |
| Create or read an Internal Note | No | Any | Any |
| Indicate "Problem Appears Resolved" | Own only | No | No |
| Claim or reassign a Ticket Owner | No | Yes | Yes |
| Set IT Priority | No | Yes | Yes |
| Change Ticket status | No | Yes | Yes |
| List, create, or edit users | No | No | Yes |
| Set a new initial password | No | No | Yes |

An Administrator is deliberately **not** given ticket-creation rights: Administrators manage
accounts, IT Staff manage Tickets. Administrators do inherit IT Staff ticket-operation rights,
because the handout permits it where the matrix says so explicitly and because a single-Administrator
test environment otherwise cannot exercise a staff path.

### 5.2 Status transition matrix

Rows are the current status, columns the target. Only IT Staff and Administrators may perform any
transition (BR-05, BR-22).

| From \ To | Open | In Progress | Waiting for Requester | Resolved | Closed | Reopened | Cancelled |
| :-- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| New | Yes | Yes | No | No | No | No | Yes |
| Open | — | Yes | Yes | No | No | No | Yes |
| In Progress | No | — | Yes | Yes | No | No | Yes |
| Waiting for Requester | No | Yes | — | Yes | No | No | Yes |
| Resolved | No | No | No | — | Yes | Yes | No |
| Closed | No | No | No | No | — | Yes | No |
| Reopened | No | Yes | Yes | No | No | — | Yes |
| Cancelled | No | No | No | No | No | No | — |

Resolved and Closed additionally require a Ticket Owner (BR-23). Cancelled is terminal; Closed is
terminal except for a Reopen.

## 6. UI Specification Summary

See `docs/lab-03/ui-spec.md`. Lab 3 adds no new design language: the Zen Green tokens, field
states, button hierarchy, badge shapes, breakpoints, and accessibility rules from
`docs/lab-02/ui-spec.md` remain in force and are reused unchanged.

New in this sprint: a Login screen and a mandatory Change Password screen, both outside the
application shell; an authenticated shell header showing the user's name and role badge with a
Logout action; role-specific navigation; an IT Staff Ticket Queue (desktop table, stacked cards
below 768px); an IT Staff Ticket Detail extending the Lab 2 Ticket screen with an ownership and
workflow panel and two visually distinct conversation streams; and a single Administrator User
Management screen. Badge families are extended for Current Status, IT Priority, and Role, each
with its own colour ramp so a status badge is never mistaken for a priority badge.

## 7. Data Changes

### 7.1 Models

- **User** — the Lab 2 `Requester` table, renamed and extended: `id`, `name`, `email` (unique, lower-cased), `passwordHash`, `role` (enum `REQUESTER`/`IT_STAFF`/`ADMINISTRATOR`, default `REQUESTER`), `isActive` (default `true`), `mustChangePassword` (default `true`), `createdAt`, `updatedAt`.
- **Session** — `id` (the opaque token, primary key), `userId` (FK → User, cascade delete), `expiresAt`, `createdAt`.
- **TicketComment** — `id`, `ticketId` (FK → Ticket), `authorId` (FK → User), `visibility` (enum `PUBLIC`/`INTERNAL`), `body`, `createdAt`.
- **Ticket** — gains `ownerId` (nullable FK → User), `itPriority` (enum `LOW`/`MEDIUM`/`HIGH`/`URGENT`), and `requesterResolvedAt` (nullable). `requesterId` keeps its name and its values.
- **TicketStatus** — the Lab 2 enum, which had only `NEW`, is extended with `OPEN`, `IN_PROGRESS`, `WAITING_FOR_REQUESTER`, `RESOLVED`, `CLOSED`, `REOPENED`, `CANCELLED`.
- **Category**, **RelatedSystem**, **Attachment** — unchanged.

Relationships: one User → many Tickets as Requester, and separately many Tickets as Owner (two
named relations on the same pair of models); one Ticket → zero-or-one Owner; one Ticket → many
TicketComments; one TicketComment → one author.

Indexes: `User.email` unique; `Session.userId` indexed (logout-all and deactivation both delete by
user); `Ticket.ownerId` indexed and `Ticket.currentStatus` indexed (both are queue filters);
`TicketComment.ticketId` indexed (always fetched per ticket). Existing Lab 2 indexes are untouched.

### 7.2 Migration from Lab 2

The migration is written by hand after `prisma migrate dev --create-only`. Prisma's generated diff
for a model rename is a `DROP TABLE` followed by a `CREATE TABLE`, which would destroy every
Requester row and cascade into the Tickets that reference them. The hand-written SQL instead:

1. `ALTER TABLE "Requester" RENAME TO "User"`, with the primary key, sequence, and unique index renamed alongside it.
2. Adds `passwordHash`, `role`, `mustChangePassword`, and `updatedAt` to `User`.
3. Backfills existing rows: `role = 'REQUESTER'`, `mustChangePassword = true`, and `passwordHash` set to the hash of the documented initial development password, so every migrated Requester can sign in once and must then choose a new password.
4. Adds the new enum values to `TicketStatus`, and creates the `Role`, `ItPriority`, and `CommentVisibility` enums.
5. Adds `ownerId`, `itPriority`, and `requesterResolvedAt` to `Ticket`, backfilling `itPriority` from each Ticket's existing `requestedPriority` and leaving `ownerId` null.
6. Creates `Session` and `TicketComment`.

`Ticket.requesterId` is deliberately left named as it was. Renaming it would touch every existing
row's foreign key for cosmetic benefit; the Prisma field maps to `User` through a named relation
instead. That decision is what makes "no ownership moved" checkable rather than merely asserted:
the column, its values, and its constraint are the same objects before and after.

The selector's client-side state (the `localStorage` key written by Lab 2's `RequesterProvider`) is
removed with the provider. No migration is needed for it — an unread key is harmless, and the
Login screen is the only entry point after this sprint.

### 7.3 Seed data

Idempotent `upsert` by email, as in Lab 2, so re-running never duplicates:

- the five Lab 2 Requesters (four active, one inactive), keeping their identities so their Tickets stay attached;
- three active IT Staff and one inactive IT Staff;
- one active Administrator;
- Tickets spread across every status, both priorities, and owned as well as unassigned;
- example Public Comments and Internal Notes containing no sensitive information.

All seeded accounts share a single documented development password and are created with
`mustChangePassword` set, so the first-login flow is exercised by anyone running the project
locally. The password lives in the README, not in a `.env` file pretending to be a secret.

## 8. API Contract

See `docs/lab-03/api-spec.md` for the endpoint-by-endpoint contract, the session mechanism, and the
status-code table.

## 9. Acceptance Criteria

| ID | Criterion |
| --- | --- |
| AC-01 | Given an active user with valid credentials, when the user logs in, then the backend establishes authenticated access and returns the permitted user identity and role. |
| AC-02 | Given a user who must change the initial password, when login succeeds, then normal application screens remain unavailable until a valid new password is saved. |
| AC-03 | Given an authenticated Requester, when the client supplies another `requesterId`, then the backend still applies the authenticated identity and does not return another Requester's data. |
| AC-04 | Given a Requester account, when an Internal Note endpoint is requested, then the operation is rejected without exposing note content. |
| AC-05 | Given an inactive account with an otherwise correct password, when login is attempted, then it fails with the same message as a wrong password and no session is created. |
| AC-06 | Given a wrong password for an existing email, and a password for an email that does not exist, then the two responses are identical in body and status. |
| AC-07 | Given a login request is in flight, when the response has not arrived, then the submit control shows a busy state and cannot be submitted again. |
| AC-08 | Given an authenticated session, when the user logs out, then the session row is deleted and reusing the same cookie returns 401. |
| AC-09 | Given a session older than its expiry, when any protected endpoint is called, then the request is treated as unauthenticated. |
| AC-10 | Given a user whose account is deactivated while signed in, when their next request arrives, then it is rejected as unauthenticated. |
| AC-11 | Given a new password shorter than 8 characters, or not matching its confirmation, or identical to the current password, when submitted, then it is rejected with a field-level message and the flag remains set. |
| AC-12 | Given a valid password change, when it completes, then the user reaches the application and a subsequent login with the old password fails. |
| AC-13 | Given an authenticated Requester, when the application shell renders, then it shows their name and role and offers no IT Staff or Administrator destination. |
| AC-14 | Given an authenticated Requester, when the IT Staff queue or an Administrator user endpoint is called directly, then the response is 403 and no data is returned. |
| AC-15 | Given a Requester who owns Tickets created in Lab 2, when they sign in after the migration, then those Tickets and their Attachments are still listed, downloadable, and unchanged. |
| AC-16 | Given an authenticated Requester creates a Ticket, when the request omits any requester identity, then the Ticket is saved against the session's user. |
| AC-17 | Given a Ticket owned by another Requester, when its detail, attachment, or download URL is requested, then the response is 404, identical to a nonexistent Ticket. |
| AC-18 | Given an owned Ticket, when the Requester posts a Public Comment, then it appears with the backend's author and timestamp and is visible to IT Staff. |
| AC-19 | Given a whitespace-only comment body, when posted, then it is rejected and nothing is stored. |
| AC-20 | Given an owned Ticket, when the Requester indicates the problem appears resolved, then the indication is recorded and `currentStatus` is unchanged. |
| AC-21 | Given a Requester attempts to set a Ticket to Resolved or Closed directly, then the request is rejected with 403. |
| AC-22 | Given authenticated IT Staff, when the Ticket Queue loads, then Tickets from every Requester are listed with ownership, status, and both priorities visible. |
| AC-23 | Given a queue search term matching no Ticket Number or Summary, when the search runs, then the No-Results state is shown, distinct from the Empty state. |
| AC-24 | Given a status filter and an IT Priority filter applied together, when the queue loads, then only Tickets matching both are returned. |
| AC-25 | Given a sort by IT Priority descending, when the queue renders, then Tickets appear Urgent → High → Medium → Low with Last Updated descending as the tie-break. |
| AC-26 | Given an out-of-range or non-numeric `page` or `pageSize`, when the queue loads, then the value is clamped to the nearest valid bound rather than rejected. |
| AC-27 | Given an unassigned Ticket, when IT Staff claim it, then they become its Ticket Owner and the change is visible in the queue. |
| AC-28 | Given an assigned Ticket, when IT Staff reassign it to another active IT Staff user, then ownership moves and `updatedAt` advances. |
| AC-29 | Given an attempt to assign a Requester or an inactive user as Ticket Owner, then the request is rejected and ownership is unchanged. |
| AC-30 | Given a Ticket at New, when IT Staff set IT Priority to Urgent, then Requested Priority is unchanged and both are displayed separately. |
| AC-31 | Given a Ticket at In Progress, when a transition to Closed is attempted, then it is rejected with 409 and the status is unchanged. |
| AC-32 | Given a Ticket at In Progress with an owner, when it is set to Resolved, then the transition succeeds. |
| AC-33 | Given an unassigned Ticket, when it is set to Resolved, then the transition is rejected. |
| AC-34 | Given IT Staff create an Internal Note, when the owning Requester opens the same Ticket, then the note is absent from the response entirely, while Public Comments are present. |
| AC-35 | Given an authenticated Administrator, when User Management loads, then every user is listed with Name, Email, Role, Status, and an Edit action. |
| AC-36 | Given a search term matching part of a name or email, when the user search runs, then only matching users are listed; with a role filter applied, only matching users of that role. |
| AC-37 | Given a new user with a name, email, one role, and an initial password, when created, then the user can sign in once and is immediately required to change the password. |
| AC-38 | Given an email address already held by another user, when a user is created or edited with it, then the request is rejected with 409 and nothing is written. |
| AC-39 | Given an Administrator editing their own account, when they attempt to deactivate it, then the request is rejected. |
| AC-40 | Given exactly one active Administrator, when an attempt is made to deactivate them or change their role, then the request is rejected. |
| AC-41 | Given an Administrator sets a new initial password for a user, when that user next signs in, then the old password fails, the new one works, and the password change screen appears. |
| AC-42 | Given a mobile viewport (<768px), when Login, Change Password, Ticket Queue, IT Staff Ticket Detail, or User Management render, then no control is clipped and the page does not scroll horizontally. |
| AC-43 | Given a keyboard-only user tabs through Login, Change Password, and User Management, then a visible focus indicator appears on every interactive control. |
| AC-44 | Given the API is unreachable, when any Lab 3 screen loads or submits, then a safe failure state is shown with no stack trace, SQL, or internal identifier. |

## 10. Definition of Done

**Product completion**
- Every FR/BR/AC above is implemented and traceable to at least one passing automated test in `docs/lab-03/tests.md`.
- No required test is skipped, disabled, or commented out; all pass from a documented command on the final `main` branch.
- Every rule in the §5.1 authorization matrix is enforced server-side and proved by a direct API test, not by a UI assertion.
- The migration is proved by an automated test that Lab 2 Tickets and Attachments survive it with ownership intact.
- No endpoint ever returns a password hash, and no error message distinguishes a wrong password from an unknown or inactive account.
- All screen states (loading, saving, success, validation, empty, no-results, forbidden, not-found, conflict, safe failure) match `ui-spec.md`.
- Responsive behavior verified at desktop/tablet/mobile with no clipping or horizontal scroll.
- README documents the seeded accounts, the development password, and the Lab 3 scripts.

**Course delivery**
- Each Issue implemented on its own feature branch, merged into `lab3-staging` via peer-reviewed PR, then one release PR `lab3-staging → main`.
- `docs/lab-03/reviewer.md` and `docs/lab-03/ai-use.md` completed.
- GitHub Project Kanban shows all Lab 3 Issues in Done.

## 11. Assumptions and Decisions

- **Session mechanism.** An opaque random token in an httpOnly cookie, backed by a `Session` table, rather than a JWT. Logout must genuinely invalidate access (BR-10), and a stateless JWT cannot do that without a denylist — which is a session table with extra steps. The token is 32 bytes from `crypto.randomBytes`, so it carries no user data to leak, and `SameSite=Lax` plus a JSON-only API is the CSRF posture; no cross-site form posts exist to protect.
- **Password hashing.** `bcryptjs` at cost 10. It is pure JavaScript, so the project keeps building on any machine without a native toolchain, and cost 10 is the common default — fast enough that the test suite is not dominated by hashing, slow enough to be a real barrier. bcrypt's 72-byte input limit is why BR-13 caps the password at 72 characters rather than leaving it unbounded.
- **Renaming the table instead of creating a new one.** §7.2 explains the mechanics. The alternative — a new `User` table with a copy step — leaves a dead `Requester` table behind and requires repointing a live foreign key. Renaming keeps the foreign key untouched, which is both less risky and easier to prove.
- **One comment model, not two.** `TicketComment` with a `visibility` enum, rather than separate `PublicComment` and `InternalNote` models. BR-04 then becomes a single filter applied in one place and tested once, instead of two parallel code paths that can drift apart. The UI still presents them as two visually distinct streams, which is where the distinction actually matters to a user.
- **Administrators inherit IT Staff ticket operations.** The handout asks that the two responsibilities stay conceptually separate but permits the authorization matrix to say otherwise explicitly. §5.1 does. An Administrator cannot create Tickets, so the separation that matters — account management versus ticket intake — holds.
- **IT Priority gains an `URGENT` level.** Requested Priority stays `LOW`/`MEDIUM`/`HIGH`, because that is what the Requester-facing form offers and changing it would break Lab 2 data. IT Priority is a separate operational judgement and needs a level above the Requester's ceiling, or the two fields would be indistinguishable in practice.
- **Claiming does not change status.** Ownership and status are independent axes, and coupling them would hide a status transition inside an ownership action, making the transition matrix untestable. Moving a claimed Ticket from New to Open stays an explicit second action.
- **Requester "appears resolved" posts a comment.** A bare timestamp is invisible to IT Staff scanning a ticket. Recording the indication and also posting a Public Comment (BR-24) means the signal lands where the conversation already is.
- **The user list is unpaginated.** The handout excludes mandatory pagination, and a lab-scale deployment has tens of users. Search plus an optional role filter is enough; adding pagination would be scope the handout explicitly removed.
- **New dependencies.** `bcryptjs` and `cookie-parser` on the server. Nothing new on the client — the auth context is built with the same React primitives as Lab 2's `RequesterProvider`, and `credentials: 'include'` is a `fetch` option, not a library.
