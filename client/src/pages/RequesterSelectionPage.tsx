import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { fetchRequesters } from '../api'
import type { Requester } from '../api'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Field } from '../components/Field'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useSelectedRequester } from '../requester/useSelectedRequester'
import './RequesterSelectionPage.css'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; requesters: Requester[] }
  | { status: 'failed' }

const SELECT_ID = 'development-requester'

/**
 * Development Requester Selection (ui-spec.md §6.1, handout §8.1).
 *
 * Deliberately not a login screen: no password, no session, no roles. It only
 * picks which seeded Requester the rest of Lab 2 acts as (BR-03/BR-29).
 */
export function RequesterSelectionPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [chosenId, setChosenId] = useState('')
  const { requester, selectRequester } = useSelectedRequester()
  const navigate = useNavigate()
  const location = useLocation()

  // Where to go after Continue: back to the page the guard interrupted
  // (AC-02), or My Tickets when the user came here on purpose.
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/tickets'

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const requesters = await fetchRequesters()
      setState({ status: 'ready', requesters })
    } catch {
      // AC-24: a safe failure state, never the underlying error.
      setState({ status: 'failed' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Pre-select whoever is already active so "Change Requester" opens showing
  // the current choice rather than an empty dropdown.
  useEffect(() => {
    if (state.status !== 'ready' || !requester) return
    if (state.requesters.some((r) => r.id === requester.id)) {
      setChosenId(String(requester.id))
    }
  }, [state, requester])

  function handleContinue() {
    if (state.status !== 'ready') return
    const chosen = state.requesters.find((r) => String(r.id) === chosenId)
    if (!chosen) return

    // BR-05: this replaces any previous selection outright.
    selectRequester(chosen)
    navigate(redirectTo, { replace: true })
  }

  return (
    <div className="ttk-requester-select">
      <Card className="ttk-requester-select__card">
        <h2>TokTickIT</h2>

        <p className="ttk-requester-select__explanation">
          Select a Development Requester to test requester-specific ticket behavior. This is not
          a login screen.
        </p>

        {state.status === 'loading' && (
          <div className="ttk-requester-select__loading">
            {/* Skeleton dropdown + disabled Continue (ui-spec.md §6.1). */}
            <div className="ttk-requester-select__skeleton" aria-hidden="true" />
            <LoadingSpinner label="Loading Development Requesters…" />
          </div>
        )}

        {/* AC-23/BR-27: nothing is selectable, so the app stays blocked. */}
        {state.status === 'ready' && state.requesters.length === 0 && (
          <EmptyState
            title="No Development Requesters available"
            message="No active Development Requesters are available. Contact your instructor."
          />
        )}

        {state.status === 'ready' && state.requesters.length > 0 && (
          <Field id={SELECT_ID} label="Development Requester" required>
            {(attrs) => (
              <select
                {...attrs}
                value={chosenId}
                onChange={(event) => setChosenId(event.target.value)}
              >
                <option value="">Choose a Requester…</option>
                {state.requesters.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        {state.status === 'failed' && (
          <ErrorState
            title="Unable to load Development Requesters"
            message="The Requester list could not be loaded. Check that the TokTickIT API is running, then try again."
            onRetry={() => void load()}
          />
        )}

        <p className="ttk-requester-select__callout">
          Authentication and role-based access will be introduced in Lab 3.
        </p>

        <Button
          onClick={handleContinue}
          disabled={state.status !== 'ready' || chosenId === ''}
        >
          Continue
        </Button>
      </Card>
    </div>
  )
}
