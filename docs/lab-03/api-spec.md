# Lab 3 API Contract

Base path: `/api`. All responses are JSON except attachment download. Lab 2's `requesterId`
parameter is **gone**: every ownership-scoped endpoint now derives its identity from the
authenticated session (BR-03). Sending `requesterId` anyway changes nothing — the field is
ignored, and AC-03 asserts exactly that.

## Conventions

- **Errors** always return `{ "error": "<safe human-readable message>" }`, optionally with a
  `fields` map for per-field validation errors and a machine-readable `code` where the client
  must branch on the reason:
  `{ "error": "Password change required", "code": "PASSWORD_CHANGE_REQUIRED" }`.
  No stack trace, SQL, internal identifier, or hash is ever included in an error body.
- **Unauthenticated** requests to any protected endpoint return `401 { "error": "Authentication required" }`.
- **Forbidden** requests — authenticated, but the role or ownership rule denies them — return
  `403 { "error": "You do not have permission to perform this action" }`.
- **Ownership failures and missing resources are indistinguishable** for Requesters: both return
  `404` with a generic message (BR-18).
- Timestamps are ISO 8601 strings. A `User` is serialised as
  `{ id, name, email, role, isActive, mustChangePassword, createdAt }` — never with `passwordHash` (BR-07).

## Session mechanism

Chosen and justified in `specification.md` §11.

| Aspect | Decision |
| :-- | :-- |
| Credential check | `bcrypt.compare` against `User.passwordHash`, cost 10 |
| Token | 32 bytes from `crypto.randomBytes`, base64url-encoded. Only `sha256(token)` is stored, in `Session.tokenHash`; the token itself never touches the database, so a dump of that table yields nothing presentable as a cookie |
| Transport | `Set-Cookie: tt_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` (plus `Secure` when `NODE_ENV=production`) |
| Expiry | 8 hours absolute, held in `Session.expiresAt`; an expired row is deleted when encountered (BR-11) |
| Invalidation | Logout deletes the row; a new initial password deletes all of that user's rows (BR-36); a deactivated user's sessions are rejected on next use (BR-12) |
| CSRF | `SameSite=Lax` plus a JSON-only API that rejects form content types. No cross-site form post can reach a state-changing endpoint |
| Client | `fetch(..., { credentials: 'include' })`; the token is never read by JavaScript and never stored in `localStorage` |

CORS is configured with `credentials: true` and an explicit origin allowlist — a wildcard origin is
incompatible with credentialed requests, which is the intended safety net.

---

## 1. `POST /api/auth/login`

**Request body**
```json
{ "email": "peter.parker@toktickit.test", "password": "..." }
```

- **`200`**: sets the session cookie and returns
  `{ "user": { "id": 1, "name": "Peter Parker", "email": "...", "role": "REQUESTER", "isActive": true, "mustChangePassword": true, "createdAt": "..." } }`
- **`400`**: missing or malformed email/password — `{ "error": "Validation failed", "fields": { ... } }`
- **`401`**: unknown email, wrong password, or inactive account — all three return the identical body
  `{ "error": "Invalid email or password" }` (BR-08). No session is created.
- **`500`**: safe error.

## 2. `POST /api/auth/logout`

- **`204`**: session row deleted, cookie cleared. Reusing the cookie afterwards returns `401` (BR-10).
- **`204`** is also returned when no valid session is present — logout is idempotent and reveals nothing.

## 3. `GET /api/auth/me`

- **`200`**: `{ "user": { ...as above } }`. Permitted even while `mustChangePassword` is true (BR-14).
- **`401`**: no session, expired session, or the account has been deactivated (BR-12).

## 4. `POST /api/auth/change-password`

**Request body**
```json
{ "currentPassword": "...", "newPassword": "...", "confirmPassword": "..." }
```

- **`200`**: `{ "user": { ..., "mustChangePassword": false } }`, and a **new** session cookie. Every session the user held — including the one that made this call — is deleted first, so the response's cookie is the only live one afterwards.
- **`400`**: new password under 8 characters or over 72 UTF-8 bytes, not matching its confirmation, or identical to the current one (BR-13) — `{ "error": "Validation failed", "fields": { "newPassword": "..." } }`
- **`401`**: not authenticated, or `currentPassword` is wrong — `{ "error": "Current password is incorrect", "fields": { "currentPassword": "..." } }`. The status says the credential failed; the `fields` map lets the UI put the message under the right control.

---

## 5. Lab 2 Requester endpoints, now authenticated

`POST /api/tickets`, `GET /api/tickets`, `GET /api/tickets/:id`,
`POST /api/tickets/:id/attachments`, `GET /api/attachments/:id`,
`GET /api/attachments/:id/download`, `DELETE /api/attachments/:id`.

Contract as in `docs/lab-02/api-spec.md` §4–§10, with these changes:

- `requesterId` is removed from the `POST /api/tickets` body and from the `GET /api/tickets` query. Both take the Requester from the session.
- **Requester-only (five):** `POST /api/tickets`, `GET /api/tickets`, `GET /api/tickets/:id`, `POST /api/tickets/:id/attachments`, `DELETE /api/attachments/:id`. `401` unauthenticated, `403` for IT Staff or an Administrator, `404` for anything owned by another Requester (BR-18).
- **Requester or staff (two):** `GET /api/attachments/:id` and `GET /api/attachments/:id/download` serve the owning Requester for their own Ticket, and IT Staff or an Administrator for **any** Ticket (§5.1 of `specification.md`, AC-45). The role decides which rule applies: a Requester who is not the owner still gets `404`, while staff get `200`. A removed Attachment is still `404` for everyone (Lab 2 BR-26) — the staff path widens *whose* Attachments are readable, not *which*.
- `POST /api/tickets` responses gain `itPriority` (initialised from `requestedPriority`), `ownerId` (`null`), and `requesterResolvedAt` (`null`).
- `GET /api/requesters` is **removed**. Nothing outside Administrator user management lists people any more.
- `GET /api/categories` and `GET /api/related-systems` stay **unauthenticated**, as in Lab 2. They are a fixed taxonomy with no owner and no role rule, nothing about them is specific to a person, and every screen that reads them is behind a session anyway. Worth stating rather than leaving as an accident of inheritance: the rule being applied is "protect what is owned or role-restricted", and these are neither.

## 6. `GET|POST /api/tickets/:id/comments`

One endpoint family serves Public Comments and Internal Notes, filtered by role (BR-04).

**`GET`** — **`200`**:
```json
[
  { "id": 7, "ticketId": 42, "visibility": "PUBLIC",
    "body": "Could you try restarting and tell us what happens?",
    "author": { "id": 9, "name": "Sarah Chen", "role": "IT_STAFF" },
    "createdAt": "2026-09-12T04:10:00.000Z" }
]
```
- A Requester receives only `PUBLIC` entries on their own Ticket. Internal entries are filtered out
  of the collection entirely — not returned with a redacted body, and not counted anywhere in the
  response (BR-29, AC-34).
- IT Staff and Administrators receive both, ordered by `createdAt` ascending.
- **`403`**: a Requester requesting `?visibility=INTERNAL`.
- **`404`**: a Requester requesting comments on a Ticket they do not own.

**`POST`** — body `{ "body": "...", "visibility": "PUBLIC" | "INTERNAL" }`
- **`201`**: the created comment, shaped as above. `author` and `createdAt` come from the session and the server clock (BR-27).
- **`400`**: empty, whitespace-only, or longer than 2000 characters after trimming (BR-25).
- **`403`**: a Requester posting `INTERNAL`.
- **`404`**: a Requester posting on a Ticket they do not own.
- Posting does **not** advance the Ticket's `updatedAt`. Last Updated records a change to the
  Ticket itself: its owner, priority or status. The thread carries its own timestamps.
- There is deliberately **no 409 for a Resolved, Closed or Cancelled Ticket**, unlike §7. A
  comment is a sentence about a Ticket and stays useful after it closes — "this came back" is
  worth being able to say. The resolved signal is different: it asks IT Staff to act, and asking
  them to resolve something already resolved is noise, not information.

## 7. `POST /api/tickets/:id/requester-resolved`

- **`200`**: sets `requesterResolvedAt`, posts an accompanying Public Comment, and returns
  `{ id, currentStatus, requesterResolvedAt }` — the three fields this write can affect, not the
  whole Ticket. `currentStatus` is included precisely so the client can see it did **not** change
  (BR-24); the caller is looking at the Ticket already and nothing else about it moved.
- **`403`**: called by IT Staff or an Administrator — this is a Requester's signal about their own Ticket.
- **`404`**: not the authenticated Requester's Ticket.
- **`409`**: the Ticket is already Resolved, Closed, or Cancelled, **or the signal has already been
  recorded**. The signal is once per Ticket: a second one would overwrite the first timestamp and
  post a duplicate comment, and there is no endpoint to take either back. Both conditions are in
  the `WHERE` of the write rather than checked beforehand, so a second tab and a staff resolve
  landing in between are refused by the database instead of by a check made a moment earlier.
  A client that receives this must reload the Ticket rather than retry: the 409 means its copy is
  out of date, and a second attempt can only be refused the same way.

---

## 8. `GET /api/staff/tickets`

The IT Staff Ticket Queue. Requires IT Staff or Administrator.

**Query parameters** (all optional; BR-30, BR-31)

| Parameter | Values | Default |
| :-- | :-- | :-- |
| `search` | matches Ticket Number or Summary, case-insensitive partial | — |
| `status` | one `TicketStatus` value | all |
| `itPriority` | `LOW`/`MEDIUM`/`HIGH`/`URGENT` | all |
| `categoryId` | integer | all |
| `owner` | `me`, `unassigned`, or a user id | all |
| `sortBy` | `createdAt`, `updatedAt`, `ticketNumber`, `itPriority`, `currentStatus` | `updatedAt` |
| `sortDir` | `asc`, `desc` | `desc` |
| `page` | integer ≥ 1, clamped | `1` |
| `pageSize` | 1–50, clamped | `10` |

Nothing in this table can fail the request. A value that is not recognised — an unknown status, a
sort key that is not offered, an `owner` that is none of the three forms — is dropped and its
default applies, exactly as if it had not been sent (BR-30). Enum values are matched as spelled
above; `status=new` is not `NEW`.

- **Ordering.** The chosen key first, then Last Updated descending, then `id` descending
  (BR-31, AC-25). The second key is skipped when Last Updated is itself the chosen key. The
  tie-break stays descending whichever way the sort runs. `itPriority` and `currentStatus` sort in
  their declared order, not alphabetically: Low → Medium → High → Urgent, and New → Open → In
  Progress → Waiting for Requester → Resolved → Closed → Reopened → Cancelled.
- **`owner=me`** is resolved from the session, so the same URL means a different set for each
  caller.
- **A page past the end is served as the last real page**, and `pagination.page` reports the page
  that was served rather than the one requested (AC-26). A queue changes while it is being read —
  Tickets leave a filter as their status moves — so a page that existed a moment ago can stop
  existing, and answering with zero rows would be indistinguishable from an empty queue. With no
  rows at all, `page` is `1` and `totalPages` is `0`.

- **`200`**:
```json
{
  "data": [
    { "id": 42, "ticketNumber": "TKT-2026-000042", "summary": "...",
      "category": { "id": 2, "name": "Hardware" },
      "requester": { "id": 1, "name": "Peter Parker" },
      "owner": { "id": 9, "name": "Sarah Chen" },
      "requestedPriority": "MEDIUM", "itPriority": "HIGH",
      "currentStatus": "IN_PROGRESS",
      "requesterResolvedAt": null,
      "createdAt": "...", "updatedAt": "..." }
  ],
  "pagination": { "page": 1, "pageSize": 10, "totalItems": 37, "totalPages": 4 },
  "filtered": false
}
```
  `owner` is `null` for an unassigned Ticket. `requester` and `owner` carry an id and a name and
  nothing else: no email address travels with a list row.

  `filtered` is `true` when at least one narrowing parameter was **applied** — `search`, `status`,
  `itPriority`, `categoryId` or `owner` — and is what lets the client tell an empty queue from a
  search that matched nothing (AC-23). A parameter that was dropped as unrecognised does not count:
  `?status=BOGUS` narrows nothing, so an empty result under it is an empty queue. Sorting and
  paging never count.
- **`401`** / **`403`**: unauthenticated, or a Requester calling it (AC-14).

## 9. `GET /api/staff/tickets/:id`

- **`200`**: the full Ticket for IT Staff operations — every field above plus `description`, `relatedSystem`, `attachments` and `transitions`. The assignable-user list is **not** included (see §13).

  `transitions` is where this Ticket may go next: the §5.2 matrix read for its current status, as
  `[{ "to": "RESOLVED", "requiresOwner": true }, ...]`, empty for a Cancelled Ticket. It is sent
  with the Ticket so the screen offers exactly what §12 will accept without keeping a second copy
  of the matrix. `requiresOwner` marks a move that is in the matrix but also needs a Ticket Owner
  (BR-23), so the screen can disable it with a reason rather than hide it.

  `ownerRequired` is `true` while the Ticket's status is one that must keep its owner (§10), so the
  screen can disable Unassign with a reason instead of offering a request that will be refused.

  Every `PATCH` in §10 to §12 returns this same shape.
- **`403`**: a Requester. Note the deliberate difference from §5: a Requester is told "forbidden" here because the staff namespace itself is off-limits, and no per-ticket existence is revealed either way.
- **`404`**: no such Ticket.

## 10. `PATCH /api/staff/tickets/:id/owner`

Claim or reassign (BR-19, BR-20).

**Request body**: `{ "ownerId": 9 }`, or `{ "ownerId": null }` to unassign.

- **`200`**: the updated Ticket; `updatedAt` advances. Naming the owner the Ticket already has is
  also `200` but writes nothing, so `updatedAt` does not move: the queue sorts by it, and a no-op
  must not float a Ticket to the top.
- **`400`**: `ownerId` is missing, or is not a positive integer or `null`.
- **`403`**: a Requester.
- **`404`**: no such Ticket.
- **`409`**: the target user does not exist, is inactive, or is a Requester — `{ "error": "Ticket Owner must be an active IT Staff or Administrator" }` (AC-29). One message for all three, so the endpoint cannot be used to learn which ids are accounts.
- **`409`**: `ownerId` is `null` and the Ticket is Resolved or Closed — `{ "error": "A Resolved or Closed Ticket must keep its Ticket Owner" }`. BR-23 would otherwise be one unassign away from meaning nothing. Such a Ticket may still be reassigned.

The rule spans two tables: the Ticket being written and the User who must still be active staff
when it is. The check reads the User's row `FOR SHARE` inside the transaction that writes the
Ticket, so the row cannot change until that transaction ends. Deactivation (§16) updates the same
row before returning that user's Tickets to the queue, so whichever of the two runs second sees the
other's result. This holds at the default isolation level.

## 11. `PATCH /api/staff/tickets/:id/it-priority`

**Request body**: `{ "itPriority": "URGENT" }`

- **`200`**: the updated Ticket. `requestedPriority` is untouched (BR-21, AC-30), including when
  the body carries one. Setting the priority the Ticket already has writes nothing.
- **`400`**: missing, or not one of the four permitted values as spelled.
- **`403`** / **`404`**: as above.

## 12. `PATCH /api/staff/tickets/:id/status`

**Request body**: `{ "currentStatus": "RESOLVED" }`

- **`200`**: the updated Ticket.
- **`400`**: not a `TicketStatus` value.
- **`403`**: a Requester attempting any status change (BR-05, AC-21).
- **`404`**: no such Ticket.
- **`409`**: the transition is outside the §5.2 matrix, including a move to the status the Ticket
  already has — `{ "error": "Cannot move a Ticket from In Progress to Closed" }` — or Resolved or
  Closed was requested for a Ticket with no owner (BR-23). The matrix is reported first when a move
  fails both. Nothing is written.
- **`409`**: the Ticket changed between this request reading it and writing it —
  `{ "error": "This Ticket was changed by someone else. Reload it and try again." }`.

The body carries only the target. The move is judged from the status the database holds, never
from one the client believes, and the write is conditional on the row still being what was judged:
its status, and for Resolved or Closed its having an owner, are both in the `WHERE`. A colleague
moving the status or unassigning the Ticket in between therefore matches zero rows rather than
producing a state the matrix forbids.

**Reopening clears `requesterResolvedAt`.** The Requester's signal is once per Ticket (§7), so
without this a reopened Ticket could never be signalled again. The first signal is not lost: the
Public Comment posted with it stays in the thread.

A client that receives either `409` should reload the Ticket, since both mean its copy is out of
date.

## 13. `GET /api/staff/assignable-users`

The list the reassign control offers: active IT Staff and Administrators only.

- **`200`**: `[{ "id": 9, "name": "Sarah Chen", "role": "IT_STAFF" }, ...]`, ordered by name.
- **`403`**: a Requester.

Kept separate from §9 so that opening a Ticket does not implicitly enumerate staff, and so the
control can refresh its options without refetching the Ticket.

---

## 14. `GET /api/users`

Administrator only (BR-16).

**Query parameters**: `search` (name or email, case-insensitive partial), `role`
(`REQUESTER`/`IT_STAFF`/`ADMINISTRATOR`). Unpaginated by design (BR-38).

- **`200`**: `[{ id, name, email, role, isActive, mustChangePassword, createdAt, isLastActiveAdministrator }, ...]`, ordered by name. Inactive users are included: deactivated is not deleted.
- **`403`**: any non-Administrator, IT Staff included (AC-14).

An unrecognised `role` is ignored, as other list filters are.

`isLastActiveAdministrator` is `true` for the one account §16 will refuse to deactivate or demote.
It is counted over every user, not over the filtered list, and is there so the screen can disable
those controls with a reason. It is a courtesy; §16 is what enforces the rule.

## 15. `POST /api/users`

**Request body**
```json
{ "name": "Jane Doe", "email": "jane.doe@toktickit.test",
  "role": "IT_STAFF", "isActive": true, "initialPassword": "..." }
```

- **`201`**: the created user, with `mustChangePassword: true` (AC-37) whatever the body says
  about that flag. `isActive` defaults to `true`, and must be a boolean if sent. The email is
  trimmed and stored lower-cased (BR-06), so it is found by the login that looks it up.
- **`400`**: name outside 2–80 characters, invalid or over-long email, unrecognised role, or an initial password shorter than 8 characters or longer than 72 UTF-8 bytes (BR-13, BR-37).
- **`403`**: non-Administrator.
- **`409`**: the email address is already held, compared case-insensitively — `{ "error": "That email address is already in use" }` (BR-34).

All invalid fields are reported together in `fields`, the initial password among them. The
password is never echoed back, in a success or a failure.

## 16. `PATCH /api/users/:id`

**Request body**: any subset of `{ "name", "email", "role", "isActive" }`.

- **`200`**: the updated user. An empty body, or one that changes nothing, is also `200`.
- **`400`**: validation, as above, for any field that is sent. `passwordHash`, `initialPassword`
  and `mustChangePassword` are not editable here and are ignored.
- **`403`**: non-Administrator.
- **`404`**: no such user.
- **`409`**: duplicate email (BR-34); deactivating your own account (BR-32, AC-39); deactivating or
  changing the role of the last active Administrator (BR-33, AC-40) —
  `{ "error": "The system must keep at least one active Administrator" }`.

A refused edit writes nothing: when one field of several is refused, none of them is applied.

Who is acting is taken from the session, so self-deactivation cannot be dodged or misattributed
through the body. When both rules apply, the self-deactivation message is the one returned.

Deactivating a user also deletes their sessions, so access ends immediately rather than at expiry.
Reactivating does not bring them back. A role change takes effect on the user's next request.

**A user who can no longer own Tickets hands back the live ones.** When an edit leaves a user
inactive, or a Requester, every Ticket they own whose status is New, Open, In Progress, Waiting for
Requester or Reopened becomes unassigned. Tickets they own that are Resolved, Closed or Cancelled
keep them as owner: those must keep an owner (§10), and it is the record of who finished the work.

**Concurrency.** The edit locks the user's row and every active Administrator's row, in id order,
in one statement, before it decides anything. That makes the last-Administrator count a count of
rows that cannot change underneath it, so two Administrators demoting each other at the same moment
leave one. It also pairs with the owner check in §10: an assignment and a deactivation of the same
user are ordered by that lock, and whichever runs second sees the other.

The lock is `FOR NO KEY UPDATE`, not `FOR UPDATE`. Postgres checks a foreign key by taking
`FOR KEY SHARE` on the referenced row, and `FOR UPDATE` blocks that: a comment, Ticket or session
written for any locked user would wait for the edit to finish. The weaker lock still conflicts with
itself and with §10's `FOR SHARE`, so both guarantees hold, and unrelated writes go through.

## 17. `POST /api/users/:id/initial-password`

**Request body**: `{ "initialPassword": "..." }`

- **`200`**: `{ "user": { ..., "mustChangePassword": true } }`. All of that user's sessions are deleted (BR-36, AC-41).
- **`400`**: password shorter than 8 characters or longer than 72 UTF-8 bytes (BR-13).
- **`403`**: non-Administrator.
- **`404`**: no such user.

There is no `DELETE /api/users/:id`. Users are deactivated, never deleted (BR-35).

---

## HTTP Status Summary

| Status | Meaning here |
| --- | --- |
| `200` | Successful retrieval or update |
| `201` | Ticket, comment, note, or user created |
| `204` | Logout |
| `400` | Invalid or missing input (query or body) |
| `401` | No session, expired session, deactivated account, or failed login |
| `403` | Authenticated but not permitted: wrong role, or a password change is outstanding (`PASSWORD_CHANGE_REQUIRED`) |
| `404` | Resource missing, or not owned by the authenticated Requester |
| `409` | Business-rule conflict: duplicate email, invalid status transition, ineligible owner, last active Administrator, self-deactivation |
| `413` | Attachment exceeds 5 MB (unchanged from Lab 2) |
| `415` | Attachment type not permitted (unchanged from Lab 2) |
| `500` | Safe unexpected server error — generic message only |
