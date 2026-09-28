import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CheckSystemPage } from '../../src/pages/CheckSystemPage'

// Rendered as the page rather than through <App />: Lab 3 put every screen
// behind a session, and these tests are about the Check System screen itself.
// UI-01: the app identifies itself before any interaction.
describe('UI-01 TokTickIT heading', () => {
  it('renders the service desk heading', () => {
    render(
      <MemoryRouter>
        <CheckSystemPage />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('heading', { name: /What can we help you with/i }),
    ).toBeInTheDocument()
  })

  it('offers a Check System button', () => {
    render(
      <MemoryRouter>
        <CheckSystemPage />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('button', { name: /Check System/i }),
    ).toBeInTheDocument()
  })
})
