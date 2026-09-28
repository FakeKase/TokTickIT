import { render, screen, waitForElementToBeRemoved } from '@testing-library/react'
import App from '../../src/App'

/**
 * Renders <App /> and waits for the session check to settle.
 *
 * AuthProvider asks `GET /api/auth/me` on mount, so for one tick the app shows
 * "Checking your session" and nothing else. A synchronous `getBy…` straight
 * after `render` finds the spinner rather than the screen — which is not a flaw
 * in the test: it is what a real page load does, so the tests wait for it the
 * way a person does.
 */
export async function renderApp() {
  const result = render(<App />)

  const spinner = screen.queryByText('Checking your session')
  if (spinner) await waitForElementToBeRemoved(spinner)

  return result
}
