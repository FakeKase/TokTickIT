import { useCallback, useEffect, useState } from 'react'
import type { Category } from '../api'
import { fetchCategories, fetchHealth } from '../api'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ErrorState } from '../components/ErrorState'
import { LoadingSpinner } from '../components/LoadingSpinner'
import './SystemStatusPage.css'

type CheckState =
  | { phase: 'loading' }
  | { phase: 'online'; service: string; categories: Category[] }
  | { phase: 'offline' }

/**
 * System Status (Lab 4 ui-spec.md §8), for an Administrator.
 *
 * This is Lab 1's Check System screen, which used to be the page everybody
 * landed on. What it checks is unchanged: the API answers, and it can read the
 * Category list out of the database. Its "Submit Request" buttons, which never
 * did anything, are gone, and it checks on arrival instead of waiting to be
 * asked.
 */
export function SystemStatusPage() {
  const [check, setCheck] = useState<CheckState>({ phase: 'loading' })

  const runCheck = useCallback(async (isCurrent: () => boolean = () => true) => {
    setCheck({ phase: 'loading' })
    try {
      const health = await fetchHealth()
      const categories = await fetchCategories()
      if (isCurrent()) setCheck({ phase: 'online', service: health.service, categories })
    } catch {
      if (isCurrent()) setCheck({ phase: 'offline' })
    }
  }, [])

  useEffect(() => {
    let current = true
    void runCheck(() => current)
    return () => {
      current = false
    }
  }, [runCheck])

  return (
    <div className="ttk-system-status">
      <section className="ttk-system-status__intro">
        <h2>System Status</h2>
        <p className="ttk-system-status__subtitle">
          Whether the TokTickIT API answers and can read from its database.
        </p>

        <div className="ttk-system-status__controls">
          <Button
            variant="secondary"
            onClick={() => void runCheck()}
            busy={check.phase === 'loading'}
            busyLabel="Checking…"
          >
            Check again
          </Button>

          {check.phase === 'online' && <Badge tone="pale">Online</Badge>}
          {check.phase === 'offline' && <Badge tone="danger">Offline</Badge>}
        </div>
      </section>

      {check.phase === 'loading' && <LoadingSpinner label="Checking the system…" />}

      {check.phase === 'offline' && (
        <ErrorState
          title="Connection Error"
          message="Unable to connect to TokTickIT API"
          onRetry={() => void runCheck()}
          retryLabel="Try again"
        />
      )}

      {check.phase === 'online' && (
        <>
          <dl className="ttk-system-status__facts">
            <div>
              <dt>API</dt>
              <dd>{check.service} is answering</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>
                {check.categories.length}{' '}
                {check.categories.length === 1 ? 'Category' : 'Categories'} read
              </dd>
            </div>
          </dl>

          <h3>Categories</h3>
          <div className="ttk-system-status__grid">
            {check.categories.map((category) => (
              <Card key={category.id} className="ttk-system-status__category">
                <h4>{category.name}</h4>
                <p>{category.description}</p>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
