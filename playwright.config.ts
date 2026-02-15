import { defineConfig, devices } from "@playwright/test"

// Detect if running in Tauri desktop environment
const isTauri = () => {
  return process.env.TAURI === "true" || process.env.TAURI_TEST === "true"
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

// Desktop (Tauri) project
const desktopProjects = [
  {
    name: "desktop-chromium",
    testDir: "./e2e/desktop",
    use: {
      ...devices["Desktop Chrome"],
      baseURL: "tauri://localhost",
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
  projects: isTauri() ? desktopProjects : webProjects,
  webServer: isTauri()
    ? undefined
    : {
        command: "bun dev",
        port: 3000,
        timeout: 120000,
        reuseExistingServer: !process.env.CI,
      },
})
