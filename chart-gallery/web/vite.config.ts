import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3090' } },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/semantic/charts.worker.ts', 'src/semantic/store.ts', 'src/test/**', 'src/**/*.test.*'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
