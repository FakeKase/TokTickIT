// Base URL of the TokTickIT API. Falls back to the local dev port so the app
// still runs when client/.env has not been created.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export interface HealthResponse {
  status: string
  service: string
}

export interface Category {
  id: number
  name: string
  description: string
}

/**
 * A Development Requester as returned by `GET /api/requesters` (api-spec.md §1).
 * Lab 2 testing scaffolding only — this is not an authenticated identity
 * (BR-03/BR-29), which is why it carries no credential or role information.
 */
export interface Requester {
  id: number
  name: string
  email: string
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_URL}/api/health`)

  if (!response.ok) {
    throw new Error(`TokTickIT API responded with ${response.status}`)
  }

  return (await response.json()) as HealthResponse
}

export async function fetchCategories(): Promise<Category[]> {
  const response = await fetch(`${API_URL}/api/categories`)

  if (!response.ok) {
    throw new Error(`TokTickIT API responded with ${response.status}`)
  }

  return (await response.json()) as Category[]
}

/** Active Development Requesters for the selector screen (BR-04). */
export async function fetchRequesters(): Promise<Requester[]> {
  const response = await fetch(`${API_URL}/api/requesters`)

  if (!response.ok) {
    throw new Error(`TokTickIT API responded with ${response.status}`)
  }

  return (await response.json()) as Requester[]
}
