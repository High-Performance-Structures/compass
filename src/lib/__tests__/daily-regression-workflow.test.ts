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
    const mobileBuilds = workflow.match(/bun run mobile:build/g) ?? []

    expect(mobileBuilds).toHaveLength(2)
    expect(workflow).toContain("bunx cap sync android")
    expect(workflow).toContain("bunx cap sync ios")
  })

  it("keeps production smoke navigation read-only", () => {
    expect(productionSmoke).toContain('page.goto("/demo")')
    expect(productionSmoke).not.toMatch(
      /page\.(click|dblclick|fill|press|check|uncheck|selectOption|setInputFiles)\(/,
    )
    expect(productionSmoke).not.toMatch(/request\.(post|put|patch|delete)\(/)
  })
})
