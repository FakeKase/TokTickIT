import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, postComment } from '../api'
import type { TicketComment } from '../api'
import { Button } from './Button'
import { Card } from './Card'
import { ErrorState } from './ErrorState'
import { Field } from './Field'
import './CommentThread.css'

const MAX = 2000

const ROLE_LABEL: Record<string, string> = {
  REQUESTER: 'Requester',
  IT_STAFF: 'IT Staff',
  ADMINISTRATOR: 'Administrator',
}

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

/**
 * Public Comments on a Ticket (ui-spec.md §6, handout §4.6).
 *
 * Only public entries ever arrive here: the server filters by role, so there
 * is no internal note in this list to accidentally render. The heading says
 * "visible to IT Staff" rather than leaving it implied — somebody about to
 * type should know who reads it before they do.
 *
 * Append-only, matching BR-26: no edit, no delete, and no control hinting at
 * either.
 */
export function CommentThread({
  ticketId,
  comments,
  failed,
  onRetry,
  onPosted,
}: {
  ticketId: number
  comments: TicketComment[]
  failed: boolean
  onRetry: () => void
  onPosted: (comment: TicketComment) => void
}) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (posting) return

    const trimmed = body.trim()
    if (!trimmed) {
      setError('Enter a comment')
      return
    }
    if (trimmed.length > MAX) {
      setError(`Must be at most ${MAX} characters`)
      return
    }

    setPosting(true)
    setError(null)
    try {
      onPosted(await postComment(ticketId, trimmed))
      // Cleared only on success: a failed post that wiped what somebody typed
      // would be the worst possible response to a network blip.
      setBody('')
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.fields.body
          ? caught.fields.body
          : 'Unable to post your comment right now. Please try again.',
      )
    } finally {
      setPosting(false)
    }
  }

  return (
    <Card className="ttk-thread">
      <div className="ttk-thread__head">
        <h2 className="ttk-thread__title">Comments</h2>
        <p className="ttk-thread__note">Visible to you and to IT Staff.</p>
      </div>

      {failed ? (
        // The thread could not load, but the Ticket above it did. Saying so
        // here keeps the failure where it happened instead of replacing the
        // whole screen.
        <ErrorState
          title="Comments could not be loaded"
          message="The rest of this Ticket is up to date."
          onRetry={onRetry}
        />
      ) : comments.length === 0 ? (
        <p className="ttk-thread__empty">
          No comments yet. Add one if you have more to tell IT Staff.
        </p>
      ) : (
        <ol className="ttk-thread__list">
          {comments.map((comment) => (
            <li key={comment.id} className="ttk-thread__item">
              <div className="ttk-thread__meta">
                <span className="ttk-thread__author">{comment.author.name}</span>
                <span className="ttk-thread__role">
                  {ROLE_LABEL[comment.author.role] ?? comment.author.role}
                </span>
                <time className="ttk-thread__when" dateTime={comment.createdAt}>
                  {formatWhen(comment.createdAt)}
                </time>
              </div>
              <p className="ttk-thread__body">{comment.body}</p>
            </li>
          ))}
        </ol>
      )}

      <form className="ttk-thread__form" onSubmit={handleSubmit} noValidate>
        <Field id="comment-body" label="Add a comment" error={error ?? undefined}>
          {(attrs) => (
            <textarea
              {...attrs}
              rows={3}
              maxLength={MAX}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" busy={posting} busyLabel="Posting…">
          Post comment
        </Button>
      </form>
    </Card>
  )
}
