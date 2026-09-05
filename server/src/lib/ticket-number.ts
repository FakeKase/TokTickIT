// BR-01: the official Ticket Number is `TKT-{creation year}-{6-digit
// zero-padded internal id}`. Uniqueness follows from the id's uniqueness
// rather than from a separately tracked counter, so two Tickets created at
// the same instant can never collide.

export function formatTicketNumber(id: number, year: number): string {
  return `TKT-${year}-${String(id).padStart(6, "0")}`;
}

// Ticket Number is derived from the row's own id, which does not exist until
// the row is inserted, and the column is NOT NULL + unique. The row is
// therefore created with a placeholder and updated in the same transaction.
// The placeholder must be unique too, hence the caller-supplied token.
export function placeholderTicketNumber(token: string): string {
  return `PENDING-${token}`;
}
