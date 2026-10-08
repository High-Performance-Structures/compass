import Database from "better-sqlite3"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

test("assembly reports optionally show builder-fee subtotals without changing project totals", async ({
  page,
  baseURL,
}, testInfo) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    "Uses an isolated local estimate fixture."
  )
  test.setTimeout(120000)
  const id = "e2e-assembly-fees-" + testInfo.project.name
  const db = new Database(resolve(process.env.LOCAL_DB_PATH ?? "local.db"))
  const now = new Date().toISOString()
  try {
    db.prepare("DELETE FROM project_estimates WHERE id = ?").run(id)
    db.prepare("INSERT INTO project_estimates (id, project_id, estimate_number, title, client_report_mode, direct_cost_cents, builder_fee_base_cents, overhead_rate_basis_points, overhead_cents, margin_rate_basis_points, margin_cents, contingency_rate_basis_points, contingency_cents, builder_fee_cents, estimate_total_cents, created_at, updated_at) VALUES (?, 'e2e-project-001', ?, 'Assembly fee regression', 'assembly_summary', 3000, 1000, 1000, 100, 1000, 100, 1000, 100, 300, 3300, ?, ?)").run(id, id, now, now)
    for (const [suffix, name, amount, eligible] of [
      ["a", "Foundation phase", 1000, 1],
      ["b", "Excluded work", 2000, 0],
    ] as const) {
      db.prepare("INSERT INTO project_estimate_assemblies (id, estimate_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id + suffix, id, name, now, now)
      db.prepare("INSERT INTO project_estimate_lines (id, project_id, estimate_id, assembly_id, division_code, division_name, cost_code, cost_code_name, description, unit_cost_cents, direct_cost_cents, line_total_cents, include_in_builder_fee, created_at, updated_at) VALUES (?, 'e2e-project-001', ?, ?, '03', 'Concrete', '03 30 00', 'Concrete', ?, ?, ?, ?, ?, ?, ?)").run(id + "-line-" + suffix, id, id + suffix, name + " scope", amount, amount, amount, eligible, now, now)
    }
    if (!baseURL) throw new Error("A local test URL is required.")
    await page
      .context()
      .addCookies([{ name: "compass-demo", value: "true", url: baseURL }])
    const editor =
      "/dashboard/projects/e2e-project-001/estimate?estimateId=" + id
    const report = "/print/projects/e2e-project-001/estimate?estimateId=" + id
    const preview = await page.context().newPage()
    await page.bringToFront()
    await page.goto(editor)
    const workOn = page.getByRole("combobox", { name: "Work on", exact: true })
    await workOn.click()
    await page.getByRole("option", { name: /^Customer report format/ }).click()
    const setting = page.getByRole("checkbox", {
      name: /Show builder-fee subtotal for each assembly/,
    })
    await expect(setting).not.toBeChecked()
    await setting.check()
    await page
      .getByRole("button", { name: "Save report view", exact: true })
      .click()
    await expect(
      page.getByText("Client report view saved.", { exact: true })
    ).toBeVisible()
    await expect(setting).toBeEnabled()
    await page.reload()
    await workOn.click()
    await page.getByRole("option", { name: /^Customer report format/ }).click()
    await expect(setting).toBeChecked()

    for (const mode of ["Assembly totals", "Assembly cost code detail"]) {
      if (mode === "Assembly cost code detail") {
        await page.bringToFront()
        await page.getByRole("combobox", { name: "Client report presentation" }).click()
        await page.getByRole("option", { name: mode, exact: true }).click()
        await page.getByRole("button", { name: "Save report view", exact: true }).click()
        await expect(page.getByText("Client report view saved.", { exact: true })).toBeVisible()
      }
      await preview.goto(report)
      const assemblies = preview.getByRole("region", {
        name: "Project work by assembly",
      })
      await expect(
        assemblies.getByText("Builder-fee subtotal", { exact: true })
      ).toHaveCount(2)
      await expect(assemblies).toContainText("$3.00")
      await expect(assemblies).toContainText("$0.00")
      await expect(assemblies).toContainText("$13.00")
      await expect(assemblies).toContainText("$20.00")
      await expect(preview.getByText("Project Total:", { exact: true }).locator("..")).toContainText("$33.00")
      await expect(
        preview.getByText(/these fees are charged once/)
      ).toBeVisible()
    }

    await page.bringToFront()
    await expect(setting).toBeEnabled()
    await setting.uncheck()
    await page
      .getByRole("button", { name: "Save report view", exact: true })
      .click()
    await expect(
      page.getByText("Client report view saved.", { exact: true })
    ).toBeVisible()
    await preview.goto(report)
    await expect(
      preview.getByText("Builder-fee subtotal", { exact: true })
    ).toHaveCount(0)
    await expect(preview.getByText("Project Total:", { exact: true }).locator("..")).toContainText("$33.00")
  } finally {
    db.prepare("DELETE FROM project_estimates WHERE id = ?").run(id)
    db.close()
  }
})
