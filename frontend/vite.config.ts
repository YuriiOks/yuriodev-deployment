import { defineConfig } from 'vite'
// Also brings in the types of the `test` block below.
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    css: true,
    // e2e/ holds the Playwright browser tests (npm run e2e), not vitest's.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
  server: {
    proxy: {
      // Proxy requests from /api to the backend. Override via
      // VITE_API_PROXY_TARGET (e.g. compose.local.yml points this at the
      // local backend container); falls back to the live backend.
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'https://api.yuriodev.co.uk',
        changeOrigin: true,
        // 'secure: false' is often not needed for valid certs, but doesn't hurt
        secure: false,
      }
    }
  }
})