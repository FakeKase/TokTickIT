import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

// Node 26 ships a built-in `localStorage` global that stays disabled unless the
// process is started with --localstorage-file, and it shadows the one jsdom
// would otherwise install — so `window.localStorage` is undefined under
// `npm test` even though real browsers have it. Install a minimal in-memory
// Storage so tests can exercise persistence. (App code guards its own storage
// access, so it already behaves correctly when storage is genuinely missing.)
if (typeof window !== 'undefined' && !window.localStorage) {
  const store = new Map<string, string>()

  const memoryStorage: Storage = {
    get length() {
      return store.size
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    getItem: (key) => store.get(String(key)) ?? null,
    setItem: (key, value) => {
      store.set(String(key), String(value))
    },
    removeItem: (key) => {
      store.delete(String(key))
    },
    clear: () => {
      store.clear()
    },
  }

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: memoryStorage,
  })
}

// No test here talks to a server, so the fetch underneath every mock is one
// that fails instead of the real one. A test's own afterEach runs before the
// cleanup below, which leaves the app mounted for a moment after its fetch
// mock has been restored; a request made in that moment used to reach whatever
// was listening on the API port. With a development API running it answered
// 401, the 401 reached the unauthorized handler (a module-level hook in
// api.ts), and the next test's app was signed out before it had rendered.
globalThis.fetch = (() =>
  Promise.reject(new TypeError('fetch is not mocked in this test'))) as typeof fetch

// Each test starts with no stored selection, so one test's selected Requester
// can never leak into the next.
beforeEach(() => {
  window.localStorage?.clear()
})

// Unmount anything a test rendered so the next test starts from a clean DOM.
afterEach(() => {
  cleanup()
})
