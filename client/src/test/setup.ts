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

// Each test starts with no stored selection, so one test's selected Requester
// can never leak into the next.
beforeEach(() => {
  window.localStorage?.clear()
})

// Unmount anything a test rendered so the next test starts from a clean DOM.
afterEach(() => {
  cleanup()
})
