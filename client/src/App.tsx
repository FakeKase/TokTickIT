import { useState } from 'react'
import { fetchHealth } from './api'

type CheckState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'online'; service: string }
  | { phase: 'offline'; message: string }

function App() {
  const [check, setCheck] = useState<CheckState>({ phase: 'idle' })

  async function handleCheckSystem() {
    setCheck({ phase: 'loading' })

    try {
      const health = await fetchHealth()
      setCheck({ phase: 'online', service: health.service })
    } catch {
      // Network errors and non-2xx responses both mean the same thing to the
      // user, so they share one message rather than leaking the raw error.
      setCheck({
        phase: 'offline',
        message: 'Unable to connect to TokTickIT API',
      })
    }
  }

  return (
    <div className="min-vh-100 bg-body-tertiary">
      <nav className="navbar navbar-dark bg-success shadow-sm">
        <div className="container">
          <span className="navbar-brand mb-0 h1">TokTickIT</span>
        </div>
      </nav>

      <main className="container py-5">
        <h1 className="h3 mb-1">TokTickIT IT Service Desk</h1>
        <p className="text-body-secondary mb-4">
          Check that the service is reachable before submitting a request.
        </p>

        <div className="card shadow-sm">
          <div className="card-body p-4">
            <button
              type="button"
              className="btn btn-success px-4"
              onClick={handleCheckSystem}
              disabled={check.phase === 'loading'}
            >
              {check.phase === 'loading' ? (
                <>
                  <span
                    className="spinner-border spinner-border-sm me-2"
                    aria-hidden="true"
                  />
                  Checking…
                </>
              ) : (
                'Check System'
              )}
            </button>

            <div className="mt-4" aria-live="polite">
              {check.phase === 'loading' && (
                <p className="text-body-secondary mb-0">Loading…</p>
              )}

              {check.phase === 'online' && (
                <p className="mb-0">
                  <span className="me-2">System Status:</span>
                  <span className="badge text-bg-success">Online</span>
                </p>
              )}

              {check.phase === 'offline' && (
                <>
                  <p className="mb-2">
                    <span className="me-2">System Status:</span>
                    <span className="badge text-bg-danger">Offline</span>
                  </p>
                  <div className="alert alert-danger mb-0" role="alert">
                    {check.message}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
