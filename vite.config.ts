/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // '/' for dev, tests and Capacitor; the GitHub Pages build sets BASE_PATH=/dance-practice/.
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  server: { port: 5173, open: false },
  // Vitest runs unit tests only; e2e/ belongs to Playwright.
  test: { include: ['src/**/*.test.ts'] },
})
