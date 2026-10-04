# Lab 3 UI Specification — Zen Green, Authenticated

Lab 3 adds no new design language. Every token, field state, button variant, breakpoint, and
accessibility rule in `docs/lab-02/ui-spec.md` §1–§4, §8 and §9 stays in force and is reused
unchanged. This document specifies only what is new: the two unauthenticated screens, the
authenticated shell, the three new role screens, and the badge families they need.

The test of success is that a person cannot tell which sprint built a given screen.

## 1. Screens outside the application shell

Login and Change Password render on `--zg-bg` with a single centred `--zg-surface` card
(max-width 420px), the TokTickIT wordmark above it in `--zg-primary`, and no navigation
whatsoever — there is nowhere legitimate to go from either.

### 1.1 Login

| Element | Specification |
| :-- | :-- |
| Fields | Email (`type="email"`, autofocus, `autocomplete="username"`), Password (`type="password"`, `autocomplete="current-password"`) |
| Primary action | `Sign in`, full card width |
| Validation | Field-level, below each control, per Lab 2 §3 — a missing email and a missing password are reported separately |
| Failure | One region above the primary action, `role="alert"`, reading **"Invalid email or password."** for a wrong password, an unknown address, and an inactive account alike (BR-08) |
| Busy | Primary button shows the spinner and "Signing in…", disabled until the response settles |
| Never shown | Which of the two fields was wrong; whether an account exists; whether it is inactive |

An inactive account is deliberately indistinguishable from a wrong password on this screen. That
is a decision with a UX cost — a deactivated employee gets no explanation — and it is taken anyway,
because the alternative hands an unauthenticated visitor a list of which addresses are real.

### 1.2 Change Password (mandatory)

Reached automatically whenever the authenticated user holds an initial password, and it is the only
reachable route until they do not (BR-02, BR-14). There is no Cancel or Skip; Logout remains
available, because trapping someone on a screen with no exit is worse than letting them leave.

| Element | Specification |
| :-- | :-- |
| Explanatory line | "Your account was created with a temporary password. Choose a new one to continue." |
| Fields | Current password, New password, Confirm new password, all `autocomplete="new-password"` where applicable |
| Rules, shown before submission | At least 8 characters, at most 72 bytes, and different from the current password. The ceiling is shown as "about 72 letters, fewer in scripts like Thai" rather than as a byte count, which means nothing to the person typing |
| Validation | Per field; the confirmation mismatch attaches to the confirmation field, not to the new-password field |
| Success | Redirect to the role's landing screen, with a success message in the shell |

## 2. Authenticated application shell

Extends Lab 2 §5. The Requester name and `Change Requester` tertiary action are **removed** with
the selector.

- **Right of the header**: theme switch (unchanged), then the authenticated user's name with a role badge beneath or beside it, then a `Log out` tertiary action.
- **Navigation, by role** — only permitted destinations are rendered, never rendered-and-disabled:

| Role | Navigation items | Landing route |
| :-- | :-- | :-- |
| Requester | My Tickets, Create Ticket | `/tickets` |
| IT Staff | Ticket Queue | `/staff/tickets` |
| Administrator | Ticket Queue, User Management | `/admin/users` |

- Active-item marking, the 2px `--zg-nav-active` rule, and `aria-current="page"` behave exactly as in Lab 2 §5. **Ticket Queue** owns `/staff/tickets` and every `/staff/tickets/:id` route.
- Mobile (<768px): the nav collapses into the existing hamburger; the user name truncates with a `title` tooltip before the role badge or `Log out` is allowed to wrap.
- A forbidden route typed directly renders a Forbidden state inside the shell — "You do not have permission to view this page." plus a link to the role's landing screen — rather than a blank page or a redirect loop.

## 3. Badges

Three families, each with its own ramp so that a status badge is never mistaken for a priority
badge at a glance. As in Lab 2 §7, every badge carries its text label; colour is never the only
signal.

| Badge | Values | Colour mapping |
| :-- | :-- | :-- |
| Requested Priority | Low / Medium / High | Unchanged from Lab 2 §7 |
| IT Priority | Low / Medium / High / Urgent | Low → neutral tint; Medium → `--zg-warning` tint with `--zg-warning-text`; High → `--zg-error` tint; Urgent → solid `--zg-error-solid`, white text — the only filled badge in the system, and the only one that should catch the eye across a full queue |
| Current Status | New, Open, In Progress, Waiting for Requester, Resolved, Closed, Reopened, Cancelled | Open family (New/Open/Reopened) → `--zg-pale` with `--zg-secondary` text; active (In Progress) → `--zg-secondary` tint; blocked (Waiting for Requester) → `--zg-warning` tint; finished (Resolved/Closed) → neutral tint with a check glyph; Cancelled → neutral tint, strikethrough label |
| Role | Requester / IT Staff / Administrator | Outlined, `--zg-text` on `--zg-surface`; distinguished by label, not colour, because a role badge sits next to a name and must not compete with workflow signals |

The two priority badges appear side by side in the queue and on Ticket Detail, each under its own
column or label. Where space forces one away, IT Priority wins — it is the operational number.

Badge text is held to 4.5:1 against its own fill in both themes. Two base colours are too light
for that on their tint in the light theme, so those two badges take their text from tokens of their
own: `--zg-warning-text` on the warning tint and `--zg-active-text` on the active tint. The base
colours `--zg-warning` and `--zg-secondary` are unchanged and still used for rules and borders.

## 4. IT Staff Ticket Queue (`/staff/tickets`)

Purpose: let IT Staff find the next thing to work on, then open it. Not a reporting surface.

**Controls row** — search box (Ticket Number or Summary), Status filter, IT Priority filter,
Category filter, and an Owner filter with `All / Mine / Unassigned`. `Clear filters` is a secondary
button, shown only when at least one filter is active.

The four selects apply as they change. Search applies on submit, not per keystroke: a request for
every character typed would race itself and flicker the list. Changing any of them returns to
page 1.

Text typed into the search box but not yet submitted is applied along with whatever changes next,
whether a filter, the sort or the page, so the box never shows a term the list does not reflect.
`Clear filters` empties the box too, including text that was never applied.

A **Sort by** select and a direction button sit in the same row at every width. The table's
headers sort too, but only four of the five keys have a column — Created Date does not — so the
select is the one place all five are offered, and the only one on mobile, where the table is gone.
Choosing a new key starts it descending, from the select as from a header; only choosing the same
key again, or the direction button, reverses it.

**The view is in the address bar.** Filters, sort and page are query parameters on
`/staff/tickets`, with defaults left out, so the plain queue has a plain URL. Staff open a Ticket
and come back, and Back has to mean the view they left; state held only in the component would be
gone. A value in the URL that is not recognised is ignored, the same posture the API takes.
When the API clamps a page past the end (AC-26), the URL is corrected to the page that was served,
so a copied or bookmarked link does not carry a page that does not exist.

**Desktop table (≥992px)** — columns, in order:

| Column | Notes |
| :-- | :-- |
| Ticket Number | Monospace, links to detail |
| Summary | Truncated to one line with a `title` tooltip |
| Category | Text |
| Requested | Requested Priority badge |
| IT Priority | IT Priority badge |
| Status | Current Status badge |
| Owner | Name, or an "Unassigned" chip in `--zg-warning` tint |
| Last Updated | Relative ("2h ago") with the absolute timestamp in `title` |

Requester name is deliberately **not** a column. It is on the detail screen, and adding it here
produced the "unreadable mega-grid" the handout warns about; the queue is for triage, and triage
runs on priority, status, and ownership. Created Date is likewise dropped in favour of Last
Updated, which is what tells staff whether a Ticket is moving.

**Tablet (768–991px)** — Category and Requested Priority collapse into the Summary cell as a
secondary line. The Summary wraps here rather than truncating: the one-line ellipsis relies on the
`title` tooltip to show the rest, and a touch device has no hover to raise it.

At every table width, each cell other than Summary stays on one line. A badge broken across two
lines stops reading as a label, so Summary is the column that gives way.

**Mobile (<768px)** — one card per Ticket: Ticket Number and Status on the first row, Summary on
the second, IT Priority and Owner on the third. Filters collapse behind a `Filters` toggle showing
an active-count. Whole card is the tap target, ≥44px tall.

**States** — Loading (skeleton rows, not a bare spinner, so the layout does not jump), Empty ("No
Tickets in the queue yet."), No-Results ("No Tickets match these filters." + `Clear filters`),
Forbidden, and safe Failure with a Retry action. Empty and No-Results are distinct, as in Lab 2
BR-28. The controls are hidden in the Empty state, since there is nothing to narrow. Forbidden
offers a link to the user's own landing page and no Retry: a `403` is answered the same way however
often it is asked.

## 5. IT Staff Ticket Detail (`/staff/tickets/:id`)

Extends the Lab 2 Ticket Detail layout rather than replacing it: the same read-only ticket header
card, the same attachment list. Two things are added.

**Workflow panel** (right column on desktop, directly under the header on mobile) — the only
editable region on the screen, visually separated with a `--zg-pale` background so that the
read-only ticket information above it is unmistakably read-only:

| Control | Behaviour |
| :-- | :-- |
| Ticket Owner | Shows current owner or "Unassigned", marked "(you)" when it is the person looking. `Claim` primary button when unassigned or owned by someone else; a `Reassign to` select listing active IT Staff and Administrators other than the current owner, which acts on selection; `Unassign` as a tertiary action, shown only when there is an owner, and disabled with the reason beside it on a Resolved or Closed Ticket, which must keep its owner |
| IT Priority | Select of the four values; saves on change with an inline saving indicator. It is bound to the saved value, so a failed save leaves it showing what is true |
| Status | The current status as a badge, then a `Move to` select offering **only the transitions permitted from the current status**, taken from the Ticket's own `transitions` (api-spec §9). A move to Resolved or Closed with no owner is disabled with an adjacent reason, and the backend rejects it regardless. The move is made by a separate `Change status` button, not on selection: a priority can be put back, a Cancelled Ticket cannot. A final status shows a sentence saying so and no control |
| Requested Priority | Read-only, shown beside IT Priority so the difference between what was asked for and what was decided is visible |
| Requester indication | When `requesterResolvedAt` is set, a `--zg-pale` callout: "The Requester reported this appears resolved on <date>." |

**Conversation** — two streams, deliberately hard to confuse:

| | Public Comments | Internal Notes |
| :-- | :-- | :-- |
| Heading | "Public Comments — visible to the Requester" | "Internal Notes — IT Staff and Administrators only" |
| Surface | `--zg-surface`, standard border | `--zg-field-readonly-bg` (warm ivory), 3px `--zg-warning` left rule |
| Composer | Textarea + `Post comment` primary | Textarea + `Add internal note` secondary, with the visibility restated above the button |
| Entry | Author name, role badge, timestamp, then body | Same, on the ivory surface |

They are separate sections with separate composers, not one composer with a visibility toggle. A
toggle is one mis-click away from publishing an internal note to the Requester, and the handout
names exactly that risk. Each composer sends its own visibility explicitly, and a draft in one is
neither sent nor cleared by posting from the other.

**One change at a time.** While any workflow control is saving, the others are disabled. A
successful change is announced in a `role="status"` region. A refusal (`409`) shows the server's
reason under the control it came from and reloads the Ticket, because a refusal means the screen
was behind: a colleague moved it. Any other failure shows a generic message and repeats nothing
the server said.

**Attachments** are listed read-only (AC-45): name, size, date, a `Download` for an active file, and
the removal reason for a removed one. No upload control and no `Remove`.

**Back to Ticket Queue** returns to the queue view the Ticket was opened from, filters, sort and
page included, and to the plain queue when the Ticket was opened directly.

## 6. Requester Ticket Detail additions

The Lab 2 screen keeps its read-only header and attachment management, and gains:

- the **Public Comments** section described above, with the same composer, and no sign anywhere that internal notes exist;
- a **`Problem appears resolved`** secondary button in the header card, with a confirmation step ("This tells IT Staff the issue looks fixed. They will confirm and close the Ticket.") — after which it is replaced by the `--zg-pale` callout and the accompanying comment appears in the thread;
- the Current Status badge, which in Lab 2 only ever read "New" and now carries the full family.

## 7. Administrator User Management (`/admin/users`)

One screen. Intentionally the plainest surface in the application.

**Controls row** — search box (name or email), Role filter, and a `New user` primary button. Search
applies on submit; the role filter applies on change and takes whatever is in the search box with
it. `Clear filters` appears only while a filter is active.

**Table** — Name, Email, Role badge, Status (`Active` / `Inactive` chip), Edit action. Unpaginated
(BR-38). Below 768px each row becomes a card with the same five fields stacked. The row belonging
to the person looking is marked "(you)". Inactive users stay in the list.

**Create / Edit panel** — a modal dialog on desktop, a full-screen sheet on mobile, with a focus
trap and `Esc` to dismiss:

| Field | Create | Edit |
| :-- | :-- | :-- |
| Name | Required, 2–80 | Editable |
| Email | Required, valid, ≤120 | Editable; duplicate rejected with a field-level message on the email field, not a banner |
| Role | Required, one of three, radio group rather than a select — three options do not need a dropdown | Editable |
| Active | Checkbox, default on | Editable; disabled with a reason when editing yourself or the last active Administrator |
| Initial password | Required, at least 8 characters and at most 72 bytes (BR-13) | Not shown; replaced by a `Set new initial password` secondary action with its own confirmation |

On an edit only the fields that changed are sent, and nothing is sent if nothing changed.

`Set new initial password` opens a password field inside the dialog with the consequence stated
("This signs them out everywhere"), a `Confirm new password` button and a `Keep current password`
way back. Nothing is sent until it is confirmed. On your own account the action is replaced by a
link to Change Password, since using it would sign you out and then make you change the password
you had just chosen.

A duplicate email (`409`) is shown on the Email field. Either safety-rule refusal from the server is
shown at the top of the dialog in the server's words. A `400` puts each message on its field. Any
other failure shows a generic message, repeats nothing the server said, and keeps what was typed.

**Guard-rail feedback** — the two safety rules (BR-32, BR-33) are shown as disabled controls *with
a visible reason beside them*, never as a silent absence, and are enforced by the backend
regardless of what the dialog allows:

- "You cannot deactivate your own account."
- "This is the last active Administrator. Promote another Administrator first."

For the last active Administrator both the Active checkbox and the Role radios are disabled, since
either change would remove them. Which account that is comes from the server (`api-spec.md` §14),
not from counting rows in a list that may be filtered.

**The dialog** is labelled by its heading and takes focus on its first field when it opens. `Tab`
and `Shift+Tab` wrap inside it, and `Esc` closes it without saving. Both keep working if focus has
fallen out of the dialog, which is what a browser does when the button holding focus is disabled
while it saves. Closing returns focus to the control that opened it.

While a save is in flight the dialog cannot be dismissed: `Cancel` is disabled and `Esc` is ignored.
If it closed and the save then failed, the failure would have nowhere to appear.

**Editing your own account** re-reads the session once the save succeeds, so the header, the
navigation and the route guard reflect a new name or role at once. An Administrator who demotes
themselves sees the Forbidden state under their new role, not under an "Administrator" badge.

**States** — Loading, Empty ("No users yet."), No-Results ("No users match this search."),
Forbidden, saving indicator on the dialog's primary button, success message on the list after the
dialog closes, and safe Failure with Retry.

## 8. Screen modes and feedback

| Screen | Modes |
| :-- | :-- |
| Login | Idle, validating, busy, failed |
| Change Password | Idle, validating, busy, failed, success-and-redirect |
| Ticket Queue | Loading, list, empty, no-results, forbidden, failure |
| IT Staff Ticket Detail | Loading, view, saving (per control), forbidden, not-found, conflict (rejected transition), failure |
| Requester Ticket Detail | As Lab 2, plus posting and posted |
| User Management | Loading, list, empty, no-results, create, edit, saving, conflict (duplicate email), forbidden, failure |

Conflict is called out separately from validation throughout: a duplicate email and an illegal
status transition are both correct input that the system refuses, and telling a user "invalid" when
the truth is "not allowed right now" sends them to fix the wrong thing.

## 9. Responsive and accessibility

Unchanged from Lab 2 §8 and §9. Additionally:

- the queue table scrolls inside its own container below 992px only if a column cannot collapse; the page itself never scrolls horizontally;
- the role badge and user name in the header truncate before the header wraps;
- the create/edit dialog traps focus, returns focus to its trigger on close, and is labelled by its heading;
- status and priority selects announce their new value via the shared `role="status"` region after a successful save.

## 10. Visual Inspection Checklist

Completed during Issue #47 (Responsive and visual QA). As in Lab 2, every box is backed by an
assertion in `e2e/lab-03/visual-regression.spec.ts` rather than by having looked at a screenshot —
a capture passes just as happily when the layout is broken.

- [x] No clipping, overlap, or unintended horizontal scroll at 375px, 820px, 1280px on Login, Change Password, Ticket Queue, IT Staff Ticket Detail, and User Management. Also checked on the user dialog, the mobile filter panel, and the Requester's My Tickets and Ticket Detail, in both themes, with text that cannot wrap in a Summary, a comment, a note and a user's name.
- [x] Role navigation renders only permitted destinations for each of the three roles, on desktop and behind the mobile menu
- [x] The three badge families are mutually distinguishable by computed colour, and each carries its text label. Every badge label has at least 4.5:1 contrast on its own fill, in both themes, and Urgent is the only filled badge.
- [x] Editable workflow controls are visually distinct from the read-only ticket header on IT Staff Ticket Detail, and the read-only card holds no control at all
- [x] Public Comments and Internal Notes are distinguishable by computed background colour, not only by heading text, and the internal stream carries its rule down the left edge
- [x] Validation messages sit directly below their field on Login, Change Password, and the user dialog
- [x] Focus is visible on every interactive control, and the user dialog traps and restores it. Tabbed through on Login, Change Password, User Management, the queue and the staff Ticket.
- [x] Disabled guard-rail controls in User Management carry a visible reason, placed directly beside the control
- [x] Screens are consistent with `docs/lab-02/ui-spec.md` §1–§4 — same tokens, same button hierarchy, same field states. The computed style of a primary button, a secondary button and a text field on the new screens equals that of the Lab 2 Create Ticket screen.

**What the checklist found.** Four things were wrong, and were fixed rather than excused. The first
two failed an assertion. The last two passed every assertion and were seen in the captures, which
is why each capture was also looked at; the dialog one has an assertion now.

1. My Tickets overflowed the page at every width, desktop included, when a Summary held a word
   that could not wrap, such as a file name. A table cell cannot be narrower than its longest
   word. The Summary cell now breaks anywhere; the Ticket Number, the dates and the badges stay
   whole. This was a Lab 2 screen and a Lab 2 defect, not seen then because every fixture was a
   tidy sentence.
2. The amber badge (Medium priority, Waiting for Requester, Unassigned) had 3.2:1 contrast and the
   In Progress badge 4.3:1. Each now has a text token of its own, at 5.3:1 and 5.9:1. See §3.
3. In User Management one long unbroken name took the width and broke the email addresses beside
   it mid-word. Names now wrap too.
4. The page behind the user dialog could be scrolled while the dialog was open. It is held still.

The fixtures for this spec are deliberately awkward for that reason: a file name with no spaces in
a Summary, a long URL in a comment and in a note, and a user whose name is one unbroken word.

## 11. Screenshot Paths

```text
artifacts/lab-03/screenshots/
├── responsive/          (<screen>-<viewport>[-dark]: login, change-password, staff-queue, staff-queue-filters,
│                         staff-ticket-detail, my-tickets, ticket-detail, user-management, user-dialog;
│                         desktop, tablet and mobile; light and dark)
├── authentication/      (login, login-invalid, login-inactive, login-busy, login-failure, change-password,
│                         change-password-invalid, shell-by-role-requester, shell-by-role-staff, shell-by-role-admin, logged-out)
├── staff-queue/         (desktop, tablet, mobile, search, filters-applied, sorting, pagination, unassigned,
│                         no-results, empty, failure)
├── staff-ticket-detail/ (desktop, mobile, ownership, reassign, it-priority, status-transition, comments,
│                         internal-notes, attachment-continuity, requester-indication, validation, conflict,
│                         forbidden-ui, forbidden-api)
└── user-management/     (list, search, role-filter, create, invalid-input, duplicate-email, edit, initial-password,
                          initial-password-next-login, guard-rails, forbidden, failure, mobile)
```
