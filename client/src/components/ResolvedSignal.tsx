import { useState } from 'react'
import { markProblemResolved } from '../api'
import type { ResolvedSignal as Signal } from '../api'
import { Button } from './Button'
import { Card } from './Card'
import './ResolvedSignal.css'

/** Statuses where the question no longer applies (BR-24, api-spec.md §7). */
const SETTLED = ['RESOLVED', 'CLOSED', 'CANCELLED']

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * "Problem appears resolved" (FR-12, BR-05, BR-24).
 *
 * Deliberately not a status control. The Requester is telling IT Staff what
 * they see; IT Staff decide whether the Ticket is Resolved. The copy says so,
 * because a button a person believes closes their Ticket - when it does not -
 * is worse than no button.
 *
 * Confirmed before sending, since the signal is append-only: there is no
 * endpoint to take it back.
 */
export function ResolvedSignal({
  ticketId,
  currentStatus,
  resolvedAt,
  onSignalled,
}: {
  ticketId: number
  currentStatus: string
  resolvedAt: string | null
  onSignalled: (signal: Signal) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (resolvedAt) {
    return (
      <Card className="ttk-resolved ttk-resolved--done">
        <p className="ttk-resolved__done" role="status">
          You reported that this problem appears resolved on {formatWhen(resolvedAt)}. IT Staff
          will confirm and close the Ticket.
        </p>
      </Card>
    )
  }

  // Nothing to signal about a Ticket that is already finished. Rendering a
  // disabled button here would invite the question instead of answering it.
  if (SETTLED.includes(currentStatus)) return null

  async function send() {
    if (sending) return
    setSending(true)
    setError(null)

    try {
      // The server posts a comment alongside the signal, so the page reloads
      // the thread rather than this component guessing at the new entry. The
      // wording belongs to the server, and picking "the last one" would drop
      // anything else that arrived in the meantime.
      onSignalled(await markProblemResolved(ticketId))
    } catch {
      setError('Unable to record that right now. Please try again.')
      setConfirming(false)
    } finally {
      setSending(false)
    }
  }

  return (
    <Card className="ttk-resolved">
      {error && (
        <p className="ttk-resolved__error" role="alert">
          {error}
        </p>
      )}

      {confirming ? (
        <>
          <p className="ttk-resolved__prompt">
            This tells IT Staff the issue looks fixed from your side. They will confirm and close
            the Ticket — it does not close it now.
          </p>
          <div className="ttk-resolved__actions">
            <Button busy={sending} busyLabel="Sending…" onClick={() => void send()}>
              Yes, it appears resolved
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={sending}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <div className="ttk-resolved__actions">
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Problem appears resolved
          </Button>
        </div>
      )}
    </Card>
  )
}
