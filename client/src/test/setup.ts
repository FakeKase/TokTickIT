import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Unmount anything a test rendered so the next test starts from a clean DOM.
afterEach(() => {
  cleanup()
})
