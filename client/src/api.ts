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
