import { defineConfig, devices } from "@playwright/test"

// Detect if running in Electron desktop environment
const isElectron = () => {
  return process.env.ELECTRON === "true" || process.env.ELECTRON_TEST === "true"
}

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL
const baseURL = externalBaseUrl ?? "http://127.0.0.1:3000"
const localServerCommand = process.env.CI && !isElectron()
  ? "COMPASS_E2E=true node node_modules/next/dist/bin/next start"
  : "node node_modules/next/dist/bin/next dev --webpack"

// Web-specific projects
const webProjects = [
  {
    name: "chromium",
    use: { ...devices["Desktop Chrome"] },
  },
  {
    name: "firefox",
    use: { ...devices["Desktop Firefox"] },
  },
  {
    name: "webkit",
    use: { ...devices["Desktop Safari"] },
  },
  {
    name: "mobile-chrome",
    use: { ...devices["Pixel 7"] },
  },
  {
    name: "mobile-safari",
    use: { ...devices["iPhone 13"] },
  },
]

// Desktop (Electron) project
const desktopProjects = [
  {
    name: "desktop-chromium",
    testDir: "./e2e/desktop",
    use: {
      ...devices["Desktop Chrome"],
      baseURL: "http://127.0.0.1:3000",
      ignoreHTTPSErrors: true,
    },
  },
]

export default defineConfig({
  timeout: 60000,
  expect: {
    timeout: 30000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["html"], ["list"]],
  testDir: "./e2e",
  use: {
    baseURL,
    actionTimeout: 30000,
    navigationTimeout: 30000,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "test-results",
  preserveOutput: "always",
  projects: isElectron() ? desktopProjects : webProjects,
  webServer: externalBaseUrl
    ? undefined
    : {
        // The deterministic D1 adapter uses better-sqlite3. Run the Next test
        // server under Node so the prepared fixture database remains available.
        // CI builds before Playwright runs, so use the bounded production
        // server there. The dev server can restart under the full route sweep's
        // memory pressure, interrupting Firefox/WebKit navigations mid-test.
        command: localServerCommand,
        url: baseURL,
        timeout: 120000,
        reuseExistingServer: !process.env.CI,
      },
})
