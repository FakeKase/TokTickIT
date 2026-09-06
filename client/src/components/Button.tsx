import type { ButtonHTMLAttributes } from 'react'
import { LoadingSpinner } from './LoadingSpinner'

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual hierarchy per ui-spec.md §4. Defaults to primary. */
  variant?: ButtonVariant
  /**
   * Busy state (ui-spec.md §4): forces the primary look with an inline
   * spinner and label, and disables the control until the request settles.
   */
  busy?: boolean
  busyLabel?: string
}

export function Button({
  variant = 'primary',
  busy = false,
  busyLabel = 'Submitting…',
  type = 'button',
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = Boolean(disabled) || busy

  const classes = [
    'ttk-btn',
    `ttk-btn--${variant}`,
    busy ? 'ttk-btn--busy' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={classes} disabled={isDisabled} aria-busy={busy || undefined} {...rest}>
      {busy ? (
        <>
          <LoadingSpinner size="sm" inline />
          <span>{busyLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  )
}
