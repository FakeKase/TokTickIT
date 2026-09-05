# Lab 2 Test Plan and Results

## 1. Test Strategy

Tests are planned from `specification.md`'s FR/BR/AC before implementation (Test DD), then
written to fail first and implemented against until green (TDD), per Issue. Levels: unit, API,
UI component, responsive/visual, and E2E — matching the handout's minimum coverage. Every AC has
at least one test; most attachment/ownership rules are proven at the API level since that's where
the security boundary actually lives (BR-07/BR-08), with UI tests proving the corresponding
screen states.

Server tests use Supertest against `createApp()` (Lab 1 pattern). Client tests use Vitest +
Testing Library with `vi.spyOn(globalThis, 'fetch')` (Lab 1 pattern) or MSW for multi-call flows.
E2E/visual tests use Playwright against a running dev stack.

## 2. Planned Tests

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Status |
| --- | --- | --- | --- | --- | --- | --- |
| UNIT-01 | Unit | BR-01, AC-01 | Ticket Number format/uniqueness helper | Returns `TKT-{year}-{6-digit id}`, unique per id | `server/tests/lab-02/ticket-number.unit.test.ts` | Pass |
| API-01 | API | AC-01, BR-02 | Create valid ticket | `201`; ticket saved; number returned; `currentStatus` is `NEW` even if a client-supplied `currentStatus` is present in the request body | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| API-02 | API | AC-04, BR-15 | Create ticket missing Category/RelatedSystem/Priority | `400` with per-field messages; nothing saved | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| API-03 | API | AC-05, BR-13 | Summary below 5 chars | `400`; nothing saved | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| API-04 | API | BR-04, BR-15 | `requesterId` inactive or unknown | `404`; nothing saved | `server/tests/lab-02/create-ticket.api.test.ts` | Pending |
| API-05 | API | AC-11, BR-06/07 | List tickets scoped to requester | Only the asserted requester's tickets returned | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-06 | API | AC-13, BR-09 | Search with no match | `200`; empty `data`, `totalItems: 0` | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-07 | API | AC-15, BR-12 | Pagination page 2 | Distinct, non-overlapping rows; correct `pagination` block | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-08 | API | AC-16, BR-11 | Sort by priority desc | High → Medium → Low, tie-broken by createdAt desc | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-09 | API | AC-03, BR-08 | Fetch a ticket owned by a different requester | `404`, no data leaked | `server/tests/lab-02/ticket-detail.api.test.ts` | Pending |
| API-10 | API | AC-18, BR-19 | Upload valid attachment | `201`; attachment appears in ticket detail | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-11 | API | AC-08, BR-20 | Upload file >5MB | `413`; not stored | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-12 | API | AC-09, BR-19 | Upload unsupported type | `415`; not stored | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-13 | API | AC-10, BR-21 | Upload 6th active attachment | `409`; 5-attachment cap enforced | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-14 | API | AC-19 | Download active attachment | `200`; correct bytes + `Content-Disposition` | `server/tests/lab-02/attachments.api.test.ts` | Pending |
| API-15 | API | AC-21, BR-26 | Download removed attachment | `404` | `server/tests/lab-02/attachments.api.test.ts` | Pending |
| API-16 | API | AC-22, BR-25 | Soft-remove without reason | `400`; attachment still active | `server/tests/lab-02/attachments.api.test.ts` | Pending |
| API-17 | API | AC-20, BR-23 | Soft-remove with reason | `200`; `isRemoved: true`, metadata retained | `server/tests/lab-02/attachments.api.test.ts` | Pending |
| API-18 | API | BR-04 | Inactive requester excluded | `GET /api/requesters` omits inactive seed row | `server/tests/lab-02/requesters.api.test.ts` | Pass |
| API-29 | API | BR-03, BR-29, api-spec §1 | `GET /api/requesters` contract | Returns only `id`/`name`/`email`, ordered by name asc; a database failure returns a safe `500` message with no internal detail | `server/tests/lab-02/requesters.api.test.ts` | Pass |
| API-19 | API | FR-14 | Reference data endpoints | Categories + related systems return seeded rows | `server/tests/lab-02/reference-data.api.test.ts` | Pass |
| API-20 | API | AC-27, BR-14 | Description below 10 chars and above 2000 chars | `400` in both cases; nothing saved | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| API-21 | API | AC-28, BR-13 | Summary above 120 chars | `400`; nothing saved | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| API-22 | API | AC-29, BR-15 | Unrecognized `categoryId`/`relatedSystemId` (valid shape, no matching row) | `404`; nothing saved | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| API-23 | API | AC-30, BR-10/FR-06 | Filter My Tickets by Category and Requested Priority combined with `search` | Only tickets matching all three criteria returned | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-24 | API | AC-31, BR-11 | List tickets with no `sortBy`/`sortDir` supplied | Default order: Created Date desc, id desc tie-break | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-25 | API | AC-32, BR-12 | Out-of-range `page` (e.g. `0`, `-1`) and oversized `pageSize` (e.g. `500`) | Values clamped to nearest valid bound, not rejected | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-26 | API | AC-33, BR-09 | Search term matching an existing ticket's Number or Summary | Only the matching, owned ticket(s) returned | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-27 | API | AC-34, BR-08/BR-25 | Requester B requests Requester A's Attachment metadata, download, and removal | `404` on all three, identical to a nonexistent attachment | `server/tests/lab-02/attachments.api.test.ts` | Pending |
| API-28 | API | AC-35, BR-22 | Ticket created successfully, then its attachment upload fails (e.g. oversized/invalid file) | Ticket still exists and is fetchable; failed file not attached; retry succeeds from Ticket Detail | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| UI-01 | UI | BR-04 | Selector lists only active requesters | Inactive seed row never rendered | `client/tests/lab-02/RequesterSelector.test.tsx` | Pass |
| UI-02 | UI | AC-23 | Selector empty state | Safe empty message; no selectable dropdown | `client/tests/lab-02/RequesterSelector.test.tsx` | Pass |
| UI-03 | UI | AC-24 | Selector API failure | Failure state + retry; no crash | `client/tests/lab-02/RequesterSelector.test.tsx` | Pass |
| UI-04 | UI | AC-02 | My Tickets with no requester selected | Redirects to Selector | `client/tests/lab-02/MyTickets.test.tsx` | Pending |
| UI-05 | UI | AC-04, AC-05 | Create Ticket inline validation | Field-level messages; no fetch call fired | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| UI-06 | UI | AC-06 | Submit busy state | Button disabled + busy label while pending | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| UI-07 | UI | AC-07, BR-18 | API failure on submit | Error banner shown; field values retained | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| UI-08 | UI | AC-08, AC-09 | Invalid attachment selection | Inline rejection message; file not queued | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| UI-09 | UI | AC-01 | Successful submission | Confirmation card shows generated Ticket Number | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| UI-10 | UI | AC-13, AC-14, BR-28 | Empty vs. No-Results | Distinct copy/actions for each zero-result case | `client/tests/lab-02/MyTickets.test.tsx` | Pending |
| UI-11 | UI | AC-12, BR-05 | Switching requester | List reloads to the new requester's own tickets; an in-progress Create Ticket draft is discarded on switch | `client/tests/lab-02/MyTickets.test.tsx` | Pending |
| UI-12 | UI | AC-17 | Ticket Detail header | All fields render read-only, no editable controls | `client/tests/lab-02/RequesterTicketDetail.test.tsx` | Pending |
| UI-13 | UI | AC-18, AC-20 | Attachment add/remove controls | New attachment appears without reload; removed shows badge, no Download | `client/tests/lab-02/AttachmentSection.test.tsx` | Pending |
| UI-14 | UI | AC-26 | Keyboard focus | Visible focus ring on every Create Ticket control incl. Requester field | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| UI-15 | UI | AC-02 | Guard on every Requester-scoped route | `/tickets`, `/tickets/new`, and `/tickets/:id` all redirect to the Selector when nothing is selected; the blocked path is resumed after Continue | `client/tests/lab-02/RequesterContext.test.tsx` | Pass |
| UI-16 | UI | BR-03, BR-05 | Selection persistence and replacement | Selection survives a reload, switching replaces the previous Requester outright, and corrupted stored data falls back to "nothing selected" instead of crashing | `client/tests/lab-02/RequesterContext.test.tsx` | Pass |
| UI-17 | UI | ui-spec §1.1, §5 | Light/dark theme switch | Toggles `<html data-theme>`, persists the choice, follows the OS preference until an explicit choice is made, falls back to light when `matchMedia` is unavailable, and arms the 220ms colour transition for the switch only (restarting it if switched again mid-animation) | `client/tests/lab-02/ThemeToggle.test.tsx` | Pass |
| UI-18 | UI | ui-spec §5, handout §8 | Primary nav active-page indication | Exactly one nav item is active per screen: My Tickets on `/tickets` and on a Ticket Detail route, Create Ticket on `/tickets/new` only; the active item also carries `aria-current="page"` | `client/tests/lab-02/AppShellNav.test.tsx` | Pass |
| UI-19 | UI | ui-spec §1.1 | No flash of the wrong theme on load | `index.html` inlines a critical background for both themes (matching `--zg-bg`) and stamps `data-theme` before first paint, resolving stored-then-OS identically to `initialTheme()` | `client/tests/lab-02/ThemeFlash.test.tsx` | Pass |
| UI-20 | UI | ui-spec §5 | Active nav marker is the green rule, not underlined text | No `text-decoration: underline` anywhere in the shell; the active rule uses `--zg-nav-active` at both breakpoints, and that token is theme-independent because the header is | `client/tests/lab-02/AppShellNav.test.tsx` | Pass |
| RESP-01 | Responsive/Visual | AC-25 | Desktop/tablet/mobile screenshots | No clipping/overlap/horizontal scroll on any of the 3 screens | `e2e/lab-02/visual-regression.spec.ts` | Pending |
| RESP-02 | Responsive/Visual | ui-spec §7 | Badge consistency | Priority/status badges render identically across My Tickets and Ticket Detail | `e2e/lab-02/visual-regression.spec.ts` | Pending |
| E2E-01 | E2E | AC-01, AC-11, AC-17, AC-18, AC-20 | Full requester flow | Select requester → create ticket → find it in My Tickets → open Detail → add attachment → soft-remove it | `e2e/lab-02/requester-ticket-flow.spec.ts` | Pending |
| E2E-02 | E2E | AC-03 | Cross-requester access blocked end-to-end | Requester B cannot open Requester A's ticket via direct navigation | `e2e/lab-02/requester-ticket-flow.spec.ts` | Pending |

## 3. Acceptance-Criterion Traceability

| AC | Covered by |
| --- | --- |
| AC-01 | UNIT-01, API-01, UI-09, E2E-01 |
| AC-02 | UI-04, UI-15 |
| AC-03 | API-09, E2E-02 |
| AC-04 | API-02, UI-05 |
| AC-05 | API-03, UI-05 |
| AC-06 | UI-06 |
| AC-07 | UI-07 |
| AC-08 | API-11, UI-08 |
| AC-09 | API-12, UI-08 |
| AC-10 | API-13 |
| AC-11 | API-05, E2E-01 |
| AC-12 | UI-11 |
| AC-13 | API-06, UI-10 |
| AC-14 | UI-10 |
| AC-15 | API-07 |
| AC-16 | API-08 |
| AC-17 | UI-12 |
| AC-18 | API-10, UI-13, E2E-01 |
| AC-19 | API-14 |
| AC-20 | API-17, UI-13, E2E-01 |
| AC-21 | API-15 |
| AC-22 | API-16 |
| AC-23 | UI-02 |
| AC-24 | UI-03 |
| AC-25 | RESP-01 |
| AC-26 | UI-14 |
| AC-27 | API-20 |
| AC-28 | API-21 |
| AC-29 | API-22 |
| AC-30 | API-23 |
| AC-31 | API-24 |
| AC-32 | API-25 |
| AC-33 | API-26 |
| AC-34 | API-27 |
| AC-35 | API-28 |

## 4. Responsive and Visual Checklist

See `docs/lab-02/ui-spec.md` §10 — executed and checked off during Issue 9, with screenshots
saved to `artifacts/lab-02/screenshots/`.

## 5. Test Commands

```bash
cd server && npm test    # unit + API tests (server/tests/lab-02/*)
cd client && npm test    # UI component tests (client/tests/lab-02/*)
npx playwright test e2e/lab-02   # responsive/visual + E2E specs
```

## 6. Final Results

Updated as each Issue's PR lands in `lab2-staging`; a full final run is recorded here once
`lab2-staging` merges to `main`.

| Issue | Suite | Result |
| --- | --- | --- |
| 14 — Development Requester context | `cd server && npm test` | 4 files, 14 tests passed |
| 14 — Development Requester context | `cd client && npm test` | 5 files, 24 tests passed |
| Shell polish (theme switch, 1600px width, nav active state) | `cd client && npm test` | 8 files, 54 tests passed |
| 15 — Create Ticket | `cd server && npm test` | 8 files, 61 tests passed |
| 15 — Create Ticket | `cd client && npm test` | 9 files, 71 tests passed |

## 7. Known Limitations or Deferred Tests

- No load/performance testing of pagination or search at scale — out of scope for Lab 2.
- No automated cross-browser matrix; Playwright runs on Chromium only.
- The Create Ticket attachment picker is a plain file input in Lab 2; the drop-zone
  behaviour named in ui-spec.md §6.2 is deferred with the rest of the visual polish to
  Issue 19. Type/size/count rejection is implemented and covered by UI-08 either way.
- The dark appearance is asserted at the `data-theme` level (UI-17), not by computed colour;
  the palette's contrast ratios are recorded in `ui-spec.md` §1.1 and confirmed by eye during
  Issue 19's visual QA rather than by an automated contrast check.
- `requesterId` spoofing (asserting someone else's id with no auth) is a known, accepted gap per
  BR-03/BR-29 — not tested as a "vulnerability" since it is explicitly out of scope until Lab 3
  authentication exists.
