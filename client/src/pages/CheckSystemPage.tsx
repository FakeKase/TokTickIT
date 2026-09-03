import { useState } from 'react'
import type { Category } from '../api'
import { fetchHealth, fetchCategories } from '../api'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ErrorState } from '../components/ErrorState'
import { LoadingSpinner } from '../components/LoadingSpinner'
import './CheckSystemPage.css'

type CheckState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'online'; service: string; categories: Category[] }
  | { phase: 'offline'; message: string }

/** Lab 1's category-list screen, restyled with the Zen Green shell/components. */
export function CheckSystemPage() {
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
    <div className="ttk-check-system">
      <section className="ttk-check-system__intro">
        <h2>What can we help you with?</h2>
        <p className="ttk-check-system__subtitle">Select a category below to submit your request</p>

        <div className="ttk-check-system__controls">
          <Button
            type="button"
            onClick={handleCheckSystem}
            busy={check.phase === 'loading'}
            busyLabel="Checking…"
          >
            Check System
          </Button>

          {check.phase === 'online' && <Badge tone="pale">Online</Badge>}
          {check.phase === 'offline' && <Badge tone="danger">Offline</Badge>}
        </div>
      </section>

      {check.phase === 'offline' && <ErrorState title="Connection Error" message={check.message} />}

      {check.phase === 'loading' && <LoadingSpinner label="Loading categories…" />}

      {check.phase === 'online' && (
        <div className="ttk-check-system__grid">
          {check.categories.map((category) => (
            <Card key={category.id} className="ttk-check-system__category">
              <h3>{category.name}</h3>
              <p>{category.description}</p>
              <Button variant="secondary">Submit Request →</Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
