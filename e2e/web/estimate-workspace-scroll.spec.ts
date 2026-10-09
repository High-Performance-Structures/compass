import Database from "better-sqlite3"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

test("long estimates keep the dashboard frame stationary while opening and focusing line editors", async ({ page, baseURL }, testInfo) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Uses an isolated local estimate fixture.")
  test.setTimeout(120000)
  const id = "e2e-estimate-scroll-" + testInfo.project.name
  const db = new Database(resolve(process.env.LOCAL_DB_PATH ?? "local.db"))
  const now = new Date().toISOString()
  try {
    db.prepare("DELETE FROM project_estimates WHERE id = ?").run(id)
    db.prepare("INSERT INTO project_estimates (id, project_id, estimate_number, title, created_at, updated_at) VALUES (?, 'e2e-project-001', ?, 'Long estimate scroll regression', ?, ?)").run(id, id, now, now)
    db.prepare("INSERT INTO project_estimate_assemblies (id, estimate_id, name, created_at, updated_at) VALUES (?, ?, 'Long assembly', ?, ?)").run(id + "-assembly", id, now, now)
    const insertLine = db.prepare("INSERT INTO project_estimate_lines (id, project_id, estimate_id, assembly_id, division_code, division_name, cost_code, cost_code_name, description, sort_order, created_at, updated_at) VALUES (?, 'e2e-project-001', ?, ?, '03', 'Concrete', '03 30 00', 'Concrete', ?, ?, ?, ?)")
    for (let index = 0; index < 80; index += 1) {
      insertLine.run(id + "-" + index, id, id + "-assembly", "Concrete scope " + index, index, now, now)
    }
    if (!baseURL) throw new Error("A local URL is required.")
    await page.context().addCookies([{ name: "compass-demo", value: "true", url: baseURL }])
    await page.goto("/dashboard/projects/e2e-project-001/estimate?estimateId=" + id)
    const frame = page.locator('[data-slot="sidebar-inset"]')
    const frameTop = await frame.evaluate((element) => element.getBoundingClientRect().top)
    const description = page.getByLabel("Description", { exact: true })
    const specifications = page.getByLabel("Specifications / scope notes", { exact: true })
    for (const view of ["Assembly", "Division / cost code"]) {
      await page.getByRole("combobox", { name: "Build estimate by" }).click()
      await page.getByRole("option", { name: view, exact: true }).click()
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.locator(`[data-estimate-line-id="${id}-0"]`).getByRole("button", { name: "Edit", exact: true }).click()
        await expect(description).toBeFocused()
        // Smooth scrolling settles at the editor without moving a hidden ancestor.
        await expect(description).toBeInViewport()
        await specifications.click()
        await specifications.fill("Draft scope remains accessible while editing.")
        await page.getByLabel("Unit cost", { exact: true }).click()
        await expect.poll(() => frame.evaluate((element) => element.scrollTop)).toBe(0)
        await expect.poll(() => frame.evaluate((element) => element.getBoundingClientRect().top)).toBe(frameTop)
        const unitCost = page.getByLabel("Unit cost", { exact: true })
        await expect.poll(() => unitCost.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          const viewport = element.ownerDocument.documentElement.clientHeight
          return rect.top >= 0 && rect.bottom <= viewport
        })).toBe(true)
      }
    }
    // Scrolling back to an earlier row remains possible without a refresh.
    await page.locator(`[data-estimate-line-id="${id}-0"]`).getByRole("button", { name: "Insert below", exact: true }).click()
    await expect(description).toBeFocused()
    await expect(description).toBeInViewport()
    await expect.poll(() => frame.evaluate((element) => element.scrollTop)).toBe(0)
    await page.screenshot({ path: testInfo.outputPath("estimate-editor-stationary.png") })
  } finally {
    db.prepare("DELETE FROM project_estimates WHERE id = ?").run(id)
    db.close()
  }
})
