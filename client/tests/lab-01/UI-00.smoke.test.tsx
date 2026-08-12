import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../../src/App'

// Foundation smoke test (Issue 1): proves the Vitest + Testing Library toolchain
// is wired up and that the Bootstrap-styled shell renders.
describe('UI-00 foundation smoke', () => {
  it('renders the TokTickIT service desk heading', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: /TokTickIT IT Service Desk/i }),
    ).toBeInTheDocument()
  })
})
