import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, postComment } from '../api'
import type { CommentVisibility, TicketComment } from '../api'
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
 * How one stream presents itself. The Requester's screen takes the defaults;
 * the staff screen renders two of these, one per visibility, each naming its
 * own audience (ui-spec.md §5).
 */
export interface CommentStream {
  /** Sent with every post from this stream. Left undefined on the Requester's
   *  screen, where the server's default of PUBLIC is the only possibility. */
  visibility?: CommentVisibility
  title: string
  /** Who reads what is posted here, said before anyone types. */
  audience: string
  empty: string
  fieldId: string
  fieldLabel: string
  submitLabel: string
  /** The surface internal notes sit on, so the two streams cannot be mistaken
   *  for one another at a glance. */
  internal?: boolean
}

const REQUESTER_STREAM: CommentStream = {
  title: 'Comments',
  audience: 'Visible to you and to IT Staff.',
  empty: 'No comments yet. Add one if you have more to tell IT Staff.',
  fieldId: 'comment-body',
  fieldLabel: 'Add a comment',
  submitLabel: 'Post comment',
}

/**
 * One stream of a Ticket's conversation (ui-spec.md §5, §6; handout §4.6).
 *
 * On the Requester's screen only public entries ever arrive: the server
 * filters by role, so there is no internal note in the list to accidentally
 * render. The audience line is said outright rather than left implied —
 * somebody about to type should know who reads it before they do.
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
  stream = REQUESTER_STREAM,
}: {
  ticketId: number
  comments: TicketComment[]
  failed: boolean
  onRetry: () => void
  onPosted: (comment: TicketComment) => void
  stream?: CommentStream
}) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (posting) return

    const trimmed = body.trim()
    if (!trimmed) {
      setError(stream.internal ? 'Enter a note' : 'Enter a comment')
      return
    }
    if (trimmed.length > MAX) {
      setError(`Must be at most ${MAX} characters`)
      return
    }

    setPosting(true)
    setError(null)
    try {
      onPosted(await postComment(ticketId, trimmed, stream.visibility))
      // Cleared only on success: a failed post that wiped what somebody typed
      // would be the worst possible response to a network blip.
      setBody('')
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.fields.body
          ? caught.fields.body
          : `Unable to post your ${stream.internal ? 'note' : 'comment'} right now. Please try again.`,
      )
    } finally {
      setPosting(false)
    }
  }

  return (
    <Card className={`ttk-thread${stream.internal ? ' ttk-thread--internal' : ''}`}>
      <div className="ttk-thread__head">
        <h2 className="ttk-thread__title">{stream.title}</h2>
        <p className="ttk-thread__note">{stream.audience}</p>
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
        <p className="ttk-thread__empty">{stream.empty}</p>
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
        <Field id={stream.fieldId} label={stream.fieldLabel} error={error ?? undefined}>
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
        {/* Said again at the button, where the decision is actually made. */}
        {stream.internal && <p className="ttk-thread__note">{stream.audience}</p>}
        <Button
          type="submit"
          variant={stream.internal ? 'secondary' : 'primary'}
          busy={posting}
          busyLabel="Posting…"
        >
          {stream.submitLabel}
        </Button>
      </form>
    </Card>
  )
}
