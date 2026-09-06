/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // Vitest stubs CSS imports to empty strings by default, which makes
    // `import css from './x.css?raw'` return ''. ThemeFlash.test.tsx reads
    // theme.css that way to prove index.html's inlined critical background
    // still matches --zg-bg, so CSS has to be processed here.
    css: true,
  },
})
