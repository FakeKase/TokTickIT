import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import './Dialog.css'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A modal dialog (ui-spec.md §7, §9): labelled by its heading, focus held
 * inside while it is open, `Esc` to dismiss, and focus returned to whatever
 * opened it when it closes.
 *
 * Built by hand rather than on `<dialog>.showModal()`, which the test
 * environment does not implement; the behaviour asked for is small enough to
 * state directly and test as written.
 */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  // Kept in a ref so the effect below runs once per opening, not every time
  // the parent hands down a new function.
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel.current)?.focus()

    // Listened for on the document, not on the panel. Focus does not always
    // stay inside: a button that is disabled while it saves loses focus to
    // the page body, and a key pressed then never reaches the panel. A dialog
    // that stops answering Esc at exactly the moment something went wrong is
    // the worst time for it to.
    function handleKeyDown(event: KeyboardEvent) {
      if (!panel.current) return

      if (event.key === 'Escape') {
        event.stopPropagation()
        close.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const firstControl = focusable[0]
      const lastControl = focusable[focusable.length - 1]
      const active = document.activeElement
      const outside = !panel.current.contains(active)

      // Wraps at both ends, and pulls focus back in if it has strayed, so
      // Tab never reaches the page behind the dialog.
      if (event.shiftKey && (active === firstControl || outside)) {
        event.preventDefault()
        lastControl.focus()
      } else if (!event.shiftKey && (active === lastControl || outside)) {
        event.preventDefault()
        firstControl.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      // Back to the control that opened the dialog, so a keyboard user is not
      // dropped at the top of the page.
      opener?.focus?.()
    }
  }, [])

  return (
    <div className="ttk-dialog__backdrop">
      <div
        ref={panel}
        className="ttk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId} className="ttk-dialog__title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}
