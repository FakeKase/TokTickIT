# Lab 2 UI Specification — Zen Green Theme

## 1. Color Tokens

Fixed by the course handout; implemented as CSS custom properties on `:root` in a shared
`theme.css` (not left as ad-hoc inline styles like Lab 1's `App.tsx`, which this sprint replaces).

The values below are the light appearance. A dark appearance redefines the same token names —
and only the colour tokens, never typography or spacing — so no component contains a
theme-aware rule.

| Token | Value | Use |
| --- | --- | --- |
| `--zg-primary` | `#006B3C` | App header, primary buttons, strong emphasis |
| `--zg-secondary` | `#0B7A46` | Active tabs, focus accents, links, hover states |
| `--zg-pale` | `#EAF6EF` | Selected / success / subtle section emphasis |
| `--zg-bg` | `#F5F7F6` | Page background |
| `--zg-surface` | `#FFFFFF` | Cards, panels — subtle border + restrained shadow |
| `--zg-text` | `#1F2E27` | Dark charcoal-green body text (not pure black) |
| `--zg-field-editable-bg` | `#FFFFFF` | Editable field background, neutral border |
| `--zg-field-readonly-bg` | `#F1F0E8` | Read-only field shading (warm ivory) |
| `--zg-error` | `#8A1F1F` | Error text/border |
| `--zg-warning` | `#B7791F` | Amber warning callouts/badges only — not decoration |
| `--zg-success` | `#0B7A46` | Success confirmation text |

### 1.1 Dark Appearance

Selected by `<html data-theme="dark">`, stamped by `ThemeProvider` rather than by a
`prefers-color-scheme` media query, so an explicit light choice still wins on a dark-set OS.
First visit follows the OS preference; after that the user's choice is remembered.

| Token | Dark value | Contrast |
| --- | --- | --- |
| `--zg-primary` | `#006B3C` (unchanged) | White label 6.6:1 |
| `--zg-secondary` | `#4CC98A` | 8.8:1 on `--zg-bg` |
| `--zg-pale` | `#14301F` | Body text 12.2:1 |
| `--zg-bg` | `#101613` | Body text 15.6:1 |
| `--zg-surface` | `#18211C` | Body text 14.1:1 |
| `--zg-text` | `#E6EFE9` | — |
| `--zg-field-editable-bg` | `#1E2A23` | Body text 12.7:1 |
| `--zg-field-readonly-bg` | `#353027` | Separated from editable by the same 1.14 step the light theme uses |
| `--zg-error` | `#F08A8A` | 6.8:1 on `--zg-surface` |
| `--zg-warning` | `#E0A94A` | 7.8:1 on `--zg-surface` |
| `--zg-success` | `#5FD39B` | 8.9:1 on `--zg-surface` |
| `--zg-neutral-tint` | `#303A34` | Body text 10.1:1 |
| `--zg-border` | `#5C7169` | 3.2:1 on `--zg-surface` |

## 2. Typography & Spacing

- Font stack: system UI stack (`-apple-system, "Segoe UI", Roboto, sans-serif`) for legibility and zero external font loading risk.
- Base size 16px; form labels 14px/600 weight; section headings 20–24px/700 weight.
- Spacing scale: 4px base unit — 8/12/16/24/32px for field gaps, section gaps, card padding.

## 3. Field & Control States

| State | Rule |
| --- | --- |
| Editable | `--zg-field-editable-bg`, 1px neutral border (`#CBD5CE`), 6px radius |
| Read-only | `--zg-field-readonly-bg`, no focus ring, `aria-readonly="true"` |
| Invalid | `--zg-error` border + text; message rendered immediately below the field, associated via `aria-describedby` |
| Disabled | 50% opacity, `cursor: not-allowed`, `pointer-events: none`; never the only signal for "busy" (paired with a spinner/label change) |
| Focused | 2px visible outline in `--zg-secondary`, never removed via `outline: none` |

Required fields show a red asterisk **next to the label**, in addition to (never instead of) the
validation message below the control.

## 4. Button Hierarchy

| Variant | Style |
| --- | --- |
| Primary | Solid `--zg-primary`, white text — one per view (Submit, Continue) |
| Secondary | Outlined `--zg-secondary`, transparent fill — (Cancel, Clear Filters) |
| Tertiary | Text-only link style — (Change Requester) |
| Destructive | Outlined `--zg-error` — (Remove Attachment) |
| Disabled | Any variant at 50% opacity, non-interactive |
| Busy | Primary variant with an inline spinner + "Submitting…" label, disabled |

## 5. Application Shell

- Header: `--zg-primary` background, "TokTickIT" wordmark left, nav center (`My Tickets`,
  `Create Ticket`), light/dark theme switch + current Requester name + `Change Requester`
  action right.
- Theme switch: 44px icon button; its icon and accessible name both describe the theme it
  switches *to*, and `aria-pressed` reports whether dark is active. Switching cross-fades the
  colour tokens over 220ms — armed only for the switch itself, so first paint and ordinary
  hover changes are never animated — and is suppressed under `prefers-reduced-motion: reduce`.
- Active nav item: underline + `--zg-secondary` text.
- Mobile (<768px): nav collapses into a hamburger menu; header stays fixed height.

## 6. Screens

### 6.1 Development Requester Selection

- Centered card on `--zg-bg`, max-width 480px.
- Title, one-sentence "testing only, not login" explanation (exact text from handout §8.1), a
  labeled `<select>` of active Requesters, a muted "Authentication coming in Lab 3" callout, and a
  primary **Continue** button (disabled until a Requester is chosen).
- **Loading**: skeleton dropdown + disabled Continue.
- **Empty** (`GET /api/requesters` → `[]`): pale-green info box — "No active Development
  Requesters are available. Contact your instructor." No dropdown rendered.
- **Failure**: error box with a **Retry** button; dropdown not rendered.

### 6.2 Create Ticket

Single-column on mobile, two-column on desktop/tablet per the arrangement below (top to bottom):

1. System-generated row (read-only): Ticket Date (client-rendered "will be set on save"), Requester (from context, read-only field, not a dropdown).
2. Classification row: Category, Related System, Requested Priority — three selects side by side on desktop, stacked on mobile.
3. Summary — single-line input, full width.
4. Description — multiline textarea, full width, resizable vertically only, min 6 rows.
5. Attachments — drop zone / file picker, list of selected files with size + a per-file remove control before submit; inline error under any rejected file.
6. Actions — Cancel (secondary) and Submit (primary, busy state per AC-06) right-aligned.

**States**: initial (empty form) → validating (inline messages per AC-04/AC-05) → submitting
(busy button, all fields disabled) → success (replaces form with the generated Ticket Number in a
`--zg-pale` confirmation card + "View Ticket" / "Create Another" actions) → failure (error banner
above the form, all entered values retained per BR-18/AC-07).

### 6.3 My Tickets

- Toolbar: search input (Ticket Number or Summary), Category filter, Requested Priority filter,
  Clear Filters, Create Ticket (primary, right-aligned).
- **Desktop (≥992px)**: table — columns Ticket No., Created Date, Summary, Category, Requested
  Priority (badge), Current Status (badge), Last Updated. Row click opens Ticket Detail.
- **Tablet (768–991px)**: same table, Created Date and Last Updated columns condense to date-only.
- **Mobile (<768px)**: one card per Ticket — Ticket No. + Summary as the card title, badges below,
  Created Date as meta text. No horizontal scroll.
- Pagination bar below the list: Previous / page numbers / Next, plus a "Showing X–Y of Z" label.
- **Loading**: skeleton rows/cards.
- **Empty** (BR-28, zero Tickets, no filters): illustration + "You haven't created any tickets
  yet" + primary Create Ticket action.
- **No-Results** (BR-28, filters active, zero matches): "No tickets match your filters" + Clear
  Filters action. Visually distinct copy/icon from Empty so the two are never confused.
- **Failure**: error banner + Retry.

### 6.4 Requester Ticket Detail

- Header card: Ticket No., Created Date, Category, Related System, Requester, Requested Priority
  (badge), Current Status (badge), Summary, Description — all rendered with the read-only field
  style (§3), grouped exactly as in the header card, never mixed with the Attachments panel below.
- Attachments panel, tabbed/sectioned separately from the header:
  - Each attachment row: filename, type icon, size, uploaded date, and either **Download** (active)
    or a **Removed** badge + reason (removed) — never both.
  - **Add Attachment** control at the top of the panel, same validation as Create Ticket's
    attachment picker.
  - Removing an attachment opens a confirmation control requiring a reason (≥3 chars, AC-22)
    before the destructive action is enabled.
- No Public Comments, Internal Notes, Actions Taken, or status controls are present (§8.5 of the
  handout).

## 7. Badges

| Badge | Values | Color mapping |
| --- | --- | --- |
| Requested Priority | Low / Medium / High | Low → `--zg-pale` text `--zg-secondary`; Medium → `--zg-warning` tint; High → `--zg-error` tint |
| Current Status | New (only reachable value in Lab 2) | `--zg-pale` background, `--zg-secondary` text |

Badges never rely on color alone — each carries its text label.

## 8. Responsive Rules

| Viewport | Behavior |
| --- | --- |
| Desktop ≥992px | Multi-column layout, content max-width 1600px, centered (raised from 1200px so wide monitors are not left with large empty gutters; still a bounded, centered measure per handout §8.7) |
| Tablet 768–991px | Two-column where practical; Summary/Description get full available width |
| Mobile <768px | Everything stacks vertically; buttons remain ≥44px touch targets; no horizontal page scroll |
| All sizes | No clipped labels, overlapping messages, hidden buttons, or unreadable attachment filenames (truncate with `title` tooltip instead) |

## 9. Accessibility

- Every control has a visible label (icon-only controls get `aria-label` + tooltip).
- Focus order follows visual order; focus ring always visible (§3).
- Error messages are associated to their field via `aria-describedby` and announced via
  `role="alert"` on the containing error region (matches the pattern already used in Lab 1's
  `App.tsx` offline banner).
- Color is never the sole indicator of state (badges/messages always carry text).

## 10. Visual Inspection Checklist (completed during Issue 9 — Responsive & Visual QA)

- [ ] No clipping/overlap/unintended horizontal scroll at 375px, 820px, 1280px widths
- [ ] Editable vs. read-only fields are visually distinguishable at a glance
- [ ] Validation messages sit directly below their field, not only at the top of the form
- [ ] Button hierarchy (primary/secondary/tertiary/destructive/disabled/busy) is consistent across all three screens
- [ ] Priority/status badges render consistently in My Tickets and Ticket Detail
- [ ] Filters, pagination, and attachment controls remain usable at all three breakpoints
- [ ] Screenshots compared against this document, not personal memory

## 11. Screenshot Paths

```text
artifacts/lab-02/screenshots/
├── create-ticket/       (initial, validation, submitting, success, api-failure, invalid-attachment)
├── my-tickets/          (desktop, tablet, mobile, empty, no-results, failure)
└── ticket-detail/       (desktop, mobile, attachment states)
```
