import { Link } from 'react-router-dom'
import { Button } from './Button'

export interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
  retryLabel?: string
  /** A way onward when retrying is not the answer — a Forbidden state, where
   *  the same request will fail the same way however many times it is sent. */
  actionTo?: string
  actionLabel?: string
  className?: string
}

/**
 * Matches the accessible error-banner pattern already established by Lab 1's
 * offline banner (role="alert", announced immediately) per ui-spec.md §9.
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Retry',
  actionTo,
  actionLabel = 'Go back',
  className,
}: ErrorStateProps) {
  const classes = ['ttk-error-state', className ?? ''].filter(Boolean).join(' ')

  return (
    <div className={classes} role="alert">
      <strong className="ttk-error-state__title">{title}</strong>
      <p className="ttk-error-state__message">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
      {actionTo && (
        <Link className="ttk-btn ttk-btn--secondary" to={actionTo}>
          {actionLabel}
        </Link>
      )}
    </div>
  )
}
