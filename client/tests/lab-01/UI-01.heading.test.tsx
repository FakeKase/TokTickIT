import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../../src/App'

// UI-01: the app identifies itself before any interaction.
describe('UI-01 TokTickIT heading', () => {
  it('renders the service desk heading', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: /What can we help you with/i }),
    ).toBeInTheDocument()
  })

  it('offers a Check System button', () => {
    render(<App />)

    expect(
      screen.getByRole('button', { name: /Check System/i }),
    ).toBeInTheDocument()
  })
})
