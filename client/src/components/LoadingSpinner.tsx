export type LoadingSpinnerSize = 'sm' | 'md' | 'lg'

export interface LoadingSpinnerProps {
  size?: LoadingSpinnerSize
  label?: string
  /** Used inside another control (e.g. a busy Button) where the label is
   * already conveyed by surrounding text and should be visually hidden but
   * still available to assistive tech. */
  inline?: boolean
  className?: string
}

export function LoadingSpinner({
  size = 'md',
  label = 'Loading…',
  inline = false,
  className,
}: LoadingSpinnerProps) {
  const classes = ['ttk-spinner-wrap', inline ? 'ttk-spinner-wrap--inline' : '', className ?? '']
    .filter(Boolean)
    .join(' ')

  return (
    <span className={classes} role="status">
      <span className={`ttk-spinner ttk-spinner--${size}`} aria-hidden="true" />
      <span className={inline ? 'ttk-visually-hidden' : 'ttk-spinner-label'}>{label}</span>
    </span>
  )
}
