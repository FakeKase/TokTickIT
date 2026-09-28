import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { canRoleOpen, landingPathFor } from '../auth/landing'
import { useAuth } from '../auth/useAuth'
import './AuthPage.css'

/**
 * ui-spec.md §1.1.
 *
 * One failure message covers a wrong password, an unknown address and a
 * deactivated account, because the server answers all three identically
 * (BR-08). That costs a deactivated employee an explanation, and it is taken
 * anyway: the alternative hands an unauthenticated visitor a way to find out
 * which addresses are real.
 */
export function LoginPage() {
  const { user, status, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Until the session check settles, neither answer is known. Rendering the
  // form would flash it at somebody who is already signed in, every reload.
  if (status === 'checking') {
    return (
      <main className="ttk-auth">
        <LoadingSpinner label="Checking your session" />
      </main>
    )
  }

  /**
   * Where this person goes next.
   *
   * Used by both the redirect below and the submit handler, and it has to be:
   * signing in re-renders this component with a user, so the redirect fires on
   * that render and wins whatever the handler decided afterwards. Two copies of
   * this rule meant the remembered destination was computed, then immediately
   * overridden by the role's home page.
   */
  function destinationFor(signedIn: NonNullable<typeof user>) {
    if (signedIn.mustChangePassword) return '/change-password'

    const from = (location.state as { from?: string } | null)?.from
    // Only followed when this role can actually open it — see canRoleOpen.
    return from && canRoleOpen(signedIn.role, from) ? from : landingPathFor(signedIn.role)
  }

  // Already signed in — arriving here by typing the URL or pressing Back after
  // a login should not offer a second one.
  if (status === 'authenticated' && user) {
    return <Navigate to={destinationFor(user)} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const errors: Record<string, string> = {}
    if (!email.trim()) errors.email = 'Enter your email address'
    if (!password) errors.password = 'Enter your password'
    setFieldErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      const signedIn = await signIn(email, password)
      navigate(destinationFor(signedIn), { replace: true })
    } catch (error) {
      // The password field is cleared, the email is not: retyping an address
      // you got right is busywork, and the password is the part worth
      // re-entering deliberately.
      setPassword('')
      setFormError(
        error instanceof ApiError && error.status === 401
          ? 'Invalid email or password.'
          : 'Unable to sign in right now. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="ttk-auth">
      <div className="ttk-auth__card">
        <h1 className="ttk-auth__wordmark">TokTickIT</h1>
        <h2 className="ttk-auth__title">Sign in</h2>

        <form className="ttk-auth__form" onSubmit={handleSubmit} noValidate>
          {formError && (
            <p className="ttk-auth__error" role="alert">
              {formError}
            </p>
          )}

          <Field id="login-email" label="Email address" required error={fieldErrors.email}>
            {(attrs) => (
              <input
                {...attrs}
                type="email"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>

          <Field id="login-password" label="Password" required error={fieldErrors.password}>
            {(attrs) => (
              <input
                {...attrs}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>

          <Button
            type="submit"
            variant="primary"
            busy={submitting}
            busyLabel="Signing in…"
            className="ttk-auth__submit"
          >
            Sign in
          </Button>
        </form>
      </div>
    </main>
  )
}
