import { useContext } from 'react'
import { RequesterContext } from './requesterContext'
import type { RequesterContextValue } from './requesterContext'

/**
 * Reads the currently selected Development Requester. Throws rather than
 * returning a silent `null` when used outside the provider, so a missing
 * provider surfaces as an obvious error instead of a screen that quietly
 * behaves as if nobody is selected.
 */
export function useSelectedRequester(): RequesterContextValue {
  const value = useContext(RequesterContext)

  if (value === null) {
    throw new Error('useSelectedRequester must be used inside a <RequesterProvider>')
  }

  return value
}
