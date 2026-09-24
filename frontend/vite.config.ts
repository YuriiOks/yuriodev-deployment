/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    css: true,
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