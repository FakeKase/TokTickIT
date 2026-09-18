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
| Rules, shown before submission | 8–72 characters; must differ from the current password |
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
| IT Priority | Low / Medium / High / Urgent | Low → neutral tint; Medium → `--zg-warning` tint; High → `--zg-error` tint; Urgent → solid `--zg-error`, white text — the only filled badge in the system, and the only one that should catch the eye across a full queue |
| Current Status | New, Open, In Progress, Waiting for Requester, Resolved, Closed, Reopened, Cancelled | Open family (New/Open/Reopened) → `--zg-pale` with `--zg-secondary` text; active (In Progress) → `--zg-secondary` tint; blocked (Waiting for Requester) → `--zg-warning` tint; finished (Resolved/Closed) → neutral tint with a check glyph; Cancelled → neutral tint, strikethrough label |
| Role | Requester / IT Staff / Administrator | Outlined, `--zg-text` on `--zg-surface`; distinguished by label, not colour, because a role badge sits next to a name and must not compete with workflow signals |

The two priority badges appear side by side in the queue and on Ticket Detail, each under its own
column or label. Where space forces one away, IT Priority wins — it is the operational number.

## 4. IT Staff Ticket Queue (`/staff/tickets`)

Purpose: let IT Staff find the next thing to work on, then open it. Not a reporting surface.

**Controls row** — search box (Ticket Number or Summary), Status filter, IT Priority filter,
Category filter, and an Owner filter with `All / Mine / Unassigned`. `Clear filters` is a secondary
button, shown only when at least one filter is active.

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
secondary line.

**Mobile (<768px)** — one card per Ticket: Ticket Number and Status on the first row, Summary on
the second, IT Priority and Owner on the third. Filters collapse behind a `Filters` toggle showing
an active-count. Whole card is the tap target, ≥44px tall.

**States** — Loading (skeleton rows, not a bare spinner, so the layout does not jump), Empty ("No
Tickets in the queue yet."), No-Results ("No Tickets match these filters." + `Clear filters`),
Forbidden, and safe Failure with a Retry action. Empty and No-Results are distinct, as in Lab 2
BR-28.

## 5. IT Staff Ticket Detail (`/staff/tickets/:id`)

Extends the Lab 2 Ticket Detail layout rather than replacing it: the same read-only ticket header
card, the same attachment list. Two things are added.

**Workflow panel** (right column on desktop, directly under the header on mobile) — the only
editable region on the screen, visually separated with a `--zg-pale` background so that the
read-only ticket information above it is unmistakably read-only:

| Control | Behaviour |
| :-- | :-- |
| Ticket Owner | Shows current owner or "Unassigned". `Claim` primary button when unassigned or owned by someone else; a `Reassign` select listing active IT Staff and Administrators; `Unassign` as a tertiary action |
| IT Priority | Select of the four values; saves on change with an inline saving indicator, and reverts visibly on failure |
| Status | Select offering **only the transitions permitted from the current status** (§5.2 of `specification.md`). A transition to Resolved or Closed with no owner is disabled with an adjacent reason, and the backend rejects it regardless |
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
names exactly that risk.

## 6. Requester Ticket Detail additions

The Lab 2 screen keeps its read-only header and attachment management, and gains:

- the **Public Comments** section described above, with the same composer, and no sign anywhere that internal notes exist;
- a **`Problem appears resolved`** secondary button in the header card, with a confirmation step ("This tells IT Staff the issue looks fixed. They will confirm and close the Ticket.") — after which it is replaced by the `--zg-pale` callout and the accompanying comment appears in the thread;
- the Current Status badge, which in Lab 2 only ever read "New" and now carries the full family.

## 7. Administrator User Management (`/admin/users`)

One screen. Intentionally the plainest surface in the application.

**Controls row** — search box (name or email), Role filter, and a `New user` primary button.

**Table** — Name, Email, Role badge, Status (`Active` / `Inactive` chip), Edit action. Unpaginated
(BR-38). Below 768px each row becomes a card with the same five fields stacked.

**Create / Edit panel** — a modal dialog on desktop, a full-screen sheet on mobile, with a focus
trap and `Esc` to dismiss:

| Field | Create | Edit |
| :-- | :-- | :-- |
| Name | Required, 2–80 | Editable |
| Email | Required, valid, ≤120 | Editable; duplicate rejected with a field-level message on the email field, not a banner |
| Role | Required, one of three, radio group rather than a select — three options do not need a dropdown | Editable |
| Active | Checkbox, default on | Editable; disabled with a reason when editing yourself or the last active Administrator |
| Initial password | Required, 8–72 | Not shown; replaced by a `Set new initial password` secondary action with its own confirmation |

**Guard-rail feedback** — the two safety rules (BR-32, BR-33) are shown as disabled controls *with
a visible reason beside them*, never as a silent absence, and are enforced by the backend
regardless of what the dialog allows:

- "You cannot deactivate your own account."
- "This is the last active Administrator. Promote another Administrator first."

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

- [ ] No clipping, overlap, or unintended horizontal scroll at 375px, 820px, 1280px on Login, Change Password, Ticket Queue, IT Staff Ticket Detail, and User Management
- [ ] Role navigation renders only permitted destinations for each of the three roles
- [ ] The three badge families are mutually distinguishable by computed colour, and each carries its text label
- [ ] Editable workflow controls are visually distinct from the read-only ticket header on IT Staff Ticket Detail
- [ ] Public Comments and Internal Notes are distinguishable by computed background colour, not only by heading text
- [ ] Validation messages sit directly below their field on Login, Change Password, and the user dialog
- [ ] Focus is visible on every interactive control, and the user dialog traps and restores it
- [ ] Disabled guard-rail controls in User Management carry a visible reason
- [ ] Screens are consistent with `docs/lab-02/ui-spec.md` §1–§4 — same tokens, same button hierarchy, same field states

## 11. Screenshot Paths

```text
artifacts/lab-03/screenshots/
├── authentication/      (login, login-invalid, login-busy, change-password, change-password-invalid, shell-by-role, logged-out)
├── staff-queue/         (desktop, tablet, mobile, filters-applied, no-results, empty, unassigned)
├── staff-ticket-detail/ (desktop, mobile, ownership, it-priority, status-transition, comments, internal-notes, forbidden-api)
└── user-management/     (list, search, role-filter, create, duplicate-email, edit, initial-password, guard-rails, mobile)
```
