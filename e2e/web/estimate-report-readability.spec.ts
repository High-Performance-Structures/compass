import Database from "better-sqlite3"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

test("estimate reports save optional breakdowns and show readable group scopes and totals", async ({
  page,
  baseURL,
}, testInfo) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    "Uses an isolated local estimate fixture."
  )
  test.setTimeout(120000)
  const id = "e2e-report-readability-" + testInfo.project.name
  const db = new Database(resolve(process.env.LOCAL_DB_PATH ?? "local.db"))
  const now = new Date().toISOString()
  try {
    db.prepare("DELETE FROM project_estimates WHERE id = ?").run(id)
    db.prepare(
      "INSERT INTO project_estimates (id, project_id, estimate_number, title, client_report_mode, direct_cost_cents, builder_fee_cents, estimate_total_cents, created_at, updated_at) VALUES (?, 'e2e-project-001', ?, 'Report readability regression', 'assembly_items', 3000, 300, 3300, ?, ?)"
    ).run(id, id, now, now)
    db.prepare(
      "INSERT INTO project_estimate_assemblies (id, estimate_id, name, description, created_at, updated_at) VALUES (?, ?, 'Foundation phase', 'Foundation walls and concrete placement scope.', ?, ?)"
    ).run(id + "-assembly", id, now, now)
    db.prepare(
      "INSERT INTO project_estimate_phase_descriptions (id, project_id, estimate_id, division_code, description, created_at, updated_at) VALUES (?, 'e2e-project-001', ?, '03', 'Concrete foundations and placement division scope.', ?, ?)"
    ).run(id + "-scope", id, now, now)
    for (const [suffix, amount] of [
      ["a", 1000],
      ["b", 2000],
    ] as const) {
      db.prepare(
        "INSERT INTO project_estimate_lines (id, project_id, estimate_id, assembly_id, division_code, division_name, cost_code, cost_code_name, description, unit_cost_cents, direct_cost_cents, line_total_cents, created_at, updated_at) VALUES (?, 'e2e-project-001', ?, ?, '03', 'Concrete', '03 30 00', 'Concrete', ?, ?, ?, ?, ?, ?)"
      ).run(
        id + suffix,
        id,
        id + "-assembly",
        "Customer parent scope " + suffix,
        amount,
        amount,
        amount,
        now,
        now
      )
    }
    db.prepare(
      "INSERT INTO project_estimate_line_cost_items (id, project_id, estimate_id, estimate_line_id, division_code, division_name, cost_code, cost_code_name, description, unit_cost_cents, direct_cost_cents, line_total_cents, created_at, updated_at) VALUES (?, 'e2e-project-001', ?, ?, '03', 'Concrete', '03 30 00', 'Placement labor breakdown', 'Underlying labor detail', 1000, 1000, 1000, ?, ?)"
    ).run(id + "-cost", id, id + "a", now, now)
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
    const chooseArea = async (name: RegExp): Promise<void> => {
      await workOn.click()
      await page.getByRole("option", { name }).click()
    }
    await expect(
      page.getByRole("heading", { name: "CSI estimate", exact: true })
    ).toBeVisible()
    await expect(
      page.getByLabel("Client report introduction", { exact: true })
    ).not.toBeVisible()
    await expect(
      page.getByRole("link", { name: "Client report preview", exact: true })
    ).toBeVisible()
    await chooseArea(/^Introduction & closing/)
    await page
      .getByLabel("Client report introduction", { exact: true })
      .fill("Unfinished introduction kept across areas.")
    await chooseArea(/^Contract terms & acknowledgements/)
    await page
      .getByLabel("Pertinent contract terms")
      .fill("Saved terms kept across areas.")
    await chooseArea(/^Contract signers/)
    await page.locator("#companySignerTitle").fill("Project manager")
    await page.locator("#companySignerEmail").fill("invalid-email")
    await chooseArea(/^Estimate details & versions/)
    await page
      .getByLabel("Document name", { exact: true })
      .fill("Estimate area preservation")
    await page.getByLabel("Estimate date").fill("2026-10-01")
    await chooseArea(/^Introduction & closing/)
    await expect(
      page.getByLabel("Client report introduction", { exact: true })
    ).toHaveValue("Unfinished introduction kept across areas.")
    // Native validation must reveal a hidden invalid input, rather than blocking silently.
    await page
      .getByRole("button", { name: "Save draft details", exact: true })
      .click()
    await expect(page.locator("#companySignerEmail")).toBeVisible()
    await page.locator("#companySignerEmail").fill("")
    await chooseArea(/^Introduction & closing/)
    await page
      .getByRole("button", { name: "Save draft details", exact: true })
      .click()
    await expect(
      page.getByText("Estimate details saved.", { exact: true })
    ).toBeVisible()
    await page.reload()
    await chooseArea(/^Introduction & closing/)
    await expect(
      page.getByLabel("Client report introduction", { exact: true })
    ).toHaveValue("Unfinished introduction kept across areas.")
    await chooseArea(/^Contract terms & acknowledgements/)
    await expect(page.getByLabel("Pertinent contract terms")).toHaveValue(
      "Saved terms kept across areas."
    )
    await chooseArea(/^Estimate details & versions/)
    await expect(page.getByLabel("Document name", { exact: true })).toHaveValue(
      "Estimate area preservation"
    )
    await chooseArea(/^Builder fee & markup/)
    await expect(
      page.getByRole("heading", { name: "Apply one line markup", exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "CSI estimate", exact: true })
    ).not.toBeVisible()
    await chooseArea(/^Plans, specifications, and estimate basis/)
    await expect(
      page.getByRole("heading", {
        name: "Plans, specifications, and estimate basis",
        exact: true,
      })
    ).toBeVisible()
    await chooseArea(/^Approval and accounting handoff/)
    await expect(page.getByRole("heading", { name: "Approval and accounting handoff", exact: true })).toBeVisible()
    await chooseArea(/^Group descriptions & report phases/)
    await expect(
      page.getByRole("heading", { name: "Assembly descriptions", exact: true })
    ).toBeVisible()
    await chooseArea(/^Customer report format/)

    const setting = page.getByRole("checkbox", {
      name: /Show cost breakdowns in customer report/,
    })
    await expect(setting).not.toBeChecked()
    await expect(
      page.getByRole("heading", { name: /CSI estimate/ })
    ).not.toBeVisible()
    await preview.goto(report)
    await expect(
      preview.getByText("Underlying labor detail", { exact: true })
    ).toHaveCount(0)
    await expect(preview.locator(".bg-report-heading")).toHaveCSS(
      "background-color",
      "rgb(233, 233, 233)"
    )
    await expect(
      preview.getByText("Project Total:", { exact: true }).locator("..")
    ).toContainText("$33.00")
    await preview.emulateMedia({ media: "print" })
    await expect(preview.locator(".bg-report-heading")).toHaveCSS(
      "background-color",
      "rgb(233, 233, 233)"
    )
    await preview.emulateMedia({ media: "screen" })
    await page.bringToFront()
    await setting.check()
    await page
      .getByRole("button", { name: "Save report view", exact: true })
      .click()
    await expect(
      page.getByText("Client report view saved.", { exact: true })
    ).toBeVisible()
    await page.reload()
    await workOn.click()
    await page.getByRole("option", { name: /^Customer report format/ }).click()
    await expect(setting).toBeChecked()
    await preview.goto(report)
    await expect(
      preview.getByText("Underlying labor detail", { exact: true })
    ).toBeVisible()
    await expect(
      preview.getByText("Project Total:", { exact: true }).locator("..")
    ).toContainText("$33.00")
    for (const [mode, scope, detail] of [
      ["Line items + division totals", "", true],
      [
        "Division subtotals + grand total",
        "Concrete foundations and placement division scope.",
        false,
      ],
      [
        "Assembly totals",
        "Foundation walls and concrete placement scope.",
        false,
      ],
    ] as const) {
      await page.bringToFront()
      await page
        .getByRole("combobox", { name: "Client report presentation" })
        .click()
      await page.getByRole("option", { name: mode, exact: true }).click()
      await page
        .getByRole("button", { name: "Save report view", exact: true })
        .click()
      await expect(
        page.getByText("Client report view saved.", { exact: true })
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: "Save report view", exact: true })
      ).toBeDisabled()
      await preview.goto(report)
      await expect(
        preview.getByText("Underlying labor detail", { exact: true })
      ).toHaveCount(detail ? 1 : 0)
      if (scope)
        await expect(preview.getByText(scope, { exact: true })).toBeVisible()
      await expect(
        preview.getByText("Project Total:", { exact: true }).locator("..")
      ).toContainText("$33.00")
    }
    await page.bringToFront()
    await workOn.click()
    await page.getByRole("option", { name: /^Estimate costs/ }).click()
    await page.getByRole("combobox", { name: "Build estimate by" }).click()
    await page.getByRole("option", { name: "Assembly", exact: true }).click()
    await expect(
      page.locator(".bg-estimate-section").filter({
        has: page.getByRole("heading", {
          name: "Foundation phase",
          exact: true,
        }),
      })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Edit assembly", exact: true })
    ).toBeVisible()
    await workOn.click()
    await page.getByRole("option", { name: /^Customer report format/ }).click()
    await setting.uncheck()
    await page
      .getByRole("button", { name: "Save report view", exact: true })
      .click()
    await expect(
      page.getByText("Client report view saved.", { exact: true })
    ).toBeVisible()
    await page.reload()
    await workOn.click()
    await page.getByRole("option", { name: /^Customer report format/ }).click()
    await expect(setting).not.toBeChecked()
  } finally {
    db.prepare("DELETE FROM project_estimates WHERE id = ?").run(id)
    db.close()
  }
})
