import type { ReactNode } from 'react'

/**
 * Tone maps to the Zen Green badge color rules (ui-spec.md §7):
 * - pale: pale-green background, secondary-green text (Low priority, New status)
 * - warning: amber tint (Medium priority)
 * - danger: error-red tint (High priority)
 * - neutral: fallback for anything not yet covered by the spec
 *
 * Lab 3 (ui-spec.md §3) adds:
 * - active: secondary-green tint (In Progress)
 * - urgent: solid red, white text (Urgent IT Priority) — the only filled badge
 */
export type BadgeTone = 'neutral' | 'pale' | 'warning' | 'danger' | 'active' | 'urgent'

export interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
  className?: string
}

export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  const classes = ['ttk-badge', `ttk-badge--${tone}`, className ?? ''].filter(Boolean).join(' ')

  // Badges never rely on color alone — the text label is always rendered (ui-spec.md §7).
  return <span className={classes}>{children}</span>
}
