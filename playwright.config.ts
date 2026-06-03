import { defineConfig, devices } from '@playwright/test';

// Vite serves under base '/Voidmanager-website/', so the app root in dev is /Voidmanager-website/.
const BASE_URL = 'http://localhost:5173/Voidmanager-website/';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }]],
  // Increase default timeout — the OBC/Three.js bundle is large and takes time
  // to parse in headless Chromium. Existing viewer.spec.ts tests need > 30s.
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Allow navigation to complete even with the large JS bundle
    navigationTimeout: 60_000,
    actionTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Enable WebGL via SwiftShader in headless Chromium (needed for Three.js canvas assertions)
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
