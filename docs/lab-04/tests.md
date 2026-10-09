# Lab 4 Test Plan and Results

## 1. Test Strategy

Tests are planned from the FR, BR and AC statements of `specification.md` before implementation
(Test DD), then written to fail first and implemented until green (TDD), one Issue at a time. This
document is written in Issue #65, before any Lab 4 implementation Pull Request opens. Each later
Pull Request changes its own rows from Planned to Pass. Nothing here is reconstructed afterwards.

Levels: unit, API and integration, UI component, UI style and responsive, authorization, workflow,
migration and regression, performance smoke, and end-to-end.

Three principles carry over from Lab 3 and one is new.

- **A rule that is a boundary is proved at the API.** That a Requester cannot record an Action
  Taken, that the resolution gate holds and that a stale change is refused are each proved by a
  request sent directly to the endpoint. A UI test that finds no button proves the button is
  absent, not that the operation is refused.
- **A count is proved against its list.** Staff counts are system-wide and the API tests share the
  development database with whatever else is in it, so no dashboard test asserts an absolute
  number. Each asserts that the count equals the total of the linked list under the same filter,
  and that creating a fixture moves the count by exactly the expected amount.
- **Time is injected.** The Bangkok day boundary is a pure function of a clock passed in, tested at
  the instants either side of 17:00:00 UTC. No test depends on what time it is run.
- **New: what changes in earlier tests is listed.** §7 names every Lab 1 to Lab 3 test that this
  contract deliberately changes, so that a regression cannot hide inside a "necessary update".

Server tests use Supertest against `createApp()` with a real PostgreSQL database and per-file
fixtures removed afterwards. Client tests use Vitest and Testing Library with a mocked `fetch`; the
setup file makes any unmocked request fail. End-to-end tests use Playwright through the real Login
screen, and `npm run e2e:fresh` runs them on a database built for the run.

## 2. Planned Tests

### Unit

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| UNIT-01 | Unit | BR-05, BR-06, BR-07, AC-07, AC-08, AC-09 | Action Taken validation | Description 1 to 2000 and Result 1 to 1000 after trimming, both ends inclusive; Attachment Notes optional, at most 500, empty becomes null; Follow-up Note required only when follow-up is required and null otherwise; Action Date/Time rejected when missing, malformed, or naming a moment that does not exist (31 February, 31 April, hour 24, which `new Date()` would roll over into another day), before the minute of the Ticket's creation or more than 5 minutes ahead, accepted at both bounds; for a Ticket created at 10:00:30, 10:00:00 is accepted and 09:59:59 refused; every failing field reported together | `server/tests/lab-04/action-validation.unit.test.ts` | Pass |
| UNIT-02 | Unit | BR-12, BR-13, BR-14, AC-18, AC-19, AC-20, AC-22 | Transition matrix and resolution gate helper | Every cell of §5.2 against a table written out by hand; the gate refuses no owner, then no Action Taken, then a latest action requiring follow-up, in that order, with the three documented sentences; Closed needs an owner and not the gate; `blockedReason` is null exactly when the move would be accepted | `server/tests/lab-04/resolution-gate.unit.test.ts` | Pass |
| UNIT-03 | Unit | BR-25, AC-34, AC-38 | Bangkok day boundaries | At 16:59:59.999Z "today" began at 17:00Z the day before; at 17:00:00.000Z it began at that instant; the 7-day window starts six Bangkok days before today; no dependence on the machine's time zone | `server/tests/lab-04/bangkok-day.unit.test.ts` | Pass |
| UNIT-04 | Unit | BR-22, AC-39 | List query parsers | `status=ACTIVE` expands to the five active statuses on both lists; a single status still works; an unknown status is dropped and does not mark the list filtered; My Tickets accepts `sortBy=updatedAt`; the Lab 2 and Lab 3 defaults are unchanged | `server/tests/lab-04/ticket-query.unit.test.ts` | Pass |
| UNIT-05 | Unit | BR-05, BR-06, BR-07, AC-07, AC-09 | Client-side Action Taken form validation | The same limits as UNIT-01, with the message attached to the right field; the prefilled time for a Ticket created earlier in the same minute passes; a hidden Follow-up Note is not validated and not sent | `client/tests/lab-04/actionValidation.test.ts` | Pass |
| UNIT-06 | Unit | FR-02, FR-03, BR-17, BR-20 | Client calls for Actions Taken | The create call sends the request key and the six entered fields and no performer; the edit call sends `expectedVersion`; a refusal reaches the caller with its field messages, its conflict code and, for a stale edit, the current row; a non-JSON error body still reports the status | `client/tests/lab-04/actionsApi.test.ts` | Pass |

### API - Actions Taken

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| API-01 | Authorization | AC-06 | No session | `401` from the list, create and edit endpoints; nothing written | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-02 | API | FR-01, BR-10, AC-15 | List shape and order | An empty array for a Ticket with none; otherwise Action Date/Time descending then id descending, the same on repeated reads, including two actions with the same Action Date/Time; each row has the documented fields and no others | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-03 | API | AC-01 | Create a valid Action Taken | `201`; created under the correct Ticket with the authenticated user as Performed by; version 1; `editedBy` null | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-04 | Authorization | BR-01, BR-03, AC-01 | Identity and Ticket cannot be supplied | A body carrying another user's `performedById`, another `ticketId` and a `createdAt` is saved with the session's user, the path's Ticket and the server's time | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-05 | Authorization | BR-04, AC-04 | Requester cannot write | `403` on create and on edit, for a Ticket they own as well as one they do not; the row count is unchanged | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-06 | Authorization | BR-04, AC-03, AC-05 | Requester reads own Ticket only | Own Ticket: `200` with every field of every Action Taken. Another Requester's Ticket: `404` with a body byte-identical to a Ticket id that does not exist | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-07 | API | BR-07, AC-07, AC-08 | Follow-up rule | Follow-up required with an empty or whitespace note is `400` on `followUpNote` and nothing is stored; follow-up not required with a note sent is saved with a null note | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-08 | API | BR-05, BR-06, AC-09 | Field validation through the route | Blank and over-long Description and Result, over-long Attachment Notes, and each bad Action Date/Time are `400` with a message per field and nothing stored; a missing or malformed `requestKey` is `400` | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-09 | Workflow | BR-02, AC-10 | Different staff on one Ticket | Two staff users who do not own the Ticket, and an Administrator, each record an action; all three are listed under their own names and the Ticket Owner is unchanged | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-10 | API | BR-09, AC-11 | Edit by another staff user | The six fields change; Performed by, Ticket and creation time do not; `editedBy` and `editedAt` are set; version is 2 | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-11 | Workflow | BR-17, AC-12 | Stale edit | An edit naming version 1 after the row reached version 2 is `409 STALE_ACTION` with the current row in `current`; the stored row is unchanged; a missing `expectedVersion` is `400` | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-12 | API | BR-20, AC-13, AC-42 | Retry-safe create | The same body sent twice, and twice at once, yields one row and the same id (`201` then `200`); the same key on another Ticket or from another user is `409 REQUEST_KEY_REUSED` | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-13 | Workflow | BR-08, AC-14 | Frozen once finished | Create and edit are `409 TICKET_NOT_ACTIVE` on a Resolved, a Closed and a Cancelled Ticket, and succeed again once the Ticket is Reopened | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-14 | API | BR-01, BR-09, AC-15 | No delete, no cross-Ticket access | `DELETE` on an Action Taken is `404` and the row remains; editing an action id through another Ticket's path is `404` | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-15 | API | BR-11, AC-16 | Effect on the Ticket | After a create and after an edit the Ticket's `updatedAt` is later and its status, owner, IT Priority and version are the same | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-16 | Authorization | AC-17 | Deactivated while signed in | A staff session whose user has been deactivated gets `401` on create and nothing is written | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-17 | Integration | BR-07 | Database constraint | A direct database write with follow-up required and no note, and one with a note and no follow-up, are both rejected by the check constraint | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |

### API - Ticket workflow

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| API-18 | Workflow | BR-12, AC-18 | The whole matrix through the route | For all 56 ordered pairs of different statuses, with an owner and the gate met: the 18 permitted moves succeed and raise the version by one, the other 38 are `409` with status and version unchanged | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-19 | Workflow | BR-13, AC-19 | Gate: no Action Taken | An owned In Progress Ticket with no action is refused `409 RESOLUTION_GATE` with the documented sentence; the same from Waiting for Requester | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-20 | Workflow | BR-13, AC-20 | Gate: follow-up | Refused while the latest action requires follow-up, even when an earlier one does not; allowed after a later action with no follow-up is recorded; "latest" follows Action Date/Time, not the order of entry | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-21 | Workflow | BR-18, BR-19, AC-21 | Resolving and reopening | A gated move to Resolved succeeds and sets `resolvedAt`; Closed keeps it; Reopened clears it and the Requester's indication | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-22 | Workflow | BR-13, AC-22 | Order of refusal | An unassigned Ticket with no action is refused for the missing owner, not for the missing action; a move outside the matrix is reported before either | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-23 | Regression | BR-14, AC-23 | Legacy resolved Tickets | A Resolved Ticket with no Action Taken can be Closed; once Reopened and moved to In Progress it cannot be Resolved until the gate is met | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-24 | Authorization | BR-15, AC-24 | Requester and the gate | A Requester's status request is `403`; after their "appears resolved" indication the status is unchanged and a staff move to Resolved is still refused by the gate | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-25 | Workflow | BR-16, AC-25 | Stale and missing version | On each of status, owner and IT Priority: an old version is `409 STALE_TICKET` with nothing written, including for a change that would be a no-op; a missing or non-integer version is `400` on `expectedVersion` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-26 | Workflow | BR-16, AC-26 | Simultaneous changes | Two different changes sent together from the same version: exactly one `200` and one `409 STALE_TICKET`, and the version rises by one, repeated 20 times | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-27 | API | FR-08, AC-27 | Served transitions | `transitions` lists exactly the matrix row; `blockedReason` on Resolved is the sentence the status route then refuses with, and is null once the gate is met; `version` and `resolvedAt` are in the Ticket | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-28 | Workflow | BR-16 | What moves the version | A real owner or priority change raises it by one; a no-op does not; deactivating a user raises it on each Ticket that is unassigned as a result; recording an Action Taken and the Requester's indication do not | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-29 | Workflow | BR-13, AC-20 | Resolve against a concurrent follow-up | A move to Resolved and the creation of an action requiring follow-up sent together, repeated 20 times: whichever order they land in, the gate is never bypassed. If the action was written first the resolve is refused; if the resolve was first the action is refused as `TICKET_NOT_ACTIVE` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |

### API - Dashboards

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| API-30 | Authorization | BR-23, AC-02 | Requester sees only their own | With two Requesters holding different Tickets, each response counts and lists only that Requester's; adding a query parameter naming the other changes nothing | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| API-31 | API | BR-24, AC-30 | Counts equal list totals | Each of the four `value`s equals `pagination.totalItems` from `GET /api/tickets?<query>`, and moving one Ticket between statuses moves exactly the two affected counts by one | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| API-32 | API | BR-27, AC-31 | Requester with nothing | Four metrics of 0 and three empty arrays, `200` | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| API-33 | Authorization | AC-06, AC-32 | Who may call it | `401` with no session; `403` for IT Staff and for an Administrator, with no data in the body | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| API-34 | API | BR-26, BR-28, AC-36, AC-38 | Lists | No list exceeds 5; Needs attention is longest-waiting first, the other two newest first; Recently resolved includes a Ticket resolved within 7 Bangkok days and excludes one resolved earlier and one since reopened; no row has a description or an email address | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| API-35 | API | FR-12, AC-39 | My Tickets filters | `status=ACTIVE` returns only the five active statuses and `filtered: true`; a single status filters to it; `sortBy=updatedAt` orders by it; another Requester's Tickets never appear under any filter | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| API-36 | API | BR-24, AC-33 | Staff counts equal queue totals | `unassigned`, `myTickets`, `urgent` and each of the eight `byStatus` values equal the queue's total under their `query`; the eight sum to the unfiltered total; all eight statuses are present when some are zero | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| API-37 | API | BR-25, AC-34 | My Actions Today | With the clock fixed, counts the caller's actions dated inside the Bangkok day and excludes one a second before it, one in the next day, and a colleague's | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| API-38 | Authorization | BR-29, AC-35 | User counts | An Administrator's response has `users` equal to the counts of active and inactive accounts; an IT Staff response has no `users` key | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| API-39 | Authorization | AC-06, AC-32 | Who may call it | `401` with no session; `403` for a Requester with no data | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| API-40 | API | BR-26, BR-28, AC-36 | Lists and shape | Each list at most 5 and in the documented order; `myRecentActions` holds only the caller's actions with a preview of at most 120 characters; no description, comment, note, attachment or email address anywhere in the body | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| API-41 | API | FR-12, AC-39 | Queue `status=ACTIVE` | Only the five active statuses, `filtered: true`, and it combines with `owner` and `itPriority` | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| PERF-01 | Performance smoke | AC-51 | Dashboards under load | With 300 extra Tickets and 300 Actions Taken, each dashboard endpoint answers in under 1 second with a body under 16 KB and lists still capped at 5 | `server/tests/lab-04/dashboard-performance.api.test.ts` | Pass |

### Migration and regression

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| MIG-01 | Migration | BR-32, FR-18, AC-46 | Migration and rollback | On a throwaway database holding Lab 3 data: after the migration every earlier row has the same values, every Ticket has version 1 and no Actions Taken, and `resolvedAt` is set only for Resolved and Closed; after the rollback the Lab 3 rows are again identical and the Lab 4 objects are gone; the migration applies again cleanly | `server/src/scripts/migration-check.ts` (`npm run db:migration-check`) | Pass |
| MIG-02 | Migration | FR-19, AC-47 | Seed | Running the seed twice leaves every table's row count unchanged; the seeded Tickets have 0, 1, 2 and 3 Actions Taken as §7.3 lists; one seeded Requester has no Tickets and one seeded staff user has no actions; a seeded Ticket too young to date work from is moved back once and then left alone | `server/tests/lab-04/seed.api.test.ts` | Pass |
| REG-01 | Regression | FR-20, AC-50 | Lab 1 to Lab 3 server suites | Every test in `server/tests/lab-01`, `lab-02` and `lab-03` passes | `server/tests/lab-01/*`, `lab-02/*`, `lab-03/*` | Planned |
| REG-02 | Regression | FR-20, AC-50 | Lab 1 to Lab 3 client suites | Every test in `client/tests/lab-01`, `lab-02` and `lab-03` passes | `client/tests/lab-01/*`, `lab-02/*`, `lab-03/*` | Planned |
| REG-03 | Regression | FR-20, AC-50 | Lab 2 and Lab 3 end-to-end suites | Every spec in `e2e/lab-02` and `e2e/lab-03` passes on a fresh database | `e2e/lab-02/*`, `e2e/lab-03/*` | Planned |
| REG-04 | Regression | FR-16, FR-17, AC-44 | Whole-application sweep | Each of the three roles visits every screen available to them, on a fresh database: no console error, no failed request, no link to a missing page, and no visible placeholder text | `e2e/lab-04/regression.spec.ts` | Planned |
| REG-05 | Regression | FR-19 | Cleanup contract | The real teardown script, run against rows shaped as the end-to-end suite shapes them: a marked Ticket goes together with its Actions Taken; a user the suite created goes together with the work they recorded; an unmarked Ticket stays, and an action a remaining user performed stays and loses the departing user's edit mark, editor and time together | `server/tests/lab-04/e2e-cleanup.api.test.ts` | Pass |

### UI component

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| UI-01 | UI | FR-01, AC-03 | Actions Taken list | Rows in the order served, with all list columns, the worded follow-up badge, the count line and "Edited by" on an edited row | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-02 | UI | FR-17 | Section states | Loading, the empty line, and a failure with a retry that reloads only this section | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-03 | UI | FR-04, AC-03 | Requester view | Every Action Taken and the view dialog with all fields; no Add and no Edit control; the Requester subtitle | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-04 | UI | FR-02, AC-01 | Create | Action Date/Time prefilled; Follow-up Note appears only when the box is checked; the request carries a request key and the six fields and no performer; the list reloads and the save is announced | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-05 | UI | AC-07, AC-09 | Validation placement | Each message sits under its own field and is referenced by `aria-describedby`; the first invalid field takes focus; a server `fields` map is shown the same way | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-06 | UI | BR-30, AC-42 | Repeated click | Save is disabled and busy while the request is in flight, and a second click sends nothing | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-07 | UI | BR-20, BR-31, AC-13, AC-43 | Failure keeps the form | After a network failure and after a `500` the dialog is open with every value intact, and the retry carries the same request key | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-08 | UI | FR-03, AC-11 | View and edit | View shows read-only text; Edit fills the form, shows Performed by as read-only text, and sends `expectedVersion` | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-09 | UI | BR-17, AC-12 | Stale edit | The alert names who changed it and the typed text remains; "Save my version" resends with the current version; "Discard my changes" loads the current values | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-10 | UI | BR-08, AC-14 | Finished Ticket | On Resolved, Closed and Cancelled there is no Add or Edit and the "Reopen it to record more work" line is shown | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-11 | UI | FR-08, AC-27 | Permitted and blocked moves | `Move to` holds exactly the served transitions; a blocked one is disabled and its server reason is visible as text | `client/tests/lab-04/TicketWorkflow.test.tsx` | Pass |
| UI-12 | UI | AC-27 | Gate clears without reload | After an Action Taken is saved the Ticket is fetched again and Resolved becomes selectable | `client/tests/lab-04/TicketWorkflow.test.tsx` | Pass |
| UI-13 | UI | BR-16, AC-28 | Successful change | Status, owner and priority requests carry the Ticket's version; afterwards the summary badge shows the new status and the change is announced | `client/tests/lab-04/TicketWorkflow.test.tsx` | Pass |
| UI-14 | UI | AC-29 | Conflict | `STALE_TICKET` and `RESOLUTION_GATE` show the server's message beside the control and reload the Ticket; the control shows the reloaded value | `client/tests/lab-04/TicketWorkflow.test.tsx` | Pass |
| UI-15 | UI | BR-15, AC-24 | Requester has no status control | The Requester's Ticket Detail shows the status badge and the indication button and no control that changes status | `client/tests/lab-04/TicketWorkflow.test.tsx` | Pass |
| UI-16 | UI | FR-10, AC-33 | Staff metric cards | Each card shows its label and value and links to the queue with the served query; My Actions Today is not a link | `client/tests/lab-04/StaffDashboard.test.tsx` | Pass |
| UI-17 | UI | FR-10 | Tickets by Status | Eight rows, each a link to the queue for that status, zero shown as `0` | `client/tests/lab-04/StaffDashboard.test.tsx` | Pass |
| UI-18 | UI | FR-10, BR-27 | Staff lists | Rows link to the Ticket, an action row to its Actions Taken area; each empty list shows its own line | `client/tests/lab-04/StaffDashboard.test.tsx` | Pass |
| UI-19 | UI | BR-29, AC-35 | User accounts card | Shown with both counts and a link for an Administrator; absent for IT Staff | `client/tests/lab-04/StaffDashboard.test.tsx` | Pass |
| UI-20 | UI | AC-32, AC-41 | Staff dashboard states | Loading; failure with a retry and no numbers; Forbidden for a Requester with a link to their own Dashboard | `client/tests/lab-04/StaffDashboard.test.tsx` | Pass |
| UI-21 | UI | FR-09, AC-30 | Requester metric cards | Four cards with values and links to My Tickets with the served query | `client/tests/lab-04/RequesterDashboard.test.tsx` | Pass |
| UI-22 | UI | FR-09 | Requester lists | Needs your attention, Recently updated and Recently resolved render their rows as links, with their empty lines | `client/tests/lab-04/RequesterDashboard.test.tsx` | Pass |
| UI-23 | UI | BR-27, AC-31 | Empty account | Four zeros, one empty state with Create Ticket, and no lists | `client/tests/lab-04/RequesterDashboard.test.tsx` | Pass |
| UI-24 | UI | AC-32, AC-41 | Requester dashboard states | Loading; failure with a retry; Forbidden for staff | `client/tests/lab-04/RequesterDashboard.test.tsx` | Pass |
| UI-25 | UI | FR-13, AC-40 | Navigation and landing | Dashboard is first for each role and the only item marked current on its route; `/` leads to the role's Dashboard; login lands there | `client/tests/lab-04/DashboardNav.test.tsx` | Pass |
| UI-26 | UI | FR-12, AC-37 | My Tickets view in the URL | A `status` in the URL is applied and shown in the Status select; changing a filter, the sort or the page rewrites the URL; Clear Filters empties it; Active and Last Updated are offered | `client/tests/lab-04/MyTicketsFilters.test.tsx` | Pass |
| UI-27 | UI | FR-12, AC-37 | Queue Active filter | The Status select offers Active and a URL carrying `status=ACTIVE` shows it selected | `client/tests/lab-04/MyTicketsFilters.test.tsx` | Pass |
| UI-28 | UI | FR-16, AC-45 | System Status | Renders health and Categories for an Administrator, has no "Submit Request" control, and is Forbidden for the other two roles | `client/tests/lab-04/SystemStatus.test.tsx` | Pass |
| UI-29 | UI | BR-31, AC-43 | Earlier forms keep their data | After a failed submission the comment composer, the note composer, Create Ticket and the user dialog still hold what was typed | `client/tests/lab-04/FormPreservation.test.tsx` | Planned |

### UI style, responsive and end-to-end

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| RESP-01 | Responsive | AC-48 | No overflow | Both dashboards, the Actions Taken area on both Ticket Detail screens, the dialog in each mode, My Tickets with a status filter and System Status at 375, 820 and 1280px, in both themes, with awkward fixtures: nothing extends past the viewport | `e2e/lab-04/visual-regression.spec.ts` | Planned |
| RESP-02 | Style | ui-spec §10 | Design consistency | Computed surface, border, radius, heading scale and link colour of a metric card, a dashboard list and the Actions Taken table equal those of Lab 2 and Lab 3 cards and tables | `e2e/lab-04/visual-regression.spec.ts` | Planned |
| RESP-03 | Style | ui-spec §6.3 | Editable and read-only | In the dialog, Performed by and Recorded are not inputs and differ in computed background from the fields; view mode contains no input | `e2e/lab-04/visual-regression.spec.ts` | Planned |
| RESP-04 | Accessibility | AC-49 | Keyboard and focus | Every control reached by Tab on both dashboards and in the Actions Taken area shows a focus ring; the dialog traps focus and returns it to its trigger | `e2e/lab-04/visual-regression.spec.ts` | Planned |
| RESP-05 | Accessibility | AC-49 | Non-colour cues | The follow-up badge and the blocked-move reason carry text; status, IT Priority and follow-up badges differ by computed colour and each label has at least 4.5:1 contrast in both themes | `e2e/lab-04/visual-regression.spec.ts` | Planned |
| RESP-06 | Responsive | AC-48 | Table and cards | The Actions Taken table is shown at 768px and above and the cards below it, never both | `e2e/lab-04/visual-regression.spec.ts` | Planned |
| E2E-01 | E2E | AC-01, AC-10, AC-11, AC-42 | Actions Taken flow | IT Staff sign in, open a Ticket a colleague owns, record an Action Taken with follow-up, and see it under their own name; a second staff user records another and edits the first; both names and the edit mark are shown; a double click on Save creates one row | `e2e/lab-04/actions-taken-flow.spec.ts` | Pass |
| E2E-02 | E2E | AC-03, AC-04 | Requester sees the work | The owning Requester opens the same Ticket, sees every Action Taken with all fields and no way to add or edit, sees no Internal Note, and is refused by the API when creating one directly | `e2e/lab-04/actions-taken-flow.spec.ts` | Pass |
| E2E-03 | E2E | AC-19, AC-20, AC-21, AC-27, AC-28 | Resolution | On an owned Ticket with no Action Taken, Resolved is disabled with its reason; after an action requiring follow-up the reason changes; after a later action without follow-up Resolved is chosen, the summary badge reads Resolved and Add Action Taken is gone | `e2e/lab-04/ticket-resolution.spec.ts` | Pass |
| E2E-04 | E2E | AC-25, AC-29 | Stale change | Two staff users hold the same Ticket open; one changes IT Priority; the other's status change is refused with the conflict message and their screen shows the reloaded Ticket | `e2e/lab-04/ticket-resolution.spec.ts` | Pass |
| E2E-05 | E2E | AC-33, AC-37, AC-40 | Staff dashboard | IT Staff land on the Dashboard after login; each card's number equals the total the queue shows after following it, with the filter visible in the queue's controls; a status row and a recent-action row open the right place | `e2e/lab-04/dashboards.spec.ts` | Pass |
| E2E-06 | E2E | AC-02, AC-30, AC-31, AC-37 | Requester dashboard | A Requester lands on their Dashboard; each card's number equals the My Tickets total after following it; another Requester's Ticket never appears; the Requester with no Tickets sees zeros and the empty state | `e2e/lab-04/dashboards.spec.ts` | Pass |
| E2E-07 | E2E | AC-32, AC-35, AC-45 | Administrator and forbidden routes | The Administrator sees the user-accounts card and can open System Status; IT Staff see neither; a Requester typing the staff dashboard address gets the Forbidden state | `e2e/lab-04/dashboards.spec.ts` | Pass |

## 3. Acceptance-Criterion Traceability

| AC | Covered by |
| --- | --- |
| AC-01 | API-03, API-04, UI-04, E2E-01 |
| AC-02 | API-30, E2E-06 |
| AC-03 | API-06, UI-01, UI-03, E2E-02 |
| AC-04 | API-05, E2E-02 |
| AC-05 | API-06 |
| AC-06 | API-01, API-33, API-39 |
| AC-07 | UNIT-01, UNIT-05, API-07, UI-05 |
| AC-08 | UNIT-01, API-07 |
| AC-09 | UNIT-01, UNIT-05, API-08, UI-05 |
| AC-10 | API-09, E2E-01 |
| AC-11 | API-10, UI-08, E2E-01 |
| AC-12 | API-11, UI-09 |
| AC-13 | API-12, UI-07 |
| AC-14 | API-13, UI-10 |
| AC-15 | API-02, API-14 |
| AC-16 | API-15 |
| AC-17 | API-16 |
| AC-18 | UNIT-02, API-18 |
| AC-19 | UNIT-02, API-19, E2E-03 |
| AC-20 | UNIT-02, API-20, API-29, E2E-03 |
| AC-21 | API-21, E2E-03 |
| AC-22 | UNIT-02, API-22 |
| AC-23 | API-23 |
| AC-24 | API-24, UI-15 |
| AC-25 | API-25, E2E-04 |
| AC-26 | API-26 |
| AC-27 | API-27, UI-11, UI-12, E2E-03 |
| AC-28 | UI-13, E2E-03 |
| AC-29 | UI-14, E2E-04 |
| AC-30 | API-31, UI-21, E2E-06 |
| AC-31 | API-32, UI-23, E2E-06 |
| AC-32 | API-33, API-39, UI-20, UI-24, E2E-07 |
| AC-33 | API-36, UI-16, E2E-05 |
| AC-34 | UNIT-03, API-37 |
| AC-35 | API-38, UI-19, E2E-07 |
| AC-36 | API-34, API-40 |
| AC-37 | UI-26, UI-27, E2E-05, E2E-06 |
| AC-38 | UNIT-03, API-34 |
| AC-39 | UNIT-04, API-35, API-41 |
| AC-40 | UI-25, E2E-05 |
| AC-41 | UI-20, UI-24 |
| AC-42 | API-12, UI-06, E2E-01 |
| AC-43 | UI-07, UI-29 |
| AC-44 | REG-04 |
| AC-45 | UI-28, E2E-07 |
| AC-46 | MIG-01 |
| AC-47 | MIG-02 |
| AC-48 | RESP-01, RESP-06 |
| AC-49 | RESP-04, RESP-05 |
| AC-50 | REG-01, REG-02, REG-03 |
| AC-51 | PERF-01 |

Every Acceptance Criterion has at least one test, and every test names a file that will exist.
A row changes from Planned to Pass in the Pull Request that implements it, never earlier.

## 4. Responsive and Visual Checklist

The checklist is `ui-spec.md` §10, where each box is backed by an assertion in
`e2e/lab-04/visual-regression.spec.ts`. It is completed in Issue #72 and its result recorded here.

## 5. Test Commands

```bash
cd server && npm run db:migration-check   # MIG-01: Lab 3 data survives the Lab 4 migration and its rollback
cd server && npm test                     # unit, API, authorization, workflow, performance smoke; labs 1 to 4
cd client && npm test                     # UI component tests; labs 1 to 4
npm run e2e:fresh                         # responsive, style, regression and end-to-end specs on a fresh database
npm run typecheck                         # root: e2e/ and playwright.config.ts
cd server && npm run typecheck
cd client && npm run typecheck && npm run lint && npm run build
```

Evidence that a dashboard number matches the database (handout Part 5) is produced by
`e2e/lab-04/submission-evidence.spec.ts`, which captures the dashboard beside the result of the
equivalent `COUNT` query on the same fresh database. It records evidence and is not counted as a
test.

## 6. Final Results

Filled in as each Issue's Pull Request lands in `lab4-staging`, then once more from `main` after
the release.

### Per Issue

**#66, schema, migration, rollback and seed.** MIG-01, MIG-02 and REG-05 are Pass.

| Suite | Result |
| :-- | :-- |
| `npm run db:migration-check` | Passed, 47 checks: 11 for Lab 2 to Lab 3 as before, then 36 for Lab 4 across the migration, the constraint, the rollback and applying it again |
| Server, on the database `npm run e2e:fresh` builds | 23 files, 364 tests, all passed |
| Server, on the development database | 363 of 364. The one failure is `seed-credentials.api.test.ts` for Daniel Okafor, whose password in that database had been changed by hand; the seed never rewrites a password. Not a product failure |
| Client | 17 files, 256 tests, all passed |
| `npm run e2e:fresh` | 91 passed |
| Type checks (`server/`, `client/`, root), client lint and build | Clean |

**#67, Actions Taken API.** UNIT-01, UNIT-06 and API-01 to API-17 are Pass. UNIT-06 is new: the
client calls were added here so that the next Issue is screens only, and they are tested where they
were written.

| Suite | Result |
| :-- | :-- |
| Server, on the database `npm run e2e:fresh` builds | 25 files, 472 tests, all passed |
| Server, on the development database | 471 of 472, the same Daniel Okafor case as above |
| Client | 18 files, 262 tests, all passed |
| `npm run e2e:fresh` | 91 passed |
| Type checks (`server/`, `client/`, root), client lint and build | Clean |

Six deliberate faults were put into the routes one at a time, to see that the tests notice:
taking Performed by from the body, finding an action through the wrong Ticket, not advancing the
Ticket's `updatedAt`, breaking the tie in the list order the other way, answering a replay to a
different user, and dropping the row lock. Each made exactly one test fail, and the file passed
again once it was put back.

**#68, Actions Taken on Ticket Detail.** UNIT-05, UI-01 to UI-10, E2E-01 and E2E-02 are Pass.

| Suite | Result |
| :-- | :-- |
| Client | 20 files, 318 tests, all passed |
| `npm run e2e:fresh` | 93 passed |
| Server, on the database `npm run e2e:fresh` builds | 25 files, 472 tests, all passed |
| Type checks (`server/`, `client/`, root), client lint and build | Clean |

One Lab 2 test changed on purpose and is listed in §7. Four Lab 3 tests failed at first because the
page had gained a second announcement region; the fix was in the screen, not in those tests: the
Actions Taken area announces through the region the page already has.

**#69, Ticket workflow, resolution gate and stale updates.** UNIT-02, API-18 to API-29, UI-11 to
UI-15, E2E-03 and E2E-04 are Pass.

| Suite | Result |
| :-- | :-- |
| Server, on the database `npm run e2e:fresh` builds | 27 files, 590 tests, all passed |
| Server, on the development database | 589 of 590, the same Daniel Okafor case as above |
| Client | 21 files, 333 tests, all passed |
| `npm run e2e:fresh` | 95 passed |
| `npm run db:migration-check` | Passed |
| Type checks (`server/`, `client/`, root), client lint and build | Clean |

Six deliberate faults were put into the workflow code one at a time: no row lock, the gate reading
the oldest action in place of the latest, no version rise when deactivation unassigns a Ticket,
`resolvedAt` kept on reopening, a no-op priority change still writing, and the gate also asked on
closing. Each made between one and six tests fail.

This Issue also found and fixed the cause of the one-off server failures recorded in §8.

Review found a deadlock this Issue introduced: an owner change naming the user who already owns the
Ticket, racing that user's deactivation, ended one of the two requests in a `500`. The owner route
had started locking the Ticket before the User while deactivation locked the User before the
Tickets. Deactivation now locks the Tickets first. The race is a test under API-28, 40 runs, and
it failed on its first run before the fix.

**#70, Dashboard API and drill-down filters.** UNIT-03, UNIT-04, API-30 to API-41 and PERF-01 are
Pass.

| Suite | Result |
| :-- | :-- |
| Server, on the database `npm run e2e:fresh` builds | 32 files, 671 tests, all passed |
| Server, on the development database | 670 of 671, the same Daniel Okafor case as above |
| Client | 21 files, 333 tests, all passed (no client change in this Issue) |
| `npm run e2e:fresh` | 95 passed |
| `npm run db:migration-check` | Passed |
| Type checks (`server/`, `client/`, root) | Clean |

Both list routes now build their `where` in `lib/ticket-query.ts`, and each dashboard count is a
`count()` over what that builder returns for the query string the response carries. The Lab 2 and
Lab 3 list tests passed unchanged over the move.

Each dashboard is read inside one `REPEATABLE READ` transaction, so its numbers describe one
moment: without it, a Ticket changing status between two of the reads could be counted under both
statuses or neither.

Nine deliberate faults were put in one at a time: the status check dropped from Recently resolved,
each end of the Bangkok day moved by a millisecond, user counts served to IT Staff, Needs attention
ordered newest first, `status=ACTIVE` dropped from the Urgent card, My recent Actions Taken not
limited to the caller, Reopened left out of the active statuses, and the Requester condition
removed from the My Tickets builder. Each made at least one test fail.

Two things differ from the plan in §2. API-36 cannot make a status empty in a shared database, so
"all eight present when some are zero" is asserted on the function that fills the rows in, in the
same file. PERF-01 takes the median of five calls after a warm-up, not one call, so a single slow
or lucky request decides nothing.

**#71, Requester and IT Staff dashboards, navigation and landing.** UI-16 to UI-28 and E2E-05 to
E2E-07 are Pass.

| Suite | Result |
| :-- | :-- |
| Server, on the database `npm run e2e:fresh` builds | 32 files, 671 tests, all passed (no server change in this Issue) |
| Client | 26 files, 413 tests, all passed |
| `npm run e2e:fresh` | 100 passed |
| Type checks (`server/`, `client/`, root), client lint and build | Clean |

The earlier tests changed here are the ones §7 lists for this Issue, and each change is the landing
route, the navigation labels, or the Check System screen becoming System Status. The Lab 2 My
Tickets tests passed unchanged over the move of its view into the URL.

Three things were found by looking at the captures and were not in the plan:

- Dashboard and System Status took the Administrator's navigation from two items to four and the
  Requester's from two to three. At 820px the labels wrapped onto two lines and the role badge was
  cut to one letter. A role with more than two items now gets the menu at tablet width as well as on
  a phone; IT Staff have two, which fit. `e2e/lab-04/dashboards.spec.ts` checks every role at every
  width: header 64px high, each label on one line, the role badge whole.
- My Tickets showed its total only inside the pagination, which is absent on a single page. AC-37
  compares a card with the total of the list it opens, so the heading now carries "7 Tickets", as
  the Ticket Queue's always has.
- A response that is `200` but not a dashboard made the screen fail while drawing. The client call
  now rejects it, and the screen shows its failure state with a retry.

Seven deliberate faults were put into the client one at a time: the Administrator's landing
route, the status filter not sent by My Tickets, the fragment dropped from an action row's link,
Dashboard marked current across all of `/staff`, a "Submit Request" button put back, the user
card decided by role, and the empty account decided by the four counts. The first five failed at
least one test each. The sixth changes nothing a user could see, since only an Administrator is
sent the counts. The seventh passed, which showed a missing case: a Requester whose only Ticket
is Cancelled has four zeros and is not an empty account. That case is now a test under UI-23.

One thing was seen and left for #72, because it is older than this Issue: on a phone the My Tickets
filter fields are a few pixels wider than the card they sit in. It is in the Lab 3 capture too.

MIG-02 does not run on the development database. It builds one of its own from the migrations,
seeds it twice and compares the rows, because "the counts did not change" is only a statement
about the seed when nothing else is in the database.

REG-05 was planned as an addition to `e2e/lab-03/cleanup-contract.spec.ts`. That spec can only
read the script's source, and the thing worth proving is that the script still runs once a Ticket
has Actions Taken under it. It is a server test instead, and it was seen to fail against the
teardown as it stood before this Issue.

## 7. Earlier Tests This Contract Changes

These are changed on purpose, in the Issue named, because the contract they tested has changed.
Any other change to a Lab 1 to Lab 3 test is a regression and is treated as one.

| Earlier test | Why it changes | Issue |
| :-- | :-- | :-: |
| `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Its `patch` helper reads the Ticket's version and sends it as `expectedVersion`, and the fixture Ticket always carries one Action Taken so that the gate is never what refuses a move there. Four cases change in substance: the exact-shape check gains `version`, `resolvedAt` and `blockedReason`; the two that forced a write into the gap between the route's read and its write are rewritten to send a stale version, because the route now holds the row locked and that gap no longer exists; and "two simultaneous claims" now expects one winner and one `STALE_TICKET` where Lab 3 let both succeed | #69 |
| `server/tests/lab-03/users-admin.api.test.ts` | One owner request gains `expectedVersion` | #69 |
| `client/tests/lab-03/StaffTicketDetail.test.tsx` | Fixtures gain `version`, `resolvedAt` and `blockedReason`, the mock server fills `blockedReason` for a missing owner and raises the version on each change, and six request-body assertions gain `expectedVersion` | #69 |
| `e2e/lab-03/staff-ticket-flow.spec.ts`, `e2e/lab-03/submission-evidence.spec.ts`, `e2e/lab-03/visual-regression.spec.ts` | Tickets set up through the API use a helper that sends the current version, and an Action Taken is recorded before a Ticket is resolved. Two expectations change: with no work recorded the option reads "Resolved (not available yet)", and a change made from a screen a colleague has since overtaken is answered with the stale-version message where Lab 3 answered with the matrix | #69 |
| `server/tests/lab-02/my-tickets.api.test.ts`, `server/tests/lab-03/staff-queue.unit.test.ts` | Only if an assertion lists the accepted sort keys or statuses exhaustively; the defaults themselves do not change | #70 |
| `client/tests/lab-02/RequesterTicketDetail.test.tsx` | It asserted that the Requester's Ticket Detail shows no Actions Taken, which was true while they were out of scope. FR-04 puts them there read-only, so the test now asserts that the area is present and offers no way to add or edit. Its mock also answers the new endpoint | #68 |
| `client/tests/lab-01/UI-01` to `UI-03` | The page they render moves from `/` to `/system-status`, is opened as an Administrator, and no longer has "Submit Request" | #71 |
| `client/tests/lab-02/AppShellNav.test.tsx`, `client/tests/lab-03/AppShellAuth.test.tsx`, `client/tests/lab-03/Login.test.tsx` | Dashboard joins each role's navigation and becomes the landing route | #71 |
| `client/tests/lab-02/MyTickets.test.tsx` | Expected to change when its filters, sort and page moved into the URL. It did not have to: every case passed as written, and the new behaviour is UI-26 | #71 |
| `e2e/lab-03/helpers.ts`, `e2e/lab-03/authentication.spec.ts`, `e2e/lab-03/user-administration.spec.ts`, `e2e/lab-03/submission-evidence.spec.ts`, `e2e/lab-03/visual-regression.spec.ts` | Where a role lands after signing in, and the navigation labels each role is shown. `ACCOUNTS` gains `landing` beside `home`, which still names the role's working screen for the Lab 3 captures. `e2e/lab-02/helpers.ts` did not need to change: it signs in from a guarded address and is returned to it | #71 |
| `client/tests/lab-03/ChangePassword.test.tsx` | One assertion about where a Requester continues to after changing their password | #71 |
| `server/src/scripts/e2e-cleanup.ts` | The teardown removes Actions Taken before the Tickets and users they refer to. No earlier test changed; REG-05 is new | #66 |

## 8. Known Limitations or Deferred Tests

- **One-off server test failures, found and fixed in Issue #69.** From Issue #66 on, roughly one
  full run of the server suite in four had a single failure in a test unrelated to the work in
  hand: a `426` from `POST /api/tickets`, a `404` or `401` where the route answers `200`, or a
  request that hung until the 5 second timeout. It was first seen only on the development database
  and was recorded here as unexplained; in Issue #69 it appeared on the fresh database too, which
  ruled the database out.

  Supertest starts the app with `listen(0)`, which binds the IPv6 wildcard, and then sends its
  request to `127.0.0.1`, which is IPv4. A `426` is something this application never sends, so
  some requests were being answered by another program on the machine. `server/tests/helpers/setup.ts`
  now makes Supertest connect to `[::1]`, the family the server is bound on. Before it, 6 of about
  25 full runs on this branch had a failure; after it, 31 of 31 were clean.

  What is established is the fix and the measurement. How another program came to hold the same
  port number on IPv4 is not: two direct experiments (6,000 ports held on one family, 400
  allocations on the other, both ways round) produced no collision.
