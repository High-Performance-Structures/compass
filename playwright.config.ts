import { defineConfig, devices } from "@playwright/test"

// Detect if running in Electron desktop environment
const isElectron = () => {
  return process.env.ELECTRON === "true" || process.env.ELECTRON_TEST === "true"
}

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
    actionTimeout: 30000,
    navigationTimeout: 30000,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "test-results",
  preserveOutput: "always",
  projects: isElectron() ? desktopProjects : webProjects,
  webServer: {
    command: "bun dev",
    port: 3000,
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
})
