import type { ReactNode } from 'react'

export interface EmptyStateProps {
  title: string
  message?: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

export function EmptyState({ title, message, action, icon, className }: EmptyStateProps) {
  const classes = ['ttk-empty-state', className ?? ''].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      {icon && (
        <div className="ttk-empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="ttk-empty-state__title">{title}</h3>
      {message && <p className="ttk-empty-state__message">{message}</p>}
      {action && <div className="ttk-empty-state__action">{action}</div>}
    </div>
  )
}
