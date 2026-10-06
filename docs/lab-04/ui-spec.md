# Lab 4 UI Specification - Zen Green, Final

Lab 4 adds no new design language. The tokens, field states, button hierarchy and breakpoints of
`docs/lab-02/ui-spec.md` and the shell, badges and conversation streams of
`docs/lab-03/ui-spec.md` stay in force. This document specifies what is new or changed: Dashboard
navigation, two dashboards, the Actions Taken area, the resolution feedback in the status control,
and what is removed.

Breakpoints are unchanged: mobile below 768px, tablet from 768px, desktop from 992px.

## 1. Application shell and navigation

| Role | Navigation items, in order | Landing route |
| :-- | :-- | :-- |
| Requester | Dashboard, My Tickets, Create Ticket | `/dashboard` |
| IT Staff | Dashboard, Ticket Queue | `/staff/dashboard` |
| Administrator | Dashboard, Ticket Queue, User Management, System Status | `/staff/dashboard` |

- Dashboard is the first item for every role and the page each role reaches after signing in,
  after a password change, and from the Forbidden state's link.
- `/` no longer shows a page. It leads to the role's landing route.
- The TokTickIT wordmark links to the landing route.
- Active-item marking is unchanged: one item at a time carries the 2px `--zg-nav-active` rule and
  `aria-current="page"`. Dashboard is active only on its own route; opening a Ticket from a
  dashboard row marks My Tickets or Ticket Queue, since that is where the Ticket lives.
- Only permitted destinations are rendered. A Requester has no staff item and IT Staff have no
  System Status item.

## 2. Metric cards and dashboard lists

One new component, used by both dashboards.

**Metric card.** A `Card` whose whole surface is one link.

| Part | Rule |
| :-- | :-- |
| Label | The metric's name in body text, above the value |
| Value | The count in the heading scale, `--zg-heading` colour. Zero is shown as `0`, never as a dash or blank |
| Action | "View all" in link colour beneath the value, so the card reads as a destination without relying on hover |
| Accessible name | Label, value and action together, for example "Open Tickets, 3, view all" |
| Focus | The standard 3px focus ring on the card itself |
| No drill-down | A metric with no drill-down (My Actions Today) is a plain card: not a link, no "View all", not focusable |

Cards carry no trend arrows and no "since yesterday" figures. The contract defines no such metric,
and a number with nothing behind it is decoration.

**Dashboard list.** A `Card` with a heading and at most five rows. Each row is one link showing the
Ticket Number, the Summary on one truncated line with the full text in `title`, the status badge,
and a date. An empty list shows one line of text in place of rows, given per list below. A list is
never hidden when empty: a section that vanishes looks like a fault.

Arrangement: metric cards in a row of four on desktop, two by two on tablet, one column on mobile.
Lists sit side by side on desktop and stack below 992px.

## 3. Requester Dashboard (`/dashboard`)

Heading: "Welcome, <first name>" with the line "Here is the latest on your Tickets." A `Create
Ticket` primary button sits beside the heading, as on My Tickets.

| Metric card | Opens |
| :-- | :-- |
| Open Tickets | My Tickets, status filter "Active" |
| Waiting for You | My Tickets, status filter "Waiting for Requester" |
| Resolved | My Tickets, status filter "Resolved" |
| Closed | My Tickets, status filter "Closed" |

| List | Row date | When empty |
| :-- | :-- | :-- |
| Needs your attention | Last updated | "Nothing is waiting for you." |
| Recently updated | Last updated | "No Tickets yet." |
| Recently resolved | Resolved on | "Nothing was resolved in the last 7 days." |

Needs your attention comes first and its card carries the 3px `--zg-warning` left rule while it has
rows, the same cue the staff screens use for content that wants a response. It has "View all"
leading to the Waiting for Requester filter; Recently updated has "View all" leading to My Tickets
sorted by Last Updated.

Modes: loading (the shared spinner, "Loading your dashboard..."), view, empty account, failure.

- **Empty account.** A Requester with no Tickets at all sees the four cards at `0` and, in place of
  the three lists, one empty state: "You have not created any Tickets yet", with a `Create Ticket`
  action. The cards stay because zero is the true count.
- **Failure.** The shared error state, "Unable to load your dashboard", with `Try again`. No card or
  number is shown beside it: partial figures would be read as real ones.

The screen does not repeat My Tickets. It has no search, no table and no pagination; five rows and a
link is the most it shows of any list.

## 4. IT Staff Dashboard (`/staff/dashboard`)

Heading: "Welcome back, <first name>" with the line "Here is what is happening in the queue."

| Metric card | Opens |
| :-- | :-- |
| Unassigned | Ticket Queue, owner "Unassigned", status "Active" |
| My Tickets | Ticket Queue, owner "Mine", status "Active" |
| Urgent | Ticket Queue, IT Priority "Urgent", status "Active" |
| My Actions Today | Nothing. Its subtitle reads "Bangkok time" |

**Tickets by Status.** A card listing all eight statuses, each row a link holding the status badge
and its count, opening the Ticket Queue filtered to that status. A status with no Tickets is shown
with `0` and stays a link. On desktop the eight rows run in two columns of four.

| List | Row shows | When empty |
| :-- | :-- | :-- |
| Recently updated Tickets | Ticket Number, Summary, status badge, IT Priority badge, owner or "Unassigned", last updated | "No Tickets yet." |
| My recent Actions Taken | Action Date/Time, Ticket Number, the description preview, and a "Follow-up required" badge when set | "You have not recorded any Actions Taken yet." |

A row of My recent Actions Taken opens that Ticket's IT Staff Ticket Detail scrolled to its Actions
Taken area.

**Administrator.** The same screen, plus one more card, "User accounts", showing "Active" and
"Inactive" with their counts and linking to User Management. IT Staff do not see the card or any
placeholder for it.

Modes: loading, view, failure, as in §3. There is no empty-account mode: a staff user with nothing
assigned sees zeros and the empty lines, which is a normal day, not a blank account.

**Forbidden.** A Requester who types `/staff/dashboard`, or a staff user who types `/dashboard`,
gets the existing Forbidden state inside the shell with a link to their own Dashboard.

## 5. Drill-down targets

A count is only as good as the list it opens, so the two list screens change to receive the links.

**My Tickets (`/tickets`).**
- Filters, sort and page now live in the URL, as the Ticket Queue's already do. A dashboard link, a
  reload and the Back button all show the same list.
- A **Status** select joins Category and Requested Priority: All Statuses, Active, then the eight
  statuses. "Active" means New, Open, In Progress, Waiting for Requester and Reopened.
- **Last Updated** becomes a sortable column and an option in the mobile Sort by select.
- Arriving from a dashboard card, the matching filter is shown selected in its control, the
  No-Results state and `Clear Filters` behave as for a filter chosen by hand.

**Ticket Queue (`/staff/tickets`).** The Status select gains "Active" after "All Statuses".
Nothing else changes; it already reads its view from the URL.

## 6. Actions Taken on Ticket Detail

A new section headed "Actions Taken", with `id="actions-taken"`, on both Ticket Detail screens. It
sits after the attachments and before the conversation: what was done, then what was said.

### 6.1 The list

| Width | Form |
| :-- | :-- |
| 768px and above | A table: Action Date/Time, Action Description, Result, Performed by, Follow-up, and a `View` button |
| Below 768px | The same rows as cards: Action Date/Time and Performed by on the first line, then Description, Result, the follow-up badge, and `View` |

- Order is fixed: newest Action Date/Time first (BR-10). The table has no sort controls.
- Description and Result show at most three lines in the list and wrap anywhere, so a long file name
  cannot widen the page. The full text is in the dialog.
- **Follow-up** is a badge with words, never colour alone: "Follow-up required" in the warning tone,
  or "No follow-up" in the neutral tone.
- An edited row shows "Edited by <name>, <date>" in muted text under Performed by.
- Under the heading, a count: "3 Actions Taken", or the empty line.
- **Empty.** "No Actions Taken have been recorded for this Ticket yet." For staff on an active
  Ticket the line is followed by the `Add Action Taken` button.
- **Loading** and **failure** are local to the section: the shared spinner, or "Unable to load the
  Actions Taken" with `Try again`. The rest of the Ticket stays usable.

### 6.2 What each role sees

| | IT Staff and Administrator | Requester |
| :-- | :-- | :-- |
| List and `View` | Yes | Yes, every Action Taken and every field |
| `Add Action Taken` (primary, beside the heading) | On an active Ticket | Never |
| `Edit` in the dialog | On an active Ticket | Never |
| Section subtitle | "Work recorded on this Ticket. Visible to the Requester." | "Work IT Staff have recorded on your Ticket." |

The staff subtitle states the visibility on purpose. Internal Notes sit on the same screen and are
private; Actions Taken are not, and the person typing should not have to remember which is which.

On a Resolved, Closed or Cancelled Ticket, staff see no `Add Action Taken` and no `Edit`. In their
place: "This Ticket is <status>. Reopen it to record more work." (BR-08).

### 6.3 The dialog: create, view and edit

One `Dialog`, three modes. It follows the Lab 3 dialog rules: labelled by its heading, focus
trapped, focus returned to the control that opened it, `Esc` and `Cancel` close it, and the page
behind does not scroll.

| Mode | Heading | Content | Actions |
| :-- | :-- | :-- | :-- |
| Create | Add Action Taken | The form below, Action Date/Time prefilled with now | `Save Action Taken` (primary), `Cancel` |
| View | Action Taken | Every field as read-only text, plus Performed by, Recorded, and Edited by when present | `Edit` (staff, active Ticket), `Close` |
| Edit | Edit Action Taken | The form, filled with the saved values | `Save changes` (primary), `Cancel` |

**Form fields, in order**

| Field | Control | Notes |
| :-- | :-- | :-- |
| Action Date/Time | `datetime-local`, required, minutes only (no `step`) | Help text: "When the work was done." Prefilled in create mode with the current time to the minute. That value is always accepted, including on a Ticket created seconds ago, because BR-05 compares to the minute |
| Action Description | Textarea, required, 2000 | Character count beneath |
| Result | Textarea, required, 1000 | Character count beneath |
| Follow-Up Required? | Checkbox | Unchecked by default |
| Follow-up Note | Textarea, 1000 | Shown only while the checkbox is checked, and required then. Unchecking hides it and its text is not sent |
| Attachment Notes | Text input, optional, 500 | Help text: "Which file to look for, such as a photo or log. Files are not uploaded here." |
| Performed by | Read-only text, not a field | Create: "<your name> (you)". Edit: the original performer, with "Cannot be changed" |

Read-only values use the read-only presentation from Lab 2 (plain text on `--zg-field-readonly-bg`,
no border that reads as an input), so Performed by and Recorded cannot be mistaken for editable
fields.

**Validation.** Checked on submit, and again per field once it has been touched. Each message sits
directly under its field and is tied to it with `aria-describedby`; the first invalid field takes
focus. The server's `fields` map is shown the same way, under the same fields.

**Saving.** The primary button shows its busy state and both buttons are disabled until the
response arrives (BR-30). A request key is generated when the dialog opens for create and reused
for every attempt until the dialog closes, so pressing Save again after a lost response cannot
create a second row.

**After a save.** The dialog closes, the list reloads, "Action Taken recorded" or "Action Taken
updated" is announced in the shared `role="status"` region, and on the staff screen the Ticket is
reloaded too, so the Resolved option reflects the new state at once.

**Failure.** The dialog stays open with everything typed still in it (BR-31).

| Response | Shown |
| :-- | :-- |
| `400` | Field messages, as above |
| `409 STALE_ACTION` | An alert at the top of the dialog: "<name> changed this Action Taken while you were editing. Your text is still here." Two buttons: `Save my version`, which sends the form again based on the current version, and `Discard my changes`, which loads the current values |
| `409 TICKET_NOT_ACTIVE` | The server's message in the alert, and the Ticket reloads behind the dialog |
| Network failure or `500` | "Unable to save the Action Taken. Your text is still here. Try again." |

## 7. Ticket workflow and resolution feedback

The Lab 3 workflow panel keeps its three controls. What changes:

- **Only permitted moves.** `Move to` still lists exactly the Ticket's `transitions`. Nothing else
  is offered, disabled or otherwise.
- **A blocked move says why.** A transition with a `blockedReason` is listed disabled, and the
  reason is shown as text under the select for as long as it applies, for example "Resolved: Record
  an Action Taken before resolving this Ticket". It is the server's sentence, displayed, not a
  condition the screen evaluates. When the reason concerns Actions Taken it ends with a link to the
  Actions Taken area.
- **The gate clears without a reload.** Recording an Action Taken reloads the Ticket, so Resolved
  becomes available as soon as the gate is met.
- **Success.** The status badge in the Ticket summary card changes to the new status, the panel
  shows the new set of moves, and "Status changed to <status>" is announced.
- **Conflict.** `STALE_TICKET` and every other `409` show the server's message under the control it
  came from and reload the Ticket, as in Lab 3. The message for a stale Ticket is "This Ticket was
  changed by someone else. Reload it and try again."; the reload has already happened by the time
  it is read, and the control shows the current value.
- **One change at a time**, as before: while one control is saving, the others are disabled.

The Requester's Ticket Detail gains nothing here. It still shows the status badge, the `Problem
appears resolved` button and its callout, and no status control.

## 8. System Status and removals

- **System Status (`/system-status`, Administrator only).** The Lab 1 Check System content: whether
  the API and the database answer, and the Category list. The "Submit Request" buttons, which never
  did anything, are removed. Any other role typing the address gets the Forbidden state.
- **Removed from `/`.** The landing page for every role is now their Dashboard.
- **Swept in the hardening Issue.** Any remaining placeholder text, dead link, control without an
  effect, or style that differs between screens for the same component. Each one found is listed in
  §10 with what was done.

## 9. Screen modes and feedback

| Screen | Modes |
| :-- | :-- |
| Requester Dashboard | Loading, view, empty account, forbidden, failure |
| IT Staff Dashboard | Loading, view, forbidden, failure |
| Actions Taken area | Loading, list, empty, failure |
| Action Taken dialog | Create, view, edit, validating, saving, conflict, failure |
| IT Staff Ticket Detail | As Lab 3, plus blocked transition and stale conflict |
| My Tickets | As Lab 2, plus status filter and URL-held view |
| System Status | Loading, view, forbidden, failure |

The same component is used for the same mode on every screen: `LoadingSpinner` for loading,
`EmptyState` for empty and no-results, `ErrorState` with a retry for failure, the Forbidden state
for a role that may not be here, field messages under fields for validation, and an alert beside
the control for a conflict. Conflict is never worded as "invalid": the input was fine and the
system refused it for a reason the message gives.

Responsive and accessibility rules are those of Labs 2 and 3. Specific to this sprint:

- nothing on a dashboard scrolls sideways at any width; a long Summary truncates, a long Ticket
  Number does not wrap;
- every metric card and list row is a real link, reachable by Tab in reading order, with a visible
  focus ring;
- counts are text, and nothing is conveyed by colour alone: follow-up, blocked moves and attention
  all carry words;
- the Actions Taken table has a caption and column headers with `scope="col"`; the cards below
  768px carry the same labels as text;
- the dialog fits a 375px viewport without horizontal scroll, with the mobile layout the Lab 3 user dialog already has.

## 10. Visual and Accessibility Checklist

To be completed in the hardening and visual evidence Issue. As in Labs 2 and 3, each box is ticked
only when an assertion in `e2e/lab-04/visual-regression.spec.ts` backs it, and each capture is also
looked at.

- [ ] No clipping, overlap or horizontal scroll at 375px, 820px and 1280px on both dashboards, the Actions Taken area on both Ticket Detail screens, the Action Taken dialog in all three modes, My Tickets with a status filter, and System Status
- [ ] Design consistency: a metric card, a dashboard list and the Actions Taken table use the same card surface, border, radius, heading scale and link colour as the Lab 2 and Lab 3 screens, by computed style
- [ ] Dashboards: every card and row is a link with an accessible name that includes its count; zero is shown as `0`; an empty list shows its line and is not hidden
- [ ] Actions Taken: table at 768px and above, cards below; long unbroken text wraps inside its cell; the follow-up state is a worded badge
- [ ] Editable and read-only: in the dialog, Performed by and Recorded are visibly read-only and are not focusable inputs; the view mode contains no input at all
- [ ] Validation placement: each message is directly under its field and referenced by `aria-describedby`; the first invalid field receives focus
- [ ] Keyboard focus: every control on both dashboards and in the Actions Taken area shows a focus ring; the dialog traps focus and returns it to the control that opened it
- [ ] Status, IT Priority and follow-up badges are distinguishable from one another by computed colour and each carries a text label with at least 4.5:1 contrast, in both themes
- [ ] Private and shared content: Internal Notes keep their distinct surface and left rule, and the Actions Taken section states that it is visible to the Requester
- [ ] The blocked Resolved option is disabled and its reason is visible as text beside the control
- [ ] Role navigation shows Dashboard first for each role, with exactly one item marked current on every route
- [ ] No console error on any screen for any role, and no link that leads nowhere

## 11. Screenshot Paths

```text
artifacts/lab-04/screenshots/
├── responsive/           (<screen>-<viewport>[-dark]: staff-dashboard, requester-dashboard, actions-taken-staff,
│                          actions-taken-requester, action-dialog, my-tickets-status-filter, system-status;
│                          desktop, tablet and mobile; light and dark)
├── staff-dashboard/      (desktop, tablet, mobile, admin-user-counts, drill-down-unassigned, drill-down-status,
│                          my-recent-actions, zero-metrics, loading, forbidden, failure, metric-vs-database)
├── requester-dashboard/  (desktop, tablet, mobile, needs-attention, drill-down-active, empty-account,
│                          ownership-api, forbidden, failure)
├── actions-taken/        (list, two-performers, create, validation, follow-up-required, edit, edited-by,
│                          stale-conflict, requester-read-only, frozen-resolved, forbidden-api, failure, mobile)
├── ticket-workflow/      (permitted-transitions, gate-no-actions, gate-follow-up, gate-cleared, resolved,
│                          stale-ticket, requester-no-control)
└── regression/           (login, my-tickets, ticket-detail, attachments, public-comments, staff-queue,
                           internal-notes, user-management, system-status)
```
