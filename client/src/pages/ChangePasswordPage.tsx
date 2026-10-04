import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ApiError, changePassword } from '../api'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { landingPathFor } from '../auth/landing'
import { useAuth } from '../auth/useAuth'
import './AuthPage.css'

const MIN_LENGTH = 8

/**
 * ui-spec.md §1.2. Mandatory for anyone holding an initial password (BR-02),
 * and reachable voluntarily by anyone else.
 *
 * There is no Cancel: the whole point is that the application stays closed
 * until this is done. Sign out stays available, because trapping somebody on a
 * screen with no way off is worse than letting them leave.
 */
export function ChangePasswordPage() {
  const { user, status, signOut, refresh } = useAuth()
  const navigate = useNavigate()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Rendering the form before the session is known would show it to somebody
  // who is not signed in, and rendering nothing leaves a blank page.
  if (status === 'checking') {
    return (
      <main className="ttk-auth">
        <LoadingSpinner label="Checking your session" />
      </main>
    )
  }
  if (!user) return <Navigate to="/login" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    // Checked here as well as on the server (BR-13). The server is the rule;
    // this is the part that answers before a round trip.
    const errors: Record<string, string> = {}
    if (!currentPassword) errors.currentPassword = 'Enter your current password'
    if (!newPassword) {
      errors.newPassword = 'Enter a new password'
    } else if (newPassword.length < MIN_LENGTH) {
      errors.newPassword = `Must be at least ${MIN_LENGTH} characters`
    } else if (newPassword === currentPassword) {
      errors.newPassword = 'Choose a password different from your current one'
    }
    if (!confirmPassword) {
      errors.confirmPassword = 'Re-enter the new password'
    } else if (newPassword && confirmPassword !== newPassword) {
      errors.confirmPassword = 'This does not match the new password'
    }

    setFieldErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      const updated = await changePassword({ currentPassword, newPassword, confirmPassword })
      // Re-read rather than trusting the response body, even though it carries
      // the updated user. The server rotated the session as part of this call,
      // so `me` is also the confirmation that the cookie the browser now holds
      // is the working one — if the rotation went wrong, this is where it
      // surfaces, instead of on whatever the user clicked next.
      await refresh()
      navigate(landingPathFor(updated.role), { replace: true })
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fields).length > 0) {
        // Field-level messages land on the control that caused them: a
        // confirmation mismatch belongs on the confirmation, not on the
        // password the user probably typed correctly (ui-spec.md §1.2).
        setFieldErrors(error.fields)
      } else if (error instanceof ApiError && error.status === 401) {
        // A wrong current password comes back as a 401 *with* fields, and is
        // handled above. A 401 without them means the session itself is gone —
        // expired, or revoked elsewhere. Blaming the password the user just
        // typed correctly would be a lie, and leaving them on this form gives
        // them nothing that can succeed.
        await signOut()
        navigate('/login', { replace: true })
        return
      } else {
        setFormError('Unable to change your password right now. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="ttk-auth">
      <div className="ttk-auth__card">
        <h1 className="ttk-auth__wordmark">TokTickIT</h1>
        <h2 className="ttk-auth__title">Choose a new password</h2>

        {user.mustChangePassword && (
          <p className="ttk-auth__lede">
            Your account was created with a temporary password. Choose a new one to continue.
          </p>
        )}

        <form className="ttk-auth__form" onSubmit={handleSubmit} noValidate>
          {formError && (
            <p className="ttk-auth__error" role="alert">
              {formError}
            </p>
          )}

          <Field
            id="current-password"
            label="Current password"
            required
            error={fieldErrors.currentPassword}
          >
            {(attrs) => (
              <input
                {...attrs}
                type="password"
                autoComplete="current-password"
                autoFocus
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            )}
          </Field>

          <Field
            id="new-password"
            label="New password"
            required
            hint={`At least ${MIN_LENGTH} characters, and different from your current password.`}
            error={fieldErrors.newPassword}
          >
            {(attrs) => (
              <input
                {...attrs}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            )}
          </Field>

          <Field
            id="confirm-password"
            label="Confirm new password"
            required
            error={fieldErrors.confirmPassword}
          >
            {(attrs) => (
              <input
                {...attrs}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            )}
          </Field>

          <Button
            type="submit"
            variant="primary"
            busy={submitting}
            busyLabel="Saving…"
            className="ttk-auth__submit"
          >
            Save and continue
          </Button>
        </form>

        <Button
          variant="tertiary"
          className="ttk-auth__signout"
          onClick={() => {
            void signOut().then(() => navigate('/login', { replace: true }))
          }}
        >
          Sign out instead
        </Button>
      </div>
    </main>
  )
}
