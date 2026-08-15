import { useState } from 'react'
import { fetchHealth, fetchCategories, Category } from './api'

type CheckState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'online'; service: string; categories: Category[] }
  | { phase: 'offline'; message: string }

function App() {
  const [check, setCheck] = useState<CheckState>({ phase: 'idle' })

  async function handleCheckSystem() {
    setCheck({ phase: 'loading' })

    try {
      await fetchHealth()
      const categories = await fetchCategories()
      setCheck({ phase: 'online', service: 'TokTickIT API', categories })
    } catch {
      setCheck({
        phase: 'offline',
        message: 'Unable to connect to TokTickIT API',
      })
    }
  }

  return (
    <div className="min-vh-100 bg-light d-flex flex-column">
      <nav className="navbar navbar-dark bg-success shadow-sm">
        <div className="container">
          <span className="navbar-brand mb-0 h5">TokTickIT</span>
        </div>
      </nav>

      <main className="flex-grow-1 py-5">
        <div className="container">
          <div className="mb-5">
            <h1 className="h3 mb-1">IT Service Desk</h1>
            <p className="text-muted small mb-4">
              Submit a request by selecting your issue category
            </p>

            <div className="d-flex gap-2 align-items-center">
              <button
                type="button"
                className="btn btn-sm btn-success"
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

              {check.phase === 'online' && (
                <span className="badge bg-success small">Online</span>
              )}
              {check.phase === 'offline' && (
                <span className="badge bg-danger small">Offline</span>
              )}
            </div>
          </div>

          {check.phase === 'offline' && (
            <div className="alert alert-danger small mb-0" role="alert">
              {check.message}
            </div>
          )}

          {check.phase === 'online' && (
            <div className="row g-3">
              {check.categories.map((category) => (
                <div key={category.id} className="col-md-6 col-lg-3">
                  <div className="card h-100 border-0 bg-white shadow-sm">
                    <div className="card-body d-flex flex-column">
                      <h6 className="card-title fw-600 mb-2 text-success">
                        {category.name}
                      </h6>
                      <p className="card-text small text-muted flex-grow-1 mb-3">
                        {category.description}
                      </p>
                      <button className="btn btn-sm btn-outline-success">
                        Submit
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {check.phase === 'loading' && (
            <div className="text-center text-muted py-5">
              <div className="spinner-border spinner-border-sm mb-3" role="status">
                <span className="visually-hidden">Loading…</span>
              </div>
              <p className="small">Loading categories…</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
