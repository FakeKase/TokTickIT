import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Requester } from '../api'
import {
  RequesterContext,
  clearStoredRequester,
  readStoredRequester,
  writeStoredRequester,
} from './requesterContext'
import type { RequesterContextValue } from './requesterContext'

/** Holds the selected Development Requester for the whole app. See requesterContext.ts. */
export function RequesterProvider({ children }: { children: ReactNode }) {
  const [requester, setRequester] = useState<Requester | null>(readStoredRequester)

  const selectRequester = useCallback((next: Requester) => {
    setRequester(next)
    writeStoredRequester(next)
  }, [])

  const clearRequester = useCallback(() => {
    setRequester(null)
    clearStoredRequester()
  }, [])

  const value = useMemo<RequesterContextValue>(
    () => ({ requester, selectRequester, clearRequester }),
    [requester, selectRequester, clearRequester],
  )

  return <RequesterContext.Provider value={value}>{children}</RequesterContext.Provider>
}
