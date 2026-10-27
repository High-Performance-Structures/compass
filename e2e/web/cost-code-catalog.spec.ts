import Database from "better-sqlite3"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const projectId = "e2e-cost-code-catalog-o"

test.describe("company cost-code catalog", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Uses synthetic local projects only.")
  test.beforeAll(() => {
    const db = new Database(resolve(process.env.LOCAL_DB_PATH ?? ".e2e/compass.db"))
    const now = new Date().toISOString()
    db.prepare("INSERT OR IGNORE INTO projects (id,project_number,name,department,organization_id,created_at,updated_at) VALUES (?,'O-E2E-CATALOG-001','Full catalog regression','O','hps-org-001',?,?)").run(projectId, now, now)
    for (const [id, number, workspace] of [["e2e-cost-code-budget", "O-BUDGET-TEST", null], ["e2e-cost-code-internal", "O-INTERNAL-TEST", "office"]]) {
      db.prepare("INSERT OR IGNORE INTO projects (id,project_number,name,department,workspace_kind,organization_id,created_at,updated_at) VALUES (?,?,?,'O',?,'hps-org-001',?,?)").run(id, number, id, workspace, now, now)
    }
    db.prepare("INSERT OR IGNORE INTO project_budget_lines (id,project_id,cost_code,description,csi_division,csi_division_name,created_at,updated_at) VALUES ('e2e-cost-code-budget-line','e2e-cost-code-budget','01 71 13','Mobilization','01','General Requirements',?,?)").run(now, now)
    db.prepare("DELETE FROM daily_logs WHERE project_id=?").run(projectId)
    db.close()
  })

  test("O daily logs can find and save a code outside the shortened labor list", async ({ page }) => {
    await page.goto(`/dashboard/projects/${projectId}/daily-logs?quickAdd=daily-log`)
    const code = page.getByRole("combobox", { name: "Cost code 1", exact: true })
    await code.click()
    await expect.poll(() => page.getByRole("option").count()).toBeGreaterThanOrEqual(1169)
    await page.getByPlaceholder("Search cost codes...", { exact: true }).fill("48 14 00")
    await page.getByRole("option").filter({ hasText: "48 14 00" }).click()
    await expect(code).toContainText("48 14 00")
    await page.getByLabel("Hours for cost code 1", { exact: true }).fill("1")
    await page.locator("#daily-log-work").fill("Full company catalog browser regression")
    await page.getByRole("button", { name: "Save daily log", exact: true }).click()
    await expect(page.getByText("Daily log saved. Review it before making it owner visible.", { exact: true })).toBeVisible()
    await expect(page.getByText("Full company catalog browser regression", { exact: true }).first()).toBeVisible()
    await page.goto(`/dashboard/projects/${projectId}/daily-logs`)
    await expect(page.getByText("Full company catalog browser regression", { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/48 14 00/).first()).toBeVisible()
  })
  test("a job budget limits browsing while search can select an outside company code", async ({ page }) => {
    await page.goto("/dashboard/projects/e2e-cost-code-budget/daily-logs?quickAdd=daily-log")
    const code = page.getByRole("combobox", { name: "Cost code 1", exact: true })
    await code.click()
    await expect(page.getByRole("option")).toHaveCount(1)
    await expect(page.getByRole("option")).toContainText("01 71 13")
    await page.getByPlaceholder("Search cost codes...", { exact: true }).fill("48 14 00")
    await page.getByRole("option").filter({ hasText: "48 14 00" }).click()
    await expect(code).toContainText("48 14 00")
    await code.click()
    await expect(page.getByRole("option")).toHaveCount(1)
    await expect(code).toContainText("48 14 00")
    await expect(page.getByRole("option")).toContainText("01 71 13")
  })

  test("internal customized duties are the browse list and company codes remain searchable", async ({ page }) => {
    await page.goto("/dashboard/projects/e2e-cost-code-internal/daily-logs?quickAdd=daily-log")
    await page.getByRole("combobox", { name: "Cost code 1", exact: true }).click()
    const count = await page.getByRole("option").count()
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(1169)
    await expect(page.getByRole("option").filter({ hasText: "48 14 00" })).toHaveCount(0)
    await page.getByPlaceholder("Search cost codes...", { exact: true }).fill("48 14 00")
    await page.getByRole("option").filter({ hasText: "48 14 00" }).click()
    await expect(page.getByRole("combobox", { name: "Cost code 1", exact: true })).toContainText("48 14 00")
  })

})
