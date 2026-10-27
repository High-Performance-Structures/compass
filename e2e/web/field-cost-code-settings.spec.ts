import Database from "better-sqlite3"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const projectId = "e2e-field-code-settings"
const peerId = "e2e-field-code-peer"
let previousCompanySetting: string | null = null

test.describe("explicit Field cost-code settings", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Uses synthetic local settings/projects only.")
  test.beforeAll(() => {
    const db = new Database(resolve(process.env.LOCAL_DB_PATH ?? ".e2e/compass.db"))
    const existing = db.prepare("SELECT value FROM organization_feature_settings WHERE organization_id='hps-org-001' AND feature_key='field-cost-codes'").get()
    if (existing && typeof existing === "object" && "value" in existing && typeof existing.value === "string") previousCompanySetting = existing.value
    const now = new Date().toISOString()
    for (const id of [projectId, peerId]) db.prepare("INSERT OR IGNORE INTO projects (id,name,project_number,department,organization_id,created_at,updated_at) VALUES (?,?,?,'O','hps-org-001',?,?)").run(id, id, id, now, now)
    db.prepare("DELETE FROM organization_feature_settings WHERE organization_id='hps-org-001' AND feature_key='field-cost-codes'").run()
    db.prepare("DELETE FROM project_field_cost_codes WHERE project_id IN (?,?)").run(projectId, peerId)
    db.close()
  })
  test.afterAll(() => {
    const db = new Database(resolve(process.env.LOCAL_DB_PATH ?? ".e2e/compass.db"))
    if (previousCompanySetting === null) db.prepare("DELETE FROM organization_feature_settings WHERE organization_id='hps-org-001' AND feature_key='field-cost-codes'").run()
    else db.prepare("INSERT INTO organization_feature_settings (organization_id,feature_key,value,updated_at) VALUES ('hps-org-001','field-cost-codes',?,?) ON CONFLICT(organization_id,feature_key) DO UPDATE SET value=excluded.value").run(previousCompanySetting, new Date().toISOString())
    db.prepare("DELETE FROM project_field_cost_codes WHERE project_id IN (?,?)").run(projectId, peerId)
    db.close()
  })

  test("admins save independent company defaults and can reset to the existing crew list", async ({ page }) => {
    await page.goto("/dashboard/settings?section=workflows&workflow=field-cost-codes")
    const section = page.getByRole("region", { name: "Field Mode default cost codes", exact: true })
    await expect(section.getByText(/Using the existing configured crew list/)).toBeVisible()
    // Adopt the current crew list as explicit defaults without changing its codes.
    await section.getByRole("button", { name: "Save Field Mode defaults", exact: true }).click()
    await page.getByRole("button", { name: "Confirm save", exact: true }).click()
    await expect(section.getByText(/Using the existing configured crew list/)).toHaveCount(0)
    await section.getByRole("button", { name: "Reset to crew defaults", exact: true }).click()
    await page.getByRole("button", { name: "Confirm reset", exact: true }).click()
    await expect(section.getByText(/Using the existing configured crew list/)).toBeVisible()
    await section.getByRole("combobox", { name: "Add default Field Mode cost code" }).click()
    await page.getByPlaceholder("Search company cost codes...", { exact: true }).fill("48 14 00")
    await page.getByRole("option").filter({ hasText: "48 14 00" }).click()
    await section.getByRole("button", { name: "Add code", exact: true }).click()
    await section.getByRole("button", { name: "Save Field Mode defaults", exact: true }).click()
    await expect(page.getByRole("alertdialog")).toContainText("all eligible jobs")
    await page.getByRole("button", { name: "Confirm save", exact: true }).click()
    await expect(section.getByText(/Using the existing configured crew list/)).toHaveCount(0)
    await page.reload()
    await expect(section.getByRole("button", { name: "Remove 48 14 00 from Field Mode defaults", exact: true })).toBeVisible()
    await section.getByRole("button", { name: "Reset to crew defaults", exact: true }).click()
    await page.getByRole("button", { name: "Confirm reset", exact: true }).click()
    await expect(section.getByText(/Using the existing configured crew list/)).toBeVisible()
    await expect(section.getByRole("button", { name: "Remove 48 14 00 from Field Mode defaults", exact: true })).toHaveCount(0)
  })

  test("adopting defaults clearly confirms when department crew lists will be combined", async ({ page }) => {
    const db = new Database(resolve(process.env.LOCAL_DB_PATH ?? ".e2e/compass.db"))
    const row = db.prepare("SELECT value FROM organization_feature_settings WHERE organization_id='hps-org-001' AND feature_key='daily-logs'").get()
    const previous = row && typeof row === "object" && "value" in row && typeof row.value === "string" ? row.value : null
    const parsed: unknown = previous ? JSON.parse(previous) : {}
    const original = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
    db.prepare("INSERT INTO organization_feature_settings (organization_id,feature_key,value,updated_at) VALUES ('hps-org-001','daily-logs',?,?) ON CONFLICT(organization_id,feature_key) DO UPDATE SET value=excluded.value").run(JSON.stringify({ ...original, laborCodeDepartments: ["H", "N"] }), new Date().toISOString())
    try {
      await page.goto("/dashboard/settings?section=workflows&workflow=field-cost-codes")
      const section = page.getByRole("region", { name: "Field Mode default cost codes", exact: true })
      await expect(section.getByText(/Enabled departments currently have different crew lists/)).toBeVisible()
      await section.getByRole("button", { name: "Save Field Mode defaults", exact: true }).click()
      await expect(page.getByRole("alertdialog")).toContainText("current department lists will be combined into one shared default list")
      await page.getByRole("button", { name: "Cancel", exact: true }).click()
    } finally {
      if (previous === null) db.prepare("DELETE FROM organization_feature_settings WHERE organization_id='hps-org-001' AND feature_key='daily-logs'").run()
      else db.prepare("UPDATE organization_feature_settings SET value=? WHERE organization_id='hps-org-001' AND feature_key='daily-logs'").run(previous)
      db.close()
    }
  })

  test("project additions persist, remain isolated, and can be removed", async ({ page }) => {
    await page.goto(`/dashboard/projects/${projectId}/information`)
    const section = page.getByRole("region", { name: "Additional Field Mode cost codes", exact: true })
    await section.getByRole("combobox", { name: "Add project Field Mode cost code" }).click()
    await page.getByPlaceholder("Search company cost codes...", { exact: true }).fill("48 14 00")
    await page.getByRole("option").filter({ hasText: "48 14 00" }).click()
    await section.getByRole("button", { name: "Add code", exact: true }).click()
    await section.getByRole("button", { name: "Save project additions", exact: true }).click()
    await expect(page.getByRole("alertdialog")).toContainText("Only this project's")
    await page.getByRole("button", { name: "Confirm save", exact: true }).click()
    await expect(page.getByText("Project Field Mode codes saved. Refresh the project in Field Mode.", { exact: true })).toBeVisible()
    await page.reload()
    await expect(section.getByRole("button", { name: "Remove 48 14 00 from project additions", exact: true })).toBeVisible()
    await page.goto(`/dashboard/projects/${peerId}/information`)
    await expect(section.getByText("No additional codes. This project follows its included defaults and duties.", { exact: true })).toBeVisible()
    await page.goto(`/dashboard/projects/${projectId}/information`)
    await section.getByRole("button", { name: "Remove project additions", exact: true }).click()
    await page.getByRole("button", { name: "Confirm reset", exact: true }).click()
    await expect(section.getByRole("button", { name: "Remove 48 14 00 from project additions", exact: true })).toHaveCount(0)
  })
})
