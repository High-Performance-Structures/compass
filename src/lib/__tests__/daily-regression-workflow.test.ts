import { readFileSync } from "node:fs"
import { join } from "node:path"

import ts from "typescript"
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
const productionSmokeSourceFile = ts.createSourceFile(
  "production-smoke.spec.ts",
  productionSmoke,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
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

function functionBody(name: string): ts.Block {
  let declaration: ts.FunctionDeclaration | undefined
  const visit = (node: ts.Node): void => {
    if (declaration) return
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      declaration = node
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(productionSmokeSourceFile)

  const body = declaration?.body
  if (!body) throw new Error(`Expected ${name} to have a function body.`)
  return body
}

function containsCall(
  root: ts.Node,
  predicate: (call: ts.CallExpression) => boolean,
): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isCallExpression(node) && predicate(node)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

function hasResponseStatusAssertion(body: ts.Block): boolean {
  return containsCall(body, (call) => {
    if (
      !ts.isPropertyAccessExpression(call.expression) ||
      call.expression.name.text !== "toBeLessThan" ||
      call.arguments.length !== 1
    ) {
      return false
    }

    const threshold = call.arguments[0]
    if (!ts.isNumericLiteral(threshold) || threshold.text !== "400") return false

    const expectation = call.expression.expression
    if (
      !ts.isCallExpression(expectation) ||
      !ts.isIdentifier(expectation.expression) ||
      expectation.expression.text !== "expect" ||
      expectation.arguments.length < 1
    ) {
      return false
    }

    const actual = expectation.arguments[0]
    if (
      !ts.isCallExpression(actual) ||
      !ts.isPropertyAccessExpression(actual.expression) ||
      actual.expression.name.text !== "status" ||
      actual.arguments.length !== 0 ||
      !ts.isIdentifier(actual.expression.expression)
    ) {
      return false
    }

    return actual.expression.expression.text === "response"
  })
}

function hasNonEmptyResponseBodyAssertion(body: ts.Block): boolean {
  return containsCall(body, (call) => {
    if (
      !ts.isPropertyAccessExpression(call.expression) ||
      call.expression.name.text !== "toBeEmpty" ||
      call.arguments.length !== 0
    ) {
      return false
    }

    const notAccess = call.expression.expression
    if (
      !ts.isPropertyAccessExpression(notAccess) ||
      notAccess.name.text !== "not" ||
      !ts.isCallExpression(notAccess.expression) ||
      !ts.isIdentifier(notAccess.expression.expression) ||
      notAccess.expression.expression.text !== "expect" ||
      notAccess.expression.arguments.length < 1
    ) {
      return false
    }

    const actual = notAccess.expression.arguments[0]
    if (
      !ts.isCallExpression(actual) ||
      !ts.isPropertyAccessExpression(actual.expression) ||
      actual.expression.name.text !== "locator" ||
      actual.arguments.length !== 1 ||
      !ts.isIdentifier(actual.expression.expression) ||
      actual.expression.expression.text !== "page"
    ) {
      return false
    }

    const selector = actual.arguments[0]
    return ts.isStringLiteral(selector) && selector.text === "body"
  })
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

    const navigationAssertions = functionBody("expectHealthyNavigation")
    expect(hasResponseStatusAssertion(navigationAssertions)).toBe(true)
    expect(hasNonEmptyResponseBodyAssertion(navigationAssertions)).toBe(true)
  })
})
