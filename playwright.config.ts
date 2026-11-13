import { defineConfig, devices } from "@playwright/test"

// Detect if running in Electron desktop environment
const isElectron = () => {
  return process.env.ELECTRON === "true" || process.env.ELECTRON_TEST === "true"
}

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL
const localBaseURL = `http://127.0.0.1:${process.env.PORT ?? "3000"}`
const baseURL = externalBaseUrl ?? localBaseURL
const desktopBaseURL = externalBaseUrl ?? baseURL
// CI web jobs build first and serve that build. Desktop jobs use the dev
// server unless their workflow built the app and set COMPASS_E2E_NEXT_START
// (macOS: there `next dev` compiles routes on demand for 40-100 s and any
// compile in progress holds the preview popup's request, so the
// window-event wait timed the compiler, not Electron).
const useBuiltServer =
  Boolean(process.env.CI) &&
  (!isElectron() || process.env.COMPASS_E2E_NEXT_START === "true")
const localServerCommand = useBuiltServer
  ? "node node_modules/next/dist/bin/next start"
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
      baseURL: desktopBaseURL,
      ignoreHTTPSErrors: true,
    },
  },
]

export default defineConfig({
  timeout: 60000,
  // Remote smoke runs hit the live production Worker, where an individual
  // request can transiently fail (deploy rollouts, Cloudflare 1102 resource
  // errors). Retry those so one-off infra blips don't fail the nightly, while
  // persistent breakage still does. Local runs stay strict and deterministic.
  retries: externalBaseUrl ? 2 : 0,
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
        env: {
          COMPASS_E2E: "true",
          COMPASS_CORRESPONDENCE_PROJECT_IDS: "e2e-correspondence-project-001",
          LOCAL_DB_PATH: process.env.LOCAL_DB_PATH ?? ".e2e/compass.db",
          WORKOS_API_KEY: "placeholder-e2e",
          WORKOS_CLIENT_ID: "placeholder-e2e",
        },
      },
})
