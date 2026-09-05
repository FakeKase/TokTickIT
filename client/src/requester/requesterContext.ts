import { createContext } from 'react'
import type { Requester } from '../api'

/**
 * The selected Development Requester context (BR-03/BR-05/BR-29).
 *
 * This is Lab 2 testing scaffolding that stands in for a login, NOT
 * authentication: the selection lives entirely in the browser, is freely
 * changeable, and grants no security guarantee. Lab 3 replaces it with a real
 * authenticated session, so consumers read the current Requester through
 * `useSelectedRequester()` and never touch storage directly — that keeps the
 * swap confined to this folder.
 */

export const REQUESTER_STORAGE_KEY = 'toktickit.selectedRequester'

export interface RequesterContextValue {
  requester: Requester | null
  /** BR-05: replaces any previously selected Requester. */
  selectRequester: (requester: Requester) => void
  clearRequester: () => void
}

export const RequesterContext = createContext<RequesterContextValue | null>(null)

function isRequester(value: unknown): value is Requester {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'number' &&
    typeof candidate.name === 'string' &&
    typeof candidate.email === 'string'
  )
}

/**
 * Restores the selection from a previous page load. Anything unreadable or
 * malformed — storage blocked or absent, a hand-edited value, a shape change
 * between releases — is treated as "nothing selected" rather than crashing.
 */
export function readStoredRequester(): Requester | null {
  try {
    const raw = window.localStorage.getItem(REQUESTER_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isRequester(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeStoredRequester(requester: Requester): void {
  try {
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, JSON.stringify(requester))
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). The
    // in-memory selection still works for this tab; only persistence is lost.
  }
}

export function clearStoredRequester(): void {
  try {
    window.localStorage.removeItem(REQUESTER_STORAGE_KEY)
  } catch {
    // See above — losing persistence must never break the app.
  }
}
