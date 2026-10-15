import { defineConfig, devices } from '@playwright/test'

// E2E runs against its own throwaway gallery (fresh DB), never the compose stack's,
// because the seeded charts carry made-up numbers.
const PORT = 3091
const BASE_URL = `http://localhost:${PORT}`
process.env.CHART_GALLERY_TOKEN = 'e2e-throwaway-token-'.padEnd(48, '0')

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: BASE_URL },
  webServer: {
    command: `bash scripts/e2e-gallery.sh ${PORT}`,
    url: `${BASE_URL}/healthz`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { CHART_GALLERY_TOKEN: process.env.CHART_GALLERY_TOKEN },
  },
})
