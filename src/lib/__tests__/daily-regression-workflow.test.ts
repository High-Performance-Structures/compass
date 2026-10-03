import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const workflow = readFileSync(
  join(process.cwd(), ".github/workflows/daily-regression.yml"),
  "utf8",
)
const productionSmoke = readFileSync(
  join(process.cwd(), "e2e/web/production-smoke.spec.ts"),
  "utf8",
)

function findStepRun(
  jobName: string,
  stepName: string,
): string | null {
  const lines = workflow.split("\n")
  const jobStart = lines.findIndex((line) => line === `  ${jobName}:`)
  if (jobStart < 0) return null

  const nextJob = lines.findIndex(
    (line, index) => index > jobStart && /^  [a-z0-9-]+:$/.test(line),
  )
  const jobLines = lines.slice(jobStart, nextJob < 0 ? lines.length : nextJob)
  const stepStart = jobLines.findIndex(
    (line) => line === `      - name: ${stepName}`,
  )
  if (stepStart < 0) return null

  const nextStep = jobLines.findIndex(
    (line, index) => index > stepStart && /^      - /.test(line),
  )
  const stepLines = jobLines.slice(
    stepStart,
    nextStep < 0 ? jobLines.length : nextStep,
  )
  const runLine = stepLines.find((line) => /^        run:/.test(line))
  return runLine?.replace(/^        run:\s*/, "").trim() ?? null
}

describe("daily regression workflow", () => {
  it("runs the read-only production smoke spec instead of fixture workflows", () => {
    expect(workflow).toContain(
      "bunx playwright test e2e/web/production-smoke.spec.ts --project=${{ matrix.project }}",
    )
    expect(workflow).not.toContain(
      "bunx playwright test e2e/web --project=${{ matrix.project }}",
    )
  })

  it("builds the generated mobile shell before syncing each native platform", () => {
    expect(findStepRun("android-build", "Synchronize Capacitor project")).toBe(
      "bun run mobile:build && bunx cap sync android",
    )
    expect(findStepRun("ios-build", "Synchronize Capacitor project")).toBe(
      "bun run mobile:build && bunx cap sync ios",
    )
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

  it("blocks ambient Next server-action writes before they reach production", () => {
    expect(productionSmoke).toContain("context.addInitScript")
    expect(productionSmoke).toContain('method.toUpperCase() === "POST"')
    expect(productionSmoke).toContain('headers.has("Next-Action")')
    expect(productionSmoke).toContain("Promise.reject")
  })
})
