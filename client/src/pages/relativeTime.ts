const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * "2h ago" for the queue's Last Updated column (ui-spec.md §4).
 *
 * Staff read this column to see whether a Ticket is moving, and "2h ago"
 * answers that faster than a timestamp does. Past 30 days the distance stops
 * being useful and the date takes over. `now` is a parameter so a test can
 * hold the clock still.
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  // A timestamp slightly in the future is clock skew between this machine and
  // the server, not a Ticket updated tomorrow.
  const elapsed = Math.max(0, now - then)

  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`
  if (elapsed < 30 * DAY) return `${Math.floor(elapsed / DAY)}d ago`

  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** The full timestamp, for the `title` behind a relative one. */
export function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
