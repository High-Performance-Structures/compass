import { readFileSync } from "node:fs"
import { join } from "node:path"

import YAML from "yaml"
import { describe, expect, it } from "vitest"

const workflow = readFileSync(
  join(process.cwd(), ".github/workflows/daily-regression.yml"),
  "utf8",
)
const productionSmoke = readFileSync(
  join(process.cwd(), "e2e/web/production-smoke.spec.ts"),
  "utf8",
)

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function record(value: unknown, description: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(`Expected ${description} to be a YAML mapping.`)
  return value
}

function list(value: unknown, description: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${description} to be a YAML list.`)
  return value
}

const workflowDocument = record(YAML.parse(workflow), "workflow")
const jobs = record(workflowDocument.jobs, "jobs")

function job(name: string): Readonly<Record<string, unknown>> {
  return record(jobs[name], `job ${name}`)
}

function namedStep(jobName: string, stepName: string): Readonly<Record<string, unknown>> {
  const steps = list(job(jobName).steps, `steps for ${jobName}`)
  const step = steps.find((candidate) => isRecord(candidate) && candidate.name === stepName)
  return record(step, `${jobName}/${stepName}`)
}

function usedStep(jobName: string, action: string): Readonly<Record<string, unknown>> {
  const steps = list(job(jobName).steps, `steps for ${jobName}`)
  const step = steps.find((candidate) => isRecord(candidate) && candidate.uses === action)
  return record(step, `${jobName}/${action}`)
}

function containsKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsKey(entry, key))
  if (!isRecord(value)) return false
  return Object.entries(value).some(
    ([entryKey, entryValue]) => entryKey === key || containsKey(entryValue, key),
  )
}

describe("daily regression workflow", () => {
  it("keeps the scheduled and manually dispatched triggers", () => {
    expect(workflowDocument.on).toEqual({
      schedule: [{ cron: "15 13 * * *" }],
      workflow_dispatch: null,
    })
  })

  it("runs only the read-only production smoke spec for every browser matrix entry", () => {
    const productionJob = job("production-smoke")
    const matrix = record(record(productionJob.strategy, "production matrix").matrix, "production matrix")
    expect(matrix.include).toEqual([
      { project: "chromium", browser: "chromium" },
      { project: "mobile-chrome", browser: "chromium" },
      { project: "mobile-safari", browser: "webkit" },
    ])
    expect(namedStep("production-smoke", "Run read-only production journeys")).toEqual({
      name: "Run read-only production journeys",
      run: "bunx playwright test e2e/web/production-smoke.spec.ts --project=${{ matrix.project }}",
      env: {
        PLAYWRIGHT_BASE_URL: "https://compass.openrangeconstruction.ltd",
        PLAYWRIGHT_REQUIRE_PROJECT: "false",
      },
    })
  })

  it("keeps production jobs unconditional and disallows continue-on-error", () => {
    expect(job("production-smoke")).not.toHaveProperty("if")
    expect(job("android-build")).not.toHaveProperty("if")
    expect(job("ios-build")).not.toHaveProperty("if")
    expect(job("report").if).toBe("always()")
    expect(containsKey(workflowDocument, "continue-on-error")).toBe(false)
  })

  it("allows only the declared production setup and smoke commands", () => {
    const productionSteps = list(job("production-smoke").steps, "production steps")
    const runCommands = productionSteps.flatMap((candidate) => {
      if (!isRecord(candidate) || typeof candidate.run !== "string") return []
      return [candidate.run]
    })
    expect(runCommands).toEqual([
      "bun install --frozen-lockfile",
      "bunx playwright install --with-deps ${{ matrix.browser }}",
      "bunx playwright test e2e/web/production-smoke.spec.ts --project=${{ matrix.project }}",
    ])
  })

  it("builds the generated mobile shell before syncing each native platform", () => {
    expect(namedStep("android-build", "Synchronize Capacitor project").run).toBe(
      "bun run mobile:build && bunx cap sync android",
    )
    expect(namedStep("ios-build", "Synchronize Capacitor project").run).toBe(
      "bun run mobile:build && bunx cap sync ios",
    )
  })

  it("collects browser diagnostics even when a matrix job fails", () => {
    expect(usedStep("production-smoke", "actions/upload-artifact@v4")).toEqual({
      uses: "actions/upload-artifact@v4",
      if: "always()",
      with: {
        name: "daily-playwright-${{ matrix.project }}",
        path: "playwright-report/\ntest-results/\n",
        "if-no-files-found": "ignore",
        "retention-days": 14,
      },
    })
  })

  it("reports every required job result without allowing blanket failures", () => {
    const report = job("report")
    expect(report.if).toBe("always()")
    expect(report.needs).toEqual(["production-smoke", "android-build", "ios-build"])
    const reportSteps = list(report.steps, "report steps")
    expect(reportSteps).toHaveLength(1)
    expect(record(reportSteps[0], "report step").uses).toBe("actions/github-script@v7")
    expect(workflowDocument).not.toHaveProperty("defaults.run.continue-on-error")
  })

  it("models the approved people legacy-route redirect", () => {
    expect(productionSmoke).toMatch(
      /path: "\/dashboard\/people",\s*expectedPath: "\/dashboard\/contacts\?tab=internal"/,
    )
  })

  it("keeps production smoke navigation read-only", () => {
    expect(productionSmoke).toContain('page.goto("/demo")')
    expect(productionSmoke).not.toMatch(
      /page\.(click|dblclick|fill|press|check|uncheck|selectOption|setInputFiles)\(/,
    )
    expect(productionSmoke).not.toMatch(/request\.(post|put|patch|delete)\(/)
  })

  it("aborts ambient Next server-action writes before network dispatch", () => {
    expect(productionSmoke).toMatch(
      /await context\.route\("\*\*\/\*",\s*async \(route\) =>/,
    )
    expect(productionSmoke).toContain("const request = route.request()")
    expect(productionSmoke).toContain('request.method() === "POST"')
    expect(productionSmoke).toContain('request.headers()["next-action"]')
    expect(productionSmoke).toContain('await route.abort("blockedbyclient")')
    expect(productionSmoke).not.toContain("context.addInitScript")
    expect(productionSmoke).not.toContain("window.fetch")
    expect(productionSmoke).not.toContain(
      "expect(serverActionRequests).toEqual([])",
    )
  })

  it("compares every navigation using the exact pathname and search", () => {
    expect(productionSmoke).toContain(
      'const actualPath = `${url.pathname}${url.search}`',
    )
    expect(productionSmoke).toContain(".toBe(expectedPath)")
    expect(productionSmoke).not.toContain("new RegExp")
    expect(productionSmoke).not.toContain("toHaveURL")
    expect(productionSmoke).not.toMatch(/waitForURL\(\s*\//)
  })
})
