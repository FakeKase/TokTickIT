# Lab 4 API Contract

Base path: `/api`. This document specifies what Lab 4 adds or changes. Every endpoint in
`docs/lab-02/api-spec.md` and `docs/lab-03/api-spec.md` that is not mentioned here continues
unchanged, including `GET /api/health`.

## Conventions

The Lab 3 conventions hold: errors are `{ "error": "<safe message>" }` with an optional `fields`
map and an optional machine-readable `code`; `401` for no session, `403` for a role that may not
do this, `404` for a missing resource or one a Requester does not own, and never a stack trace,
SQL or internal identifier. Timestamps are ISO 8601 in UTC.

Lab 4 adds five conflict codes. A client branches on the code, never on the message.

| Code | Status | Meaning |
| :-- | :-: | :-- |
| `STALE_TICKET` | 409 | The Ticket's status, owner or priority changed since the version the request named (BR-16) |
| `RESOLUTION_GATE` | 409 | The move to Resolved is in the matrix but the gate is not met (BR-13) |
| `STALE_ACTION` | 409 | The Action Taken was edited since the version the request named (BR-17) |
| `TICKET_NOT_ACTIVE` | 409 | The Ticket is Resolved, Closed or Cancelled, so its Actions Taken are frozen (BR-08) |
| `REQUEST_KEY_REUSED` | 409 | The request key already belongs to an Action Taken on another Ticket or by another user |

## Authorization summary

| Endpoint | Requester | IT Staff | Administrator |
| :-- | :-: | :-: | :-: |
| `GET /api/tickets/:id/actions` | Own Ticket, else 404 | Yes | Yes |
| `POST /api/tickets/:id/actions` | 403 | Yes | Yes |
| `PATCH /api/tickets/:id/actions/:actionId` | 403 | Yes | Yes |
| `GET /api/dashboard/requester` | Yes | 403 | 403 |
| `GET /api/dashboard/staff` | 403 | Yes | Yes |
| `PATCH /api/staff/tickets/:id/{status,owner,it-priority}` | 403 | Yes | Yes |

A user holding an initial password is refused everywhere here with `403 PASSWORD_CHANGE_REQUIRED`,
as in Lab 3.

---

## 1. `GET /api/tickets/:id/actions`

The Actions Taken of one Ticket (FR-01, FR-04).

- **`200`**: an array, ordered by `actionAt` descending then `id` descending (BR-10). Empty for a
  Ticket with none.
```json
[
  { "id": 12, "ticketId": 42,
    "actionAt": "2026-10-06T03:15:00.000Z",
    "description": "Replaced the projector lamp in LX-204.",
    "result": "Projector powers on and holds an image.",
    "followUpRequired": true,
    "followUpNote": "Check lamp hours again after one week of lectures.",
    "attachmentNotes": "Photo of the old lamp label: lamp-lx204.jpg",
    "performedBy": { "id": 9, "name": "Sarah Chen" },
    "createdAt": "2026-10-06T03:20:11.000Z",
    "editedBy": null,
    "editedAt": null,
    "version": 1 }
]
```
  `editedBy` and `editedAt` are `null` until the first edit; they are the model's `editedById` and
  `editedAt` columns (`specification.md` §7.1). `performedBy` and `editedBy` carry an
  id and a name and nothing else. A Requester receives the same shape: every field is theirs to
  see (handout 8.3).
- **`404`**: no such Ticket, or a Requester who does not own it. The two bodies are identical
  (AC-05).

## 2. `POST /api/tickets/:id/actions`

Create an Action Taken (FR-02).

**Request body**
```json
{ "requestKey": "0f8b5c1e-6a0e-4d55-9a53-0e1c7b2a4d10",
  "actionAt": "2026-10-06T03:15:00.000Z",
  "description": "Replaced the projector lamp in LX-204.",
  "result": "Projector powers on and holds an image.",
  "followUpRequired": true,
  "followUpNote": "Check lamp hours again after one week of lectures.",
  "attachmentNotes": "Photo of the old lamp label: lamp-lx204.jpg" }
```

| Field | Rule |
| :-- | :-- |
| `requestKey` | Required. 8 to 64 characters from letters, digits, `-`, `_` and `:` (BR-20) |
| `actionAt` | Required ISO 8601 timestamp with a zone (`Z` or an offset), naming a real moment: 31 February or hour 24 is `400`, never stored as a neighbouring day. Not before the Ticket's `createdAt` with its seconds and milliseconds set to zero, not more than 5 minutes after the server clock (BR-05). A Ticket created at 10:00:30 accepts 10:00:00 and refuses 09:59:59 |
| `description` | Required, 1 to 2000 characters after trimming (BR-06) |
| `result` | Required, 1 to 1000 characters after trimming (BR-06) |
| `followUpRequired` | Required boolean |
| `followUpNote` | Required, 1 to 1000 characters after trimming, when `followUpRequired` is `true`. Ignored and stored as `null` when it is `false` (BR-07) |
| `attachmentNotes` | Optional, at most 500 characters after trimming, `null` when empty (BR-06) |

Anything else in the body is ignored. In particular `performedById`, `performedBy`, `ticketId` and
`createdAt` have no effect: Performed by is the session's user and the Ticket is the one in the
path (BR-01, BR-03, AC-01).

- **`201`**: the created Action Taken, in the shape of §1. The Ticket's `updatedAt` advances
  (BR-11).
- **`200`**: the request key was already used by this user on this Ticket. The existing Action
  Taken is returned and nothing is created or changed (AC-13).
- **`400`**: `{ "error": "Validation failed", "fields": { "followUpNote": "..." } }`, one message per
  failing field. All failing fields are reported together.
- **`403`**: a Requester (AC-04).
- **`404`**: no such Ticket.
- **`409 TICKET_NOT_ACTIVE`**: the Ticket is Resolved, Closed or Cancelled.
- **`409 REQUEST_KEY_REUSED`**: the key exists on another Ticket or for another user.

Checked in that order after authentication: role, Ticket, the form of `requestKey`, key replay,
Ticket status, the remaining validation. A replay is answered before the Ticket's status and the
other fields are looked at, so a retry of a request that succeeded cannot fail.

## 3. `PATCH /api/tickets/:id/actions/:actionId`

Edit an Action Taken (FR-03).

**Request body**: the six entered fields of §2, all of them, under the same rules, plus
`"expectedVersion": 1`. The form always sends the whole Action Taken, so there is no partial
update to reason about. `requestKey` is not accepted here.

- **`200`**: the updated Action Taken. `version` is one higher, `editedBy` is the session's user
  and `editedAt` the server time. `performedBy`, `ticketId` and `createdAt` are unchanged (BR-09).
  The Ticket's `updatedAt` advances.
- **`400`**: validation as in §2, or `expectedVersion` missing or not a positive integer.
- **`403`**: a Requester.
- **`404`**: no such Ticket, or no such Action Taken on this Ticket. An id that belongs to another
  Ticket is not found here.
- **`409 TICKET_NOT_ACTIVE`**: as in §2.
- **`409 STALE_ACTION`**: `expectedVersion` is not the current version. Nothing is written, and the
  body carries the row as it now stands so the screen can show what changed:
  `{ "error": "This Action Taken was changed by someone else.", "code": "STALE_ACTION", "current": { ...§1 shape... } }`

Checked in this order after authentication and role: Ticket, Action Taken on that Ticket, the
Ticket's status, the form of `expectedVersion`, the version, the six fields. The version is judged
before the fields so that an out-of-date copy is always told so, with the current row, whatever
else is wrong with what was sent.

There is no `DELETE`. A `DELETE` to this path is answered by the application's ordinary `404`
(BR-09, AC-15).

Both writes read the Ticket row `FOR NO KEY UPDATE` inside their transaction (`specification.md` §11 says why not `FOR UPDATE`). A move to Resolved takes the
same lock (§5), so the gate never decides while an Action Taken is half written.

## 4. `GET /api/staff/tickets/:id` (changed)

The Lab 3 shape, plus three things:

```json
{ "...": "every Lab 3 field",
  "version": 4,
  "resolvedAt": null,
  "transitions": [
    { "to": "WAITING_FOR_REQUESTER", "requiresOwner": false, "blockedReason": null },
    { "to": "RESOLVED", "requiresOwner": true,
      "blockedReason": "Record an Action Taken before resolving this Ticket" },
    { "to": "CANCELLED", "requiresOwner": false, "blockedReason": null }
  ] }
```

- `version` is what the next workflow change must send back (§5).
- `resolvedAt` is set while the Ticket is Resolved or Closed (BR-18).
- `blockedReason` is `null` when the move would be accepted now, and otherwise the sentence the
  status route would refuse it with. `requiresOwner` is kept from Lab 3. The screen disables a
  blocked move and shows the reason; it does not work the gate out for itself.

The three reasons, in the order they are reported:

| Unmet | `blockedReason` and `409` message |
| :-- | :-- |
| No Ticket Owner | `A Ticket needs a Ticket Owner before it can be Resolved` (the Lab 3 wording, also used for Closed) |
| No Action Taken | `Record an Action Taken before resolving this Ticket` |
| Latest Action Taken requires follow-up | `The latest Action Taken still requires follow-up` |

The queue rows of `GET /api/staff/tickets` are unchanged.

## 5. `PATCH /api/staff/tickets/:id/status`, `/owner`, `/it-priority` (changed)

Each body gains a required `expectedVersion`:

```json
{ "currentStatus": "RESOLVED", "expectedVersion": 4 }
{ "ownerId": 9, "expectedVersion": 4 }
{ "itPriority": "URGENT", "expectedVersion": 4 }
```

- **`200`**: the updated Ticket in the §4 shape, with `version` one higher.
- **`400`**: the Lab 3 validation, or `expectedVersion` missing or not a positive integer:
  `{ "error": "Validation failed", "fields": { "expectedVersion": "..." } }`.
- **`403`** / **`404`**: as in Lab 3.
- **`409 STALE_TICKET`**: `expectedVersion` is not the Ticket's current version (BR-16) -
  `{ "error": "This Ticket was changed by someone else. Reload it and try again.", "code": "STALE_TICKET" }`.
  Nothing is written.
- **`409`** without a code: the Lab 3 refusals, unchanged in wording. A move outside the matrix, a
  move to the status the Ticket already has, an ineligible owner, or unassigning a Resolved or
  Closed Ticket.
- **`409 RESOLUTION_GATE`** (status only): the move to Resolved is in the matrix and the gate is not
  met. The message is one of the three in §4.

Order of checks: validation, Ticket exists, version, matrix, Ticket Owner, the rest of the gate.
The version comes first so that a stale screen is always told it is stale, whatever else is also
wrong.

Setting the owner or the priority the Ticket already has still writes nothing and does not raise
the version, as in Lab 3, but a stale `expectedVersion` is refused even then.

Side effects of a status change: entering Resolved sets `resolvedAt`; entering Reopened clears
`resolvedAt` and `requesterResolvedAt` (BR-18, BR-19).

Every one of these routes locks the Ticket row for the length of its transaction, so of two changes
sent from the same version exactly one succeeds (AC-26). The version also rises when an
Administrator's edit unassigns a deactivated user's Tickets (Lab 3 api-spec §16), because that is a
change of Ticket Owner like any other.

**Lock order.** Every route that locks both a Ticket and a User takes the Ticket first. The owner
route locks the Ticket and then reads the User it names `FOR SHARE`. The user-edit route (Lab 3
api-spec §16) therefore locks the live Tickets that user owns, in id order, before it locks any
User row. Taken in opposite orders the two deadlock when the owner named is the user being
deactivated, and one of the requests ends in a `500`.

`POST /api/tickets/:id/requester-resolved` is unchanged. It does not move the version, because the
Requester's indication is not a workflow field.

## 6. `GET /api/tickets` (changed)

Two additions for the Requester Dashboard's drill-downs. Everything else is as in Lab 2 and Lab 3.

| Parameter | Addition |
| :-- | :-- |
| `status` | New. One `TicketStatus` value, or `ACTIVE` for the five active statuses (BR-22). An unrecognised value is dropped, as every other filter here is |
| `sortBy` | Also accepts `updatedAt` |

`filtered` is `true` when `status` was applied.

## 7. `GET /api/staff/tickets` (changed)

`status` also accepts `ACTIVE`, meaning the five active statuses. Nothing else changes.

## 8. `GET /api/dashboard/requester`

The authenticated Requester's dashboard (FR-09). It takes no parameters: there is nothing a caller
can send that changes whose Tickets are counted (BR-23).

- **`200`**:
```json
{ "generatedAt": "2026-10-06T04:00:00.000Z",
  "timeZone": "Asia/Bangkok",
  "metrics": [
    { "key": "openTickets",   "value": 3, "query": "status=ACTIVE" },
    { "key": "waitingForYou", "value": 1, "query": "status=WAITING_FOR_REQUESTER" },
    { "key": "resolved",      "value": 1, "query": "status=RESOLVED" },
    { "key": "closed",        "value": 4, "query": "status=CLOSED" }
  ],
  "needsAttention":   [ { "id": 42, "ticketNumber": "TKT-2026-000042", "summary": "...", "currentStatus": "WAITING_FOR_REQUESTER", "updatedAt": "..." } ],
  "recentlyUpdated":  [ { "id": 42, "ticketNumber": "...", "summary": "...", "currentStatus": "...", "updatedAt": "..." } ],
  "recentlyResolved": [ { "id": 40, "ticketNumber": "...", "summary": "...", "currentStatus": "RESOLVED", "updatedAt": "...", "resolvedAt": "..." } ] }
```
  The four metrics are always present and always in this order. `query` is the query string for
  `GET /api/tickets` and for the My Tickets screen, and `value` equals the `pagination.totalItems`
  that query returns (BR-24). Calculations and list rules are in `specification.md` §5.3. Each list
  holds at most 5 rows (BR-26). A Requester with no Tickets receives four zeros and three empty
  arrays (BR-27).
- **`403`**: IT Staff or an Administrator (AC-32). Their Tickets are not "requested by" them, so the
  endpoint has nothing true to say.

## 9. `GET /api/dashboard/staff`

The IT Staff Dashboard (FR-10, FR-11). No parameters.

- **`200`**:
```json
{ "generatedAt": "2026-10-06T04:00:00.000Z",
  "timeZone": "Asia/Bangkok",
  "metrics": [
    { "key": "unassigned",     "value": 2, "query": "owner=unassigned&status=ACTIVE" },
    { "key": "myTickets",      "value": 2, "query": "owner=me&status=ACTIVE" },
    { "key": "urgent",         "value": 1, "query": "itPriority=URGENT&status=ACTIVE" },
    { "key": "myActionsToday", "value": 0, "query": null }
  ],
  "byStatus": [
    { "status": "NEW", "value": 1, "query": "status=NEW" },
    { "status": "OPEN", "value": 1, "query": "status=OPEN" }
  ],
  "recentlyUpdated": [
    { "id": 42, "ticketNumber": "...", "summary": "...", "currentStatus": "IN_PROGRESS",
      "itPriority": "URGENT", "owner": { "id": 9, "name": "Sarah Chen" }, "updatedAt": "..." }
  ],
  "myRecentActions": [
    { "id": 12, "ticketId": 42, "ticketNumber": "...", "ticketSummary": "...",
      "actionAt": "...", "descriptionPreview": "Replaced the projector lamp in LX-204.",
      "followUpRequired": true }
  ],
  "users": { "active": 9, "inactive": 2 } }
```
  - `query` is the query string for `GET /api/staff/tickets` and the Ticket Queue screen, and
    `value` equals the `pagination.totalItems` it returns. `myActionsToday` has `null`: there is no
    list of Actions Taken across Tickets to link to.
  - `byStatus` always has all eight statuses, in the declared order, zero included.
  - `owner` is `null` for an unassigned Ticket.
  - `descriptionPreview` is the first 120 characters of the Action Description.
  - `users` is present for an Administrator and absent for IT Staff (BR-29).
  - "Today" for `myActionsToday` is the Bangkok day containing `generatedAt` (BR-25): from
    17:00:00.000Z of the previous UTC day up to, not including, the next 17:00:00.000Z.
- **`403`**: a Requester (AC-32).

Neither dashboard returns a description, a comment, a note, an attachment or an email address
(BR-28). The only Action Taken text either carries is the 120-character preview above.

## 10. Safe failure and retry

- Any unexpected failure in a Lab 4 route is `500 { "error": "<what could not be done>" }`, for
  example `Unable to record the Action Taken` or `Unable to load the dashboard`.
- A client that receives no response to a create may send the same body again with the same
  `requestKey` and is guaranteed not to create a second Action Taken (§2).
- An edit, and every workflow change, is safe to retry because of its version: a repeat of a
  request that already succeeded is refused as stale, and the reloaded data shows that the change
  is already there.

## HTTP Status Summary (Lab 4 additions)

| Status | When |
| :-: | :-- |
| `200` | Read; edit; workflow change; a replayed create |
| `201` | Action Taken created |
| `400` | A field fails validation; `expectedVersion` or `requestKey` missing or malformed |
| `401` | No valid session |
| `403` | A Requester writing an Action Taken or changing workflow; the wrong role for a dashboard |
| `404` | No such Ticket or Action Taken; a Requester reading a Ticket they do not own |
| `409` | `STALE_TICKET`, `RESOLUTION_GATE`, `STALE_ACTION`, `TICKET_NOT_ACTIVE`, `REQUEST_KEY_REUSED`, and the Lab 3 refusals |
| `500` | Unexpected failure, with a safe message |
