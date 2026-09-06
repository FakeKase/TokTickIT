import { Button } from './Button'

export interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
  retryLabel?: string
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
    </div>
  )
}
