import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: process.env.GALLERY_URL ?? 'http://localhost:3090' },
})
