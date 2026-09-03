import type { ReactNode } from 'react'

/**
 * Attributes a Field hands to the control it wraps. Spread these onto the
 * underlying <input>/<select>/<textarea> so the a11y wiring (aria-describedby,
 * aria-readonly, aria-invalid) and the editable/read-only/invalid CSS hooks
 * from ui-spec.md §3 stay consistent everywhere a Field is used.
 */
export interface FieldControlAttributes {
  id: string
  'aria-invalid': true | undefined
  'aria-describedby': string | undefined
  'aria-readonly': true | undefined
  disabled: true | undefined
  readOnly: true | undefined
  className: string
}

export interface FieldProps {
  id: string
  label: string
  required?: boolean
  readOnly?: boolean
  disabled?: boolean
  /** Validation message rendered directly below the control (ui-spec.md §3). */
  error?: string
  /** Optional helper text rendered above the control, also wired via aria-describedby. */
  hint?: string
  className?: string
  children: (attrs: FieldControlAttributes) => ReactNode
}

export function Field({
  id,
  label,
  required = false,
  readOnly = false,
  disabled = false,
  error,
  hint,
  className,
  children,
}: FieldProps) {
  const errorId = error ? `${id}-error` : undefined
  const hintId = hint ? `${id}-hint` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  const controlAttrs: FieldControlAttributes = {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    'aria-readonly': readOnly ? true : undefined,
    disabled: disabled ? true : undefined,
    readOnly: readOnly ? true : undefined,
    className: [
      'ttk-field__control',
      readOnly ? 'ttk-field__control--readonly' : '',
      error ? 'ttk-field__control--invalid' : '',
    ]
      .filter(Boolean)
      .join(' '),
  }

  const wrapperClasses = ['ttk-field', disabled ? 'ttk-field--disabled' : '', className ?? '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={wrapperClasses}>
      <label htmlFor={id} className="ttk-field__label">
        {label}
        {required && (
          <span className="ttk-field__required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {hint && (
        <p id={hintId} className="ttk-field__hint">
          {hint}
        </p>
      )}
      {children(controlAttrs)}
      {error && (
        <p id={errorId} className="ttk-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
