# Lab 2 API Contract

Base path: `/api`. All responses are JSON except attachment download. All ownership-scoped
endpoints require a `requesterId` (see `specification.md` §11 — this is Lab 2 testing
scaffolding, not authentication, per BR-03/BR-29).

## Conventions

- **Errors** always return `{ "error": "<safe human-readable message>" }`, optionally with a
  `fields` map for per-field validation errors: `{ "error": "Validation failed", "fields": { "summary": "Must be 5-120 characters" } }`.
  No stack traces or internal identifiers are ever included in an error body.
- **Ownership failures and missing resources are indistinguishable** — both return `404` with
  a generic `"Ticket not found"` / `"Attachment not found"` message (BR-08).
- Timestamps are ISO 8601 strings.

## 1. `GET /api/requesters`

Retrieve active Development Requesters for the Selector screen.

- **Response `200`**: `[{ "id": 1, "name": "Jennifer Anderson", "email": "jennifer.anderson@example.com" }, ...]`, ordered by `name` asc, `isActive = true` only (BR-04).
- **`500`**: `{ "error": "Unable to load Development Requesters" }`

## 2. `GET /api/categories`

- **Response `200`**: `[{ "id": 1, "name": "Hardware", "description": "..." }, ...]`, ordered by `name` asc.
- **`500`**: safe error.

## 3. `GET /api/related-systems`

- **Response `200`**: `[{ "id": 1, "name": "Corporate Laptop" }, ...]`, ordered by `name` asc.
- **`500`**: safe error.

## 4. `POST /api/tickets`

Create one Ticket for the selected Requester.

**Request body**
```json
{
  "requesterId": 1,
  "categoryId": 2,
  "relatedSystemId": 3,
  "summary": "Laptop battery drains quickly",
  "description": "My laptop battery is draining much faster than usual...",
  "requestedPriority": "MEDIUM"
}
```

- **`201`**:
```json
{
  "id": 42,
  "ticketNumber": "TKT-2026-000042",
  "requesterId": 1,
  "categoryId": 2,
  "relatedSystemId": 3,
  "summary": "Laptop battery drains quickly",
  "description": "...",
  "requestedPriority": "MEDIUM",
  "currentStatus": "NEW",
  "createdAt": "2026-08-30T09:14:00.000Z"
}
```
- **`400`**: any of BR-13/BR-14/BR-15 fails — `{ "error": "Validation failed", "fields": { ... } }`.
- **`404`**: `requesterId` does not exist, is inactive, `categoryId`, or `relatedSystemId` does not exist — `{ "error": "Selected Requester is no longer active" }` (or category/related-system equivalent).
- **`500`**: safe error; no Ticket is persisted (BR-18).

## 5. `GET /api/tickets`

List the selected Requester's own Tickets (BR-06/BR-07/BR-09..12).

**Query parameters**

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `requesterId` | int, required | — | missing/non-numeric → `400` |
| `search` | string | — | matches `ticketNumber` or `summary`, case-insensitive contains |
| `categoryId` | int | — | filter |
| `requestedPriority` | `LOW\|MEDIUM\|HIGH` | — | filter |
| `status` | ticket status enum | — | filter |
| `sortBy` | `createdAt\|ticketNumber\|requestedPriority\|currentStatus` | `createdAt` | invalid value falls back to default |
| `sortDir` | `asc\|desc` | `desc` | invalid value falls back to default |
| `page` | int | `1` | clamped to ≥1 (BR-12) |
| `pageSize` | int | `10` | clamped to `1..50` (BR-12) |

- **Response `200`**:
```json
{
  "data": [
    {
      "id": 42,
      "ticketNumber": "TKT-2026-000042",
      "summary": "Laptop battery drains quickly",
      "categoryName": "Hardware",
      "requestedPriority": "MEDIUM",
      "currentStatus": "NEW",
      "createdAt": "2026-08-30T09:14:00.000Z",
      "updatedAt": "2026-08-30T09:14:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 10, "totalItems": 1, "totalPages": 1 }
}
```
Empty `data` with `totalItems: 0` covers both the Empty and No-Results UI states (BR-28) —
the client distinguishes them by whether any search/filter query param was supplied.
- **`400`**: missing/invalid `requesterId`.
- **`500`**: safe error.

## 6. `GET /api/tickets/:id`

Retrieve one owned Ticket in full, for Ticket Detail.

**Query**: `requesterId` (required).

- **Response `200`**:
```json
{
  "id": 42,
  "ticketNumber": "TKT-2026-000042",
  "requester": { "id": 1, "name": "Jennifer Anderson" },
  "category": { "id": 2, "name": "Hardware" },
  "relatedSystem": { "id": 3, "name": "Corporate Laptop" },
  "summary": "Laptop battery drains quickly",
  "description": "...",
  "requestedPriority": "MEDIUM",
  "currentStatus": "NEW",
  "createdAt": "2026-08-30T09:14:00.000Z",
  "updatedAt": "2026-08-30T09:14:00.000Z",
  "attachments": [
    { "id": 7, "originalFilename": "screenshot.png", "mimeType": "image/png", "sizeBytes": 245678, "isRemoved": false, "removedAt": null, "removedReason": null, "createdAt": "..." }
  ]
}
```
- **`400`**: missing/invalid `requesterId`.
- **`404`**: Ticket does not exist, or `requesterId` does not own it (AC-03/BR-08).

## 7. `POST /api/tickets/:id/attachments`

Upload one Attachment to an owned Ticket. `multipart/form-data`.

**Fields**: `requesterId` (text field), `file` (binary, one of JPG/JPEG/PNG/WEBP/PDF, ≤5 MB).

- **`201`**:
```json
{ "id": 8, "ticketId": 42, "originalFilename": "invoice.pdf", "mimeType": "application/pdf", "sizeBytes": 102400, "isRemoved": false, "createdAt": "2026-08-30T09:20:00.000Z" }
```
- **`400`**: missing `requesterId` or `file`.
- **`404`**: Ticket does not exist / not owned by `requesterId`.
- **`409`**: Ticket already has 5 active Attachments (BR-21) — `{ "error": "This Ticket already has the maximum of 5 attachments" }`.
- **`413`**: file exceeds 5 MB (BR-20).
- **`415`**: MIME type not in the allowed set (BR-19).
- **`500`**: safe error; per BR-22 the Ticket itself is unaffected.

## 8. `GET /api/attachments/:id`

Retrieve one Attachment's metadata (active or removed).

**Query**: `requesterId` (required).

- **`200`**: same shape as an item in `tickets/:id`'s `attachments` array.
- **`400`**: missing `requesterId`.
- **`404`**: not found / not owned.

## 9. `GET /api/attachments/:id/download`

Download an active Attachment's file bytes.

**Query**: `requesterId` (required).

- **`200`**: file stream, `Content-Type` from stored `mimeType`, `Content-Disposition: attachment; filename="<originalFilename>"`.
- **`400`**: missing `requesterId`.
- **`404`**: not found, not owned, **or removed** (BR-26 — identical response so removal state isn't leaked to a non-owner probing the URL).

## 10. `DELETE /api/attachments/:id`

Soft-remove an owned, currently-active Attachment.

**Request body**: `{ "requesterId": 1, "reason": "Wrong screenshot, replaced by a clearer one" }`

- **`200`**: updated metadata with `isRemoved: true`, `removedAt`, `removedReason`.
- **`400`**: missing `requesterId`, or `reason` shorter than 3 characters (BR-25).
- **`404`**: not found / not owned.
- **`409`**: Attachment already removed (BR-23 — the owner already knows it exists, so this reveals no new information, unlike the ownership `404`s above).

## HTTP Status Summary

| Status | Meaning here |
| --- | --- |
| `200` | Successful retrieval, download, or removal |
| `201` | Ticket or Attachment created |
| `400` | Invalid/missing input (query or body) |
| `404` | Resource missing, not owned, or (for downloads) removed |
| `409` | Business-rule conflict: attachment cap reached, or already-removed attachment |
| `413` | Attachment exceeds 5 MB |
| `415` | Attachment type not permitted |
| `500` | Safe unexpected server error — generic message only |
