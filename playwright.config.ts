import { defineConfig } from '@playwright/test';

const PORT = 4391;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  timeout: 30_000,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1600, height: 1000 },
    channel: process.env.PW_CHANNEL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npx tsx e2e/server.ts',
    url: `http://localhost:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
