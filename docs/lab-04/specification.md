# Lab 4 Sprint Engineering Specification

Rule, requirement and criterion numbers in this document start again at 01, as the handout's own
examples do. A rule from an earlier sprint is cited with its lab, for example "Lab 3 BR-23".
Everything in `docs/lab-02/specification.md` and `docs/lab-03/specification.md` stays in force
unless a rule below says it is amended.

## 1. Sprint Goal

Let IT Staff record the work they actually did on a Ticket, make the Ticket's formal status depend
on that record, and give each role a dashboard that counts what the detailed screens already hold.
Then harden the whole application so that every earlier feature still works, looks like one
product, and fails safely.

## 2. Stakeholder Request Interpretation

After Lab 3 a Ticket carries a conversation but no account of the work. A Public Comment says what
was said to the Requester, an Internal Note says what staff told each other, and neither answers
"what was done, by whom, and is it finished?". Actions Taken is that record: a dated line of work
under one Ticket, with what was done, what came of it, who did it, and whether more is needed.

The Ticket Owner still coordinates the Ticket. Recording work is a different thing from owning it:
a network engineer can replace a switch on a Ticket a colleague owns, and the record should carry
the engineer's name, not the owner's.

The Requester can still say the problem appears resolved, and that still changes nothing by
itself. What changes in this sprint is the other side of that sentence: IT Staff may only mark a
Ticket Resolved when the record of work supports it. That rule is the resolution gate (BR-13), and
it is enforced where the status is written, not where the button is drawn.

Dashboards are a starting point, not a second set of screens. Each number is a count of something
a list already shows, and following it opens that list with the same filter.

The last part of the request is the least visible: nothing from Labs 1 to 3 may stop working, and
what was temporary in earlier sprints is removed.

## 3. Scope

### Included
- Actions Taken under a Ticket: list, create and edit for IT Staff and Administrators, read-only for the owning Requester
- The final Ticket status transition matrix with authorized roles and preconditions
- The resolution gate, enforced by the backend
- Detection of stale workflow changes and stale Action Taken edits
- Requester Dashboard and IT Staff Dashboard, with user-account counts added for Administrators
- Drill-down from every dashboard count to a filtered list, and the list filters that needs
- Dashboard navigation and landing page for every role
- An additive migration with a tested rollback, and seed data for Actions Taken and dashboards
- Final hardening: repeated-submission safety, form data kept after recoverable failures, removal of obsolete and unfinished UI, consistent feedback states
- Regression of every Lab 1 to Lab 3 behaviour

### Excluded
- SLA clocks, escalation, on-call scheduling and breach notifications
- Email, SMS, LINE, push or any other external notification
- Inventory, spare parts, purchasing and cost accounting
- Time-sheet billing, payroll and labour-cost calculation
- Approval workflows and electronic signatures
- Report builders, exports and business-intelligence tooling
- Multi-tenant organizations and production cloud operations
- A per-action assignee, a per-action status, or planned future work items: an Action Taken records work that was done (see §11)
- Deleting an Action Taken, and file upload on an Action Taken: Attachment Notes is text that says which file to look for
- Any feature not listed under Included

## 4. Functional Requirements

### Actions Taken
- **FR-01** List the Actions Taken of a Ticket on the IT Staff Ticket Detail screen, in a fixed order.
- **FR-02** Let IT Staff and Administrators create an Action Taken with Action Date/Time, Action Description, Result, Follow-Up Required, Follow-up Note and Attachment Notes. Performed by is set by the system.
- **FR-03** Let IT Staff and Administrators edit an existing Action Taken, keeping a visible trace of who last edited it and when.
- **FR-04** Show the Requester every Action Taken on a Ticket they own, read-only.

### Ticket workflow
- **FR-05** Enforce the final status transition matrix in §5.2 on the backend, for the authorized roles only.
- **FR-06** Enforce the resolution gate on every move to Resolved.
- **FR-07** Detect a workflow change made from an out-of-date copy of the Ticket and refuse it.
- **FR-08** Offer only the permitted transitions on the screen, state the reason when one is blocked, and refresh the Ticket summary after a successful change.

### Dashboards
- **FR-09** Provide a Requester Dashboard summarising only the authenticated Requester's Tickets.
- **FR-10** Provide an IT Staff Dashboard with operational counts, recent Tickets and the current user's own Actions Taken.
- **FR-11** Give an Administrator the IT Staff Dashboard with user-account counts added.
- **FR-12** Link every dashboard count to a list filtered the same way, and support those filters on My Tickets and the Ticket Queue.
- **FR-13** Add Dashboard to each role's navigation and make it the page each role lands on.

### Hardening
- **FR-14** Make repeated submission of the same form, by double click or retry, safe.
- **FR-15** Keep what the user typed when a submission fails in a way they can recover from.
- **FR-16** Remove obsolete and unfinished UI: the Lab 1 Check System page becomes an Administrator-only System Status page with no control that does nothing.
- **FR-17** Give loading, validation, success, empty, no-results, forbidden, conflict, not-found and failure feedback the same form on every screen.

### Data
- **FR-18** Migrate the database without losing or changing any Lab 3 row, with a rollback that is tested.
- **FR-19** Seed Tickets with zero, one and several Actions Taken, and data that yields both zero and non-zero dashboard counts, safely repeatable.
- **FR-20** Keep every Lab 1, Lab 2 and Lab 3 function working for the roles permitted to use it.

## 5. Business Rules

| ID | Rule |
| --- | --- |
| BR-01 | An Action Taken belongs to exactly one Ticket and never moves to another. |
| BR-02 | The Ticket Owner coordinates the Ticket. Any active IT Staff or Administrator user may record an Action Taken on any Ticket, whether or not they own it, and doing so does not change the Ticket Owner. |
| BR-03 | Performed by is the authenticated user at the moment of creation. It is never taken from the request body and never changes afterwards. |
| BR-04 | Only IT Staff and Administrators create or edit an Action Taken. A Requester reads the Actions Taken of a Ticket they own and nothing else; for any other Ticket the answer is 404, identical to a Ticket that does not exist (Lab 3 BR-18). |
| BR-05 | Action Date/Time is required and is compared to the minute, because that is the precision the form holds. It may not be earlier than the minute in which the Ticket was created (the Ticket's creation time with its seconds dropped), and may not be more than 5 minutes later than the server clock. |
| BR-06 | Action Description is 1 to 2000 characters after trimming. Result is 1 to 1000 characters after trimming. Attachment Notes is optional, at most 500 characters after trimming, and stored as null when empty. |
| BR-07 | Follow-up Note is required, 1 to 1000 characters after trimming, when Follow-Up Required is yes. When Follow-Up Required is no the note is stored as null whatever was sent. A database constraint holds the same rule. |
| BR-08 | An Action Taken may be created or edited only while the Ticket is active (BR-22). On a Resolved, Closed or Cancelled Ticket both are refused with 409. |
| BR-09 | An Action Taken is never deleted, and no delete endpoint exists. An edit may change the six entered fields only. Its Ticket, Performed by and creation time are fixed, and each edit records the editor and the time. |
| BR-10 | Actions Taken are ordered by Action Date/Time descending, then id descending. The first row in that order is the Ticket's latest Action Taken. |
| BR-11 | Creating or editing an Action Taken advances the Ticket's `updatedAt`. It changes no other Ticket field. |
| BR-12 | The Ticket statuses remain New, Open, In Progress, Waiting for Requester, Resolved, Closed, Reopened and Cancelled. A status changes only along the matrix in §5.2 and only by IT Staff or an Administrator. Any other move is refused with 409 and nothing is written. |
| BR-13 | Resolution gate. A Ticket may be moved to Resolved only when it has a Ticket Owner, has at least one Action Taken, and its latest Action Taken does not require follow-up. |
| BR-14 | Closed still requires a Ticket Owner (Lab 3 BR-23) and is reached only from Resolved. The gate is not checked again on closing, so a Ticket resolved before this sprint, with no Actions Taken, can still be closed. |
| BR-15 | A Requester's "Problem Appears Resolved" indication remains advisory (Lab 3 BR-24). It changes no status and does not satisfy any part of the gate. |
| BR-16 | A Ticket carries a version number that increases by one each time its status, Ticket Owner or IT Priority changes, whoever or whatever changes it. A request to change any of the three must state the version it was based on. If that is not the Ticket's current version the request is refused with 409 and nothing is written. |
| BR-17 | An Action Taken carries its own version number that increases by one on each edit. An edit must state the version it was based on, and a mismatch is refused with 409, returning the current Action Taken. |
| BR-18 | `resolvedAt` is set to the server time when a Ticket enters Resolved, is kept when it is Closed, and is cleared when it is Reopened. |
| BR-19 | Reopening also clears the Requester's indication, as in Lab 3. A reopened Ticket must pass the gate again before it can be Resolved. |
| BR-20 | Creating an Action Taken carries a request key chosen by the client. Sending the same key again for the same Ticket by the same user returns the Action Taken already created and creates nothing. |
| BR-21 | Every dashboard number is computed by the backend at request time from the Ticket, Action Taken and User tables. No count is stored. |
| BR-22 | An active Ticket is one whose status is New, Open, In Progress, Waiting for Requester or Reopened. |
| BR-23 | The Requester Dashboard counts and lists only Tickets whose Requester is the authenticated user. No parameter widens it. |
| BR-24 | Every dashboard count that has a drill-down equals the total of the list it links to, because both are built from the same filter. |
| BR-25 | Where a metric depends on a calendar day, the day is the Asia/Bangkok day (UTC+7, no daylight saving). "Today" starts at 00:00 Bangkok time. "The last 7 days" starts at 00:00 Bangkok time six days before today. Timestamps are stored and sent in UTC. |
| BR-26 | A dashboard list holds at most 5 rows, in the order §5.3 gives, with id descending as the final tie-break. |
| BR-27 | Nothing to count is a result, not a failure: a count is 0 and a list is empty. A dashboard never answers with an error because there is no data. |
| BR-28 | A dashboard response carries counts and short rows only. It never carries a Ticket description, a comment, a note, an attachment or an email address. |
| BR-29 | User-account counts are returned to an Administrator only. For IT Staff the field is absent, not empty. |
| BR-30 | A control that submits is disabled from the moment it is used until the response arrives. |
| BR-31 | After a validation error, a conflict, a network failure or a server error, the form still holds what the user entered. |
| BR-32 | The Lab 4 migration adds and never removes. Every Lab 3 User, Session, Ticket, Attachment, Public Comment and Internal Note keeps its values. An existing Ticket starts with version 1 and no Actions Taken, and `resolvedAt` is filled from `updatedAt` for a Ticket that is already Resolved or Closed. |

### 5.1 Authorization matrix (additions and changes)

Every row is enforced in the backend. Rows from Lab 3 that are not listed here are unchanged.

| Operation | Requester | IT Staff | Administrator |
| :-- | :-: | :-: | :-: |
| Read the Actions Taken of a Ticket | Own only | Any | Any |
| Create an Action Taken | No | Any active Ticket | Any active Ticket |
| Edit an Action Taken | No | Any, on an active Ticket | Any, on an active Ticket |
| Delete an Action Taken | No | No | No |
| Change Ticket status, Ticket Owner or IT Priority | No | Yes, with the current version | Yes, with the current version |
| Read the Requester Dashboard | Own data | No | No |
| Read the IT Staff Dashboard | No | Yes | Yes, with user counts |
| Open System Status | No | No | Yes |

An inactive account cannot do any of this: its session is rejected on the next request
(Lab 3 BR-12), so a user deactivated while signed in cannot record an Action Taken.

### 5.2 Final status transition matrix

Rows are the current status, columns the target. The cells are those of Lab 3; this sprint adds the
authorized roles and the preconditions as part of the matrix.

| From \ To | Open | In Progress | Waiting for Requester | Resolved | Closed | Reopened | Cancelled |
| :-- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| New | Yes | Yes | No | No | No | No | Yes |
| Open | - | Yes | Yes | No | No | No | Yes |
| In Progress | No | - | Yes | Gate | No | No | Yes |
| Waiting for Requester | No | Yes | - | Gate | No | No | Yes |
| Resolved | No | No | No | - | Owner | Yes | No |
| Closed | No | No | No | No | - | Yes | No |
| Reopened | No | Yes | Yes | No | No | - | Yes |
| Cancelled | No | No | No | No | No | No | - |

| Aspect | Rule |
| :-- | :-- |
| Authorized roles | IT Staff and Administrator, for every permitted cell. A Requester may perform none (403). |
| Every transition | The request states the Ticket version it was based on (BR-16). |
| "Gate" cells | The resolution gate (BR-13): a Ticket Owner, at least one Action Taken, and a latest Action Taken with no follow-up required. |
| "Owner" cell | A Ticket Owner (Lab 3 BR-23). |
| Order of refusal | Stale version first, then a move outside the matrix, then a missing owner, then the rest of the gate. One reason is reported. |
| Terminal statuses | Cancelled leads nowhere. Closed leads only to Reopened. |
| Side effects | Entering Resolved sets `resolvedAt`. Entering Reopened clears `resolvedAt` and the Requester's indication. |

### 5.3 Dashboard metrics

`me` is the authenticated user. "Active" is BR-22. A drill-down is a query string on the role's own
list screen: My Tickets (`/tickets`) for a Requester and the Ticket Queue (`/staff/tickets`) for
staff.

**Requester Dashboard**

| Key | Label | Calculation | Drill-down |
| :-- | :-- | :-- | :-- |
| `openTickets` | Open Tickets | Tickets where Requester = me and status is active | `/tickets?status=ACTIVE` |
| `waitingForYou` | Waiting for You | Requester = me and status = Waiting for Requester | `/tickets?status=WAITING_FOR_REQUESTER` |
| `resolved` | Resolved | Requester = me and status = Resolved | `/tickets?status=RESOLVED` |
| `closed` | Closed | Requester = me and status = Closed | `/tickets?status=CLOSED` |

| List | Rows | Order | Row opens |
| :-- | :-- | :-- | :-- |
| `needsAttention` | Requester = me and status = Waiting for Requester | `updatedAt` ascending, so the longest wait is first | Ticket Detail |
| `recentlyUpdated` | Requester = me | `updatedAt` descending | Ticket Detail |
| `recentlyResolved` | Requester = me, status Resolved or Closed, `resolvedAt` within the last 7 days | `resolvedAt` descending | Ticket Detail |

**IT Staff Dashboard**

| Key | Label | Calculation | Drill-down |
| :-- | :-- | :-- | :-- |
| `unassigned` | Unassigned | No Ticket Owner and status is active | `/staff/tickets?owner=unassigned&status=ACTIVE` |
| `myTickets` | My Tickets | Ticket Owner = me and status is active | `/staff/tickets?owner=me&status=ACTIVE` |
| `urgent` | Urgent | IT Priority = Urgent and status is active | `/staff/tickets?itPriority=URGENT&status=ACTIVE` |
| `myActionsToday` | My Actions Today | Actions Taken where Performed by = me and Action Date/Time is within today | None: the list below it on the dashboard is the detail |
| `byStatus` (8 rows) | Tickets by Status | Tickets with each status, all eight always present, zero included | `/staff/tickets?status=<STATUS>` |
| `users` (Administrator only) | Active Users, Inactive Users | Users where `isActive` is true, and false | `/admin/users` |

| List | Rows | Order | Row opens |
| :-- | :-- | :-- | :-- |
| `recentlyUpdated` | All Tickets | `updatedAt` descending | IT Staff Ticket Detail |
| `myRecentActions` | Actions Taken where Performed by = me | Action Date/Time descending | IT Staff Ticket Detail, at its Actions Taken area |

Treatment of existing records: a Ticket from before this sprint is counted by its current status
like any other. It has no Actions Taken, so it contributes nothing to the action metrics. A legacy
Resolved or Closed Ticket takes `resolvedAt` from its `updatedAt` (BR-32), so it appears under
Recently resolved only if that was within the last 7 days.

## 6. UI Specification Summary

See `docs/lab-04/ui-spec.md`. No new design language: the Zen Green tokens, components, breakpoints
and accessibility rules of Labs 2 and 3 are reused.

New in this sprint: a Dashboard for each role, built from metric cards that are links and short
lists whose rows are links; an Actions Taken area on both Ticket Detail screens, a table on desktop
and cards below 768px, with one dialog that serves create, view and edit; a Resolved option in the
status control that is disabled with the server's reason while the gate is not met; Dashboard as
the first navigation item and the landing page; and the Lab 1 Check System page reduced to an
Administrator-only System Status page. The Requester sees Actions Taken read-only and still sees no
trace of Internal Notes.

## 7. Data Changes

### 7.1 Models

- **ActionTaken** (new): `id`, `ticketId` (FK to Ticket), `performedById` (FK to User), `actionAt`, `description`, `result`, `followUpRequired` (default false), `followUpNote` (nullable), `attachmentNotes` (nullable), `version` (default 1), `requestKey` (unique), `editedById` (nullable FK to User), `editedAt` (nullable), `createdAt`. `editedById` and `editedAt` are both null until the first edit and are set together by every edit; they are what the API returns as `editedBy` and `editedAt`. There is deliberately no `@updatedAt` column: Prisma sets one on insert, so it could not mean "never edited".
- **Ticket** gains `version` (integer, default 1) and `resolvedAt` (nullable timestamp).
- **User**, **Session**, **TicketComment**, **Attachment**, **Category**, **RelatedSystem**: unchanged.

Relationships: one Ticket has many Actions Taken; one User has performed many, and has last edited
many. Both foreign keys to User and the one to Ticket restrict deletion, which matches the product:
neither Users nor Tickets are ever deleted.

Indexes: `ActionTaken(ticketId, actionAt)` serves the per-Ticket list and the gate's "latest
action" lookup; `ActionTaken(performedById, actionAt)` serves the two "my actions" dashboard
queries; `ActionTaken.requestKey` unique; `Ticket(updatedAt)` serves the recently-updated lists.
The Lab 3 indexes on `Ticket.requesterId`, `ownerId` and `currentStatus` already serve the counts.

Constraint: `CHECK ("followUpRequired" = ("followUpNote" IS NOT NULL))`, so BR-07 holds even for a
write that never passed through the API's validation.

Design decisions, justified:

1. **A version integer, not the `updatedAt` timestamp, detects stale changes.** `updatedAt` also
   moves when an Action Taken is recorded (BR-11), so comparing it would refuse a priority change
   because a colleague logged unrelated work. The version moves only when status, owner or
   priority does, which is exactly what a workflow change can overwrite.
2. **`resolvedAt` is a column, not derived.** "Resolved in the last 7 days" cannot be read from
   `updatedAt`, which moves again when the Ticket is closed. Storing the moment keeps the metric a
   plain indexed comparison and keeps its meaning after later changes.
3. **Follow-up consistency is a database constraint.** The resolution gate reads `followUpRequired`
   on the latest Action Taken, so a row that says "follow-up required" with no note, or the
   reverse, would be a gate deciding on nonsense. The check makes that state unrepresentable.
4. **Dashboard counts are queried, not stored.** A counter column would have to be kept right by
   every route that changes a status or an owner, including the unassign that deactivating a user
   causes. At this data size a `COUNT` on an indexed column is immediate, and it cannot disagree
   with the list.

### 7.2 Migration, backfill and recovery

One migration, written by hand after `prisma migrate dev --create-only` and applied with
`prisma migrate deploy`. It only adds:

1. `Ticket.version` as `INTEGER NOT NULL DEFAULT 1`, so every existing Ticket starts at version 1.
2. `Ticket.resolvedAt`, then `UPDATE "Ticket" SET "resolvedAt" = "updatedAt" WHERE "currentStatus" IN ('RESOLVED','CLOSED')`.
3. The `ActionTaken` table with its foreign keys, indexes, unique key and check constraint.
4. The index on `Ticket(updatedAt)`.

Legacy Tickets have no Actions Taken and none is invented for them. Their behaviour follows from
the rules above: an active one must have work recorded before it can be Resolved, and one that is
already Resolved or Closed is left valid (BR-14).

Recovery: `server/prisma/rollback/lab4_down.sql` drops the table, the two columns and the index,
and removes the migration's row from `_prisma_migrations`. It lives outside `prisma/migrations` so
Prisma never runs it by accident. Rolling back discards Actions Taken recorded since the migration
and nothing else, so the documented procedure is a `pg_dump` before `migrate deploy`.
`npm run db:migration-check` proves both directions on a throwaway database: it builds Lab 3 data,
fingerprints every row, applies the migration and compares, applies the rollback and compares
again, then re-applies the migration.

### 7.3 Seed data

The seed stays idempotent. Actions Taken are upserted by `requestKey`, using keys only the seed
writes (`seed:<ticket>:<n>`), so running it twice changes nothing.

| Ticket | Status | Actions Taken | Shows |
| :-- | :-- | :-- | :-- |
| TKT-2026-800001 | New, unassigned | 0 | A legacy-shaped Ticket: the gate refuses it |
| TKT-2026-800002 | In Progress, owned | 3, by two different staff, the latest requiring follow-up | BR-02, and the gate blocking on follow-up |
| TKT-2026-800003 | Waiting for Requester, owned | 1, no follow-up | A Ticket that passes the gate; the Requester's "Waiting for You" |
| TKT-2026-800004 | Resolved, owned | 2 | `resolvedAt` set; read-only Actions Taken |
| TKT-2026-800005 | Closed, owned | 1 | Closed with a record |
| TKT-2026-800006 | Open, unassigned | 0 | Unassigned count |
| TKT-2026-800007 | Cancelled | 0 | Terminal status |
| TKT-2026-800008 | Reopened, owned | 0 | Must pass the gate again |

Zero metrics are demonstrable without deleting anything: Grace Lim is a Requester with no Tickets,
and Aiko Tanaka is active IT Staff who owns no Ticket and has performed no Action Taken.

## 8. API Contract

See `docs/lab-04/api-spec.md` for every endpoint, shape, status code and conflict code.

## 9. Acceptance Criteria

| ID | Criterion |
| --- | --- |
| AC-01 | Given a permitted IT Staff user and valid data, when an Action Taken is created, then it is saved under the correct Ticket with the authenticated user as Performed by, whatever identity the request body carries. |
| AC-02 | Given an authenticated Requester, when dashboard data is retrieved, then only metrics and recent Tickets owned by that Requester are returned. |
| AC-03 | Given a Requester who owns a Ticket with Actions Taken, when they open it, then every Action Taken is shown with all seven fields and no control to add or edit one. |
| AC-04 | Given a Requester, when they call the create or edit Action Taken endpoint directly, then the response is 403 and nothing is written. |
| AC-05 | Given a Requester, when they request the Actions Taken of a Ticket they do not own, then the response is 404, identical to a Ticket that does not exist. |
| AC-06 | Given no session, when any Action Taken or dashboard endpoint is called, then the response is 401. |
| AC-07 | Given Follow-Up Required is yes and the Follow-up Note is empty, when the Action Taken is submitted, then it is rejected with a message on the Follow-up Note field and nothing is stored. |
| AC-08 | Given Follow-Up Required is no and a Follow-up Note is sent anyway, when the Action Taken is saved, then the note is stored as null. |
| AC-09 | Given a blank or over-long Action Description or Result, or an Action Date/Time that is missing, malformed, before the minute the Ticket was created in or more than 5 minutes ahead, when submitted, then each is rejected with a message on its own field. |
| AC-10 | Given a Ticket owned by one IT Staff user, when two other staff users each record an Action Taken, then both are listed with their own names and the Ticket Owner is unchanged. |
| AC-11 | Given an Action Taken performed by one user, when another staff user edits it, then the entered fields change, Performed by does not, the editor and time are recorded, and its version increases by one. |
| AC-12 | Given an edit based on an out-of-date version of an Action Taken, when it is submitted, then it is refused with 409, the current Action Taken is returned, and nothing is written. |
| AC-13 | Given a create request that is sent twice with the same request key, then one Action Taken exists and both responses carry its id. |
| AC-14 | Given a Resolved, Closed or Cancelled Ticket, when an Action Taken is created or edited, then the request is refused with 409 and nothing changes. |
| AC-15 | Given several Actions Taken, when the list is read repeatedly, then it is always ordered by Action Date/Time descending and then id descending, and a DELETE request for one finds no endpoint. |
| AC-16 | Given an Action Taken is created or edited, then the Ticket's `updatedAt` advances and its status, Ticket Owner, IT Priority and version are unchanged. |
| AC-17 | Given an IT Staff user who is deactivated while signed in, when they submit an Action Taken, then it is refused as unauthenticated and nothing is written. |
| AC-18 | Given each pair of statuses, when the transition is requested by IT Staff with its preconditions met, then the permitted cells of §5.2 succeed and every other cell is refused with 409 and no change. |
| AC-19 | Given an owned Ticket with no Action Taken, when a move to Resolved is requested, then it is refused with 409 and the reason names the missing Action Taken. |
| AC-20 | Given an owned Ticket whose latest Action Taken requires follow-up, when a move to Resolved is requested, then it is refused; and after a later Action Taken with no follow-up is recorded, the same request succeeds. |
| AC-21 | Given an owned Ticket whose latest Action Taken requires no follow-up, when it is moved to Resolved, then the move succeeds and `resolvedAt` is set. |
| AC-22 | Given an unassigned Ticket, when a move to Resolved is requested, then it is refused and the reason is the missing Ticket Owner. |
| AC-23 | Given a Ticket that was Resolved before this sprint and has no Action Taken, when it is Closed, then the move succeeds; and when it is Reopened, it cannot be Resolved again until the gate is met. |
| AC-24 | Given a Requester, when they call the status endpoint, then the response is 403; and when they indicate the problem appears resolved, the status is unchanged and a move to Resolved is still refused while the gate is not met. |
| AC-25 | Given a status, Ticket Owner or IT Priority change that states an out-of-date version, then it is refused with 409 and nothing is written; and given one that states no version, then it is rejected with 400. |
| AC-26 | Given two workflow changes sent at the same moment from the same version, then exactly one succeeds and the other is refused with 409. |
| AC-27 | Given the IT Staff Ticket Detail screen, then the status control offers only the transitions permitted from the current status, and Resolved is shown disabled with the server's reason while the gate is not met and becomes available once it is. |
| AC-28 | Given a successful status change, then the status badge in the Ticket summary shows the new status and the change is announced. |
| AC-29 | Given a workflow change is refused as a conflict, then the screen shows the reason beside the control and reloads the Ticket. |
| AC-30 | Given a Requester with Tickets in several statuses, then each dashboard count equals the total of My Tickets under the linked filter. |
| AC-31 | Given a Requester with no Tickets, then every count is 0, every list is empty, and the screen shows an empty state with a Create Ticket action. |
| AC-32 | Given a Requester calls the IT Staff dashboard endpoint, or IT Staff call the Requester dashboard endpoint, then the response is 403 and no data is returned. |
| AC-33 | Given IT Staff, then each IT Staff Dashboard count equals the total of the Ticket Queue under the linked filter, and the eight status counts sum to the number of Tickets. |
| AC-34 | Given Actions Taken by several users on both sides of midnight Bangkok time, then My Actions Today counts only the current user's actions dated within the Bangkok day. |
| AC-35 | Given an Administrator, then the IT Staff Dashboard includes active and inactive user counts; given IT Staff, then the response has no user field at all. |
| AC-36 | Given any dashboard response, then no list holds more than 5 rows and no row carries a description, comment, note, attachment or email address. |
| AC-37 | Given a dashboard count, when it is followed, then the list opens with that filter applied and shown in its controls, and the list total equals the count. |
| AC-38 | Given a Ticket resolved within the last 7 days, then it is listed under Recently resolved; given one resolved earlier, or one since reopened, then it is not. |
| AC-39 | Given `status=ACTIVE` on My Tickets or the Ticket Queue, then only Tickets in the five active statuses are returned, and the response reports the list as filtered. |
| AC-40 | Given any role signs in, then they land on their Dashboard, `/` leads there, and Dashboard is marked as the current page. |
| AC-41 | Given the dashboard is loading, or its request fails, then a loading state, or a safe failure state with a retry, is shown and no partial numbers are displayed. |
| AC-42 | Given the Add Action Taken form is submitted twice in quick succession, then one Action Taken is created and the submit control is disabled while the first request is in flight. |
| AC-43 | Given a submission fails with a validation error, a conflict, a network failure or a server error, on the Action Taken form, a comment or note composer, Create Ticket or the user dialog, then the entered values are still in the form. |
| AC-44 | Given each role visits every screen available to them, then the browser console records no error, no request fails unexpectedly, and no link leads to a missing page. |
| AC-45 | Given the System Status page, then only an Administrator can open it and it contains no control that does nothing. |
| AC-46 | Given a database holding Lab 3 data, when the Lab 4 migration is applied, then every earlier row is unchanged, every Ticket has version 1 and no Actions Taken, and `resolvedAt` is filled only for Resolved and Closed Tickets; and when the rollback is applied, the Lab 3 data is again unchanged. |
| AC-47 | Given the seed is run twice, then the row counts are the same after both runs, and the seeded Tickets include ones with zero, one and several Actions Taken. |
| AC-48 | Given widths of 375, 820 and 1280 pixels, when either Dashboard, the Actions Taken area or its dialog renders, then nothing is clipped or overlapping and the page does not scroll horizontally. |
| AC-49 | Given a keyboard-only user, then every metric card, list row and Actions Taken control is reachable with a visible focus indicator, the dialog traps and restores focus, and follow-up and blocked states are stated in text, not by colour alone. |
| AC-50 | Given the complete Lab 1, Lab 2 and Lab 3 test suites, when they are run after this sprint, then all pass, and each test changed because this contract changed is listed in `tests.md`. |
| AC-51 | Given 300 additional Tickets, when either dashboard endpoint is called, then it answers in under one second with a body under 16 KB. |

## 10. Definition of Done

**Product completion**
- Every FR, BR and AC above is implemented and traced to at least one passing automated test in `docs/lab-04/tests.md`.
- No required test is skipped, disabled or commented out, and all pass from the documented commands on the final `main` branch.
- Every write rule in §5.1 and §5.2 is proved by a test that calls the API directly, not by a UI assertion.
- The resolution gate and the stale-change rule hold when the screen is bypassed.
- Each dashboard count is proved equal to the total of its drill-down list.
- The migration and its rollback are proved by `npm run db:migration-check`, and the seed is proved repeatable.
- Every Lab 1, Lab 2 and Lab 3 suite passes, with deliberate contract changes listed.
- All screen states match `ui-spec.md`, and the visual and accessibility checklist in it is complete, at desktop, tablet and mobile widths.
- No console error, broken link, placeholder text or unfinished control remains on any screen.
- The README is current for setup, migration, rollback, seed, tests and the demonstration accounts.

**Course delivery**
- Each Issue is implemented on its own feature branch and merged into `lab4-staging` through a peer-reviewed Pull Request, followed by one release Pull Request from `lab4-staging` to `main`.
- `docs/lab-04/reviewer.md` and `docs/lab-04/ai-use.md` are complete.
- The GitHub Project board shows every Lab 4 Issue in Done.

## 11. Assumptions and Decisions

- **An Action Taken is a record of work done, with exactly the fields the handout lists.** The handout names seven fields three times (sections 3, 4.1 and 8.3) and marks Performed by as automatic. Its submission table also mentions assigning, completing and cancelling an action and rejecting an inactive assignee, which those fields cannot express. This contract follows the field list. The same concerns are met where they already live: assignment and the rejection of an inactive or ineligible user belong to the Ticket Owner (Lab 3 BR-19), completion is the resolution gate, and cancellation is a Ticket status. An inactive user cannot perform an action because they cannot sign in.
- **The Ticket lock is `FOR NO KEY UPDATE`, not `FOR UPDATE`.** Postgres takes `FOR KEY SHARE` on the Ticket to check the foreign key of every comment, note and attachment inserted under it, and `FOR UPDATE` conflicts with that, so a plain `FOR UPDATE` would make those inserts wait on each workflow change. `FOR NO KEY UPDATE` does not conflict with the key check and still conflicts with itself, which is all that is needed to run two workflow writes one after the other. Lab 3's user-edit route made the same choice for the same reason.
- **Action Date/Time is compared to the minute.** A `datetime-local` field holds no seconds, so the time the form offers for "now" is the start of the current minute. Compared to the second, that default would be earlier than a Ticket created thirty seconds ago and the form would reject a value nobody typed. BR-05 therefore drops the seconds from the Ticket's creation time before comparing.
- **Action Date/Time is entered, not stamped.** Work is often written up after it is done, so the form offers the current time and lets it be changed, within BR-05. The moment the row was written is kept separately and shown as "Recorded", so both readings of the handout's "create date/time" are on the screen.
- **Any staff member may edit any Action Taken.** The handout gives IT Staff "create and update on accessible Tickets" with no author restriction, and a correction is often made by a colleague. What makes this safe is that Performed by cannot be changed and every edit shows who made it.
- **The gate looks at the latest Action Taken only.** A follow-up is closed by recording the work that followed up, not by going back and unticking a box. That keeps history honest: the earlier line still says follow-up was needed, and the later line says what was done about it.
- **The gate is checked on the way into Resolved and nowhere else.** Checking it on Closed as well would strand Tickets resolved before this sprint, which have no Actions Taken and were resolved correctly under the rules of their time.
- **Actions Taken are frozen once the Ticket is finished (BR-08).** Otherwise the gate could be undone after the fact, by editing the latest action of a Resolved Ticket to require follow-up. Reopening the Ticket is the way to record more work.
- **Requesters gain no status transition.** The handout repeats that their indication is advisory, and letting a Requester close or reopen would need a second authorization path through the matrix for no stated need.
- **The version is sent in the request body.** An `If-Match` header would do the same job but adds a header to the CORS allowlist and a second place for the client to forget. One required body field is easier to test and to review.
- **Workflow writes lock the Ticket row.** The status, owner and priority routes, and both Action Taken writes, read the Ticket `FOR NO KEY UPDATE` inside one transaction. That makes "resolve" and "a colleague records a follow-up" happen one after the other, so the gate always decides on the data that is actually there. Lab 3's compare-and-set on status is replaced by this plus the version.
- **Recording an Action Taken does not change the Ticket version.** The gate is evaluated on the server at the moment of the write, so a newly recorded follow-up already blocks a resolve without making every other open copy of the Ticket stale.
- **The request key is required, not optional.** A retry-safe create that only works when the client remembers to ask for it is not a guarantee. The disabled submit button (BR-30) covers the double click; the key covers the retry the user cannot see.
- **Day boundaries are Bangkok days, and times are displayed as before.** The service desk is in one place, so "today" has one meaning for everyone. Existing screens show timestamps in the browser's locale and Lab 4 screens do the same, because mixing two display conventions in one application would be worse than either.
- **The eight status counts are the "by status or IT Priority" breakdown.** One breakdown is enough for a concise dashboard, and status is the one the queue is worked by. Urgent has its own card.
- **My Actions Today has no drill-down.** No screen lists Actions Taken across Tickets, and adding one only to give a number a link would be a new feature. The list beneath it shows the same actions and each row opens its Ticket.
- **Comments still do not move a Ticket's `updatedAt`.** That is how Lab 3 behaves and it is left alone. Actions Taken do move it (BR-11), because "recently updated" should notice work.
- **The Check System page is kept for Administrators.** It is the only screen that shows whether the API and database are reachable. It moves to `/system-status`, loses the buttons that did nothing, and leaves the navigation of the two roles who had no use for it.
- **`app.ts` is not reorganised.** New routes go in `server/src/routes/`, and existing handlers change where they are. Moving 1,700 lines in the sprint that is graded on regression would put every earlier behaviour at risk for no visible gain.
- **No new dependencies.** The Bangkok day boundary is a fixed UTC+7 offset, which needs no date library.
