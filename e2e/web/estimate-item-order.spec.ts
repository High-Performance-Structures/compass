import Database from "better-sqlite3"
import { resolve } from "node:path"
import { expect, test, type Locator } from "@playwright/test"

test("estimate items reorder within divisions and assemblies and persist in customer reports", async ({ page, baseURL }, testInfo) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Uses an isolated local estimate fixture.")
  test.setTimeout(120000)
  const id = "e2e-item-order-" + testInfo.project.name
  const db = new Database(resolve(process.env.LOCAL_DB_PATH ?? "local.db"))
  const now = new Date().toISOString()
  try {
    db.prepare("DELETE FROM project_estimates WHERE id = ?").run(id)
    db.prepare("INSERT INTO project_estimates (id, project_id, estimate_number, title, client_report_mode, show_cost_breakdowns, direct_cost_cents, estimate_total_cents, created_at, updated_at) VALUES (?, 'e2e-project-001', ?, 'Item ordering regression', 'assembly_items', 1, 6000, 6000, ?, ?)").run(id, id, now, now)
    db.prepare("INSERT INTO project_estimate_assemblies (id, estimate_id, name, created_at, updated_at) VALUES (?, ?, 'Foundation phase', ?, ?)").run(id + "-phase", id, now, now)
    for (const [suffix, division, code, scope, position] of [
      ["a", "03", "03-10", "Concrete walls", 0],
      ["b", "31", "31-1", "Site excavation", 1],
      ["c", "03", "03-2", "Concrete footings", 2],
    ] as const) {
      db.prepare("INSERT INTO project_estimate_lines (id, project_id, estimate_id, assembly_id, division_code, division_name, cost_code, cost_code_name, description, unit_cost_cents, direct_cost_cents, line_total_cents, sort_order, created_at, updated_at) VALUES (?, 'e2e-project-001', ?, ?, ?, ?, ?, ?, ?, 2000, 2000, 2000, ?, ?, ?)")
        .run(id + suffix, id, id + "-phase", division, division === "03" ? "Concrete" : "Earthwork", code, scope, scope, position, now, now)
    }
    db.prepare("INSERT INTO project_estimate_line_cost_items (id, project_id, estimate_id, estimate_line_id, division_code, division_name, cost_code, cost_code_name, description, unit_cost_cents, direct_cost_cents, line_total_cents, created_at, updated_at) VALUES (?, 'e2e-project-001', ?, ?, '03', 'Concrete', '03-10', 'Labor', 'Wall placement labor', 2000, 2000, 2000, ?, ?)").run(id + "-cost", id, id + "a", now, now)
    if (!baseURL) throw new Error("A local URL is required.")
    await page.context().addCookies([{ name: "compass-demo", value: "true", url: baseURL }])
    const editor = "/dashboard/projects/e2e-project-001/estimate?estimateId=" + id
    const report = "/print/projects/e2e-project-001/estimate?estimateId=" + id
    // Warm the print route before manipulating the editor on a development server.
    const preview = await page.context().newPage()
    await preview.goto(report)
    await page.goto(editor)
    const workOn = page.getByRole("combobox", { name: "Work on", exact: true })
    await workOn.click()
    await page.getByRole("option", { name: /^Introduction & closing/ }).click()
    await page.getByLabel("Client report introduction", { exact: true }).fill("Unfinished text survives reordering.")
    await workOn.click()
    await page.getByRole("option", { name: /^Estimate costs/ }).click()
    const division = page.getByRole("group", { name: "03 · Concrete items", exact: true })
    const assertOrder = async (group: Locator, suffixes: readonly string[]): Promise<void> => {
      await expect.poll(async () => group.locator("[data-estimate-line-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-estimate-line-id")))).toEqual(suffixes.map((suffix) => id + suffix))
      await expect(group).toHaveAttribute("aria-busy", "false")
    }
    await assertOrder(division, ["a", "c"])
    await expect(division.getByRole("button", { name: /Move 03-10.* up/ })).toBeDisabled()
    await division.getByRole("button", { name: "Sort 03 · Concrete by cost code", exact: true }).click()
    await assertOrder(division, ["c", "a"])
    await workOn.click()
    await page.getByRole("option", { name: /^Introduction & closing/ }).click()
    await expect(page.getByLabel("Client report introduction", { exact: true })).toHaveValue("Unfinished text survives reordering.")
    await page.reload()
    await assertOrder(division, ["c", "a"])
    await division.locator(`[data-estimate-line-id="${id}a"]`).getByRole("button", { name: /1 breakdown cost code/ }).click()
    await division.getByRole("button", { name: /Move 03-10.* up/ }).click()
    await assertOrder(division, ["a", "c"])
    await expect(division.getByText("Wall placement labor", { exact: true })).toBeVisible()
    // Move up/down works on touch devices, and dragging remains on the handle.
    await division.getByRole("button", { name: /Move 03-10.* down/ }).click()
    await assertOrder(division, ["c", "a"])
    await page.getByRole("combobox", { name: "Build estimate by" }).click()
    await page.getByRole("option", { name: "Assembly", exact: true }).click()
    const assembly = page.getByRole("group", { name: "Foundation phase items", exact: true })
    await assertOrder(assembly, ["c", "b", "a"])
    await assembly.getByRole("button", { name: "Sort Foundation phase by cost code", exact: true }).click()
    await assertOrder(assembly, ["c", "a", "b"])
    if (!testInfo.project.name.startsWith("mobile")) {
      const handle = assembly.getByRole("button", { name: /Drag to reorder 31-1/ })
      const target = assembly.locator(`[data-estimate-line-id="${id}c"]`)
      await handle.scrollIntoViewIfNeeded()
      const start = await handle.boundingBox()
      const end = await target.boundingBox()
      if (!start || !end) throw new Error("Drag rows must be visible.")
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
      await page.mouse.down()
      await page.mouse.move(start.x + start.width / 2, start.y - 10, { steps: 3 })
      await page.mouse.move(start.x + start.width / 2, end.y + end.height / 2, { steps: 12 })
      await page.mouse.up()
      await assertOrder(assembly, ["b", "c", "a"])
    } else {
      await assembly.getByRole("button", { name: /Move 31-1.* up/ }).click()
      await assertOrder(assembly, ["c", "b", "a"])
      await assembly.getByRole("button", { name: /Move 31-1.* up/ }).click()
      await assertOrder(assembly, ["b", "c", "a"])
    }
    await page.reload()
    await page.getByRole("combobox", { name: "Build estimate by" }).click()
    await page.getByRole("option", { name: "Assembly", exact: true }).click()
    await assertOrder(assembly, ["b", "c", "a"])
    await assembly.screenshot({ path: testInfo.outputPath("ordered-estimate.png") })
    await preview.goto(report)
    const reportScopes = preview.locator(".bg-report-heading").locator("..").locator("tbody > tr")
    await expect(reportScopes).toHaveCount(5)
    await expect(reportScopes.nth(0)).toContainText("Site excavation")
    await expect(reportScopes.nth(1)).toContainText("Concrete footings")
    await expect(reportScopes.nth(2)).toContainText("Concrete walls")
    await expect(reportScopes.nth(4)).toContainText("Wall placement labor")
    await expect(preview.getByText("Project Total:", { exact: true }).locator("..")).toContainText("$60.00")
    await workOn.click()
    await page.getByRole("option", { name: /^Customer report format/ }).click()
    await page.getByRole("combobox", { name: "Client report presentation" }).click()
    await page.getByRole("option", { name: "Line items + division totals", exact: true }).click()
    await page.getByRole("button", { name: "Save report view", exact: true }).click()
    await expect(page.getByRole("button", { name: "Save report view", exact: true })).toBeDisabled()
    await preview.goto(report)
    const concreteTable = preview.locator(".bg-report-heading").filter({ hasText: "Concrete" }).locator("..").locator("tbody")
    await expect(concreteTable.locator("tr").nth(0)).toContainText("Concrete footings")
    await expect(concreteTable.locator("tr").nth(1)).toContainText("Concrete walls")
    await expect(preview.getByText("Project Total:", { exact: true }).locator("..")).toContainText("$60.00")
    expect(db.prepare("SELECT SUM(line_total_cents) AS total FROM project_estimate_lines WHERE estimate_id = ?").get(id)).toEqual({ total: 6000 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM project_estimate_lines WHERE estimate_id = ? AND assembly_id = ?").get(id, id + "-phase")).toEqual({ count: 3 })
  } finally {
    db.prepare("DELETE FROM project_estimates WHERE id = ?").run(id)
    db.close()
  }
})
