import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api'

export type DashboardLoad<Body> =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'forbidden' }
  | { state: 'ready'; body: Body }

/**
 * Loads a dashboard once and on demand.
 *
 * 403 is kept apart from every other failure: asking again gets the same
 * answer, so the screen offers a way onward and not a retry.
 */
export function useDashboard<Body>(fetcher: () => Promise<Body>) {
  const [load, setLoad] = useState<DashboardLoad<Body>>({ state: 'loading' })

  const reload = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      setLoad({ state: 'loading' })
      try {
        const body = await fetcher()
        if (isCurrent()) setLoad({ state: 'ready', body })
      } catch (failure) {
        if (!isCurrent()) return
        setLoad({
          state: failure instanceof ApiError && failure.status === 403 ? 'forbidden' : 'failed',
        })
      }
    },
    [fetcher],
  )

  useEffect(() => {
    let current = true
    void reload(() => current)
    return () => {
      current = false
    }
  }, [reload])

  return { load, reload: () => void reload() }
}
