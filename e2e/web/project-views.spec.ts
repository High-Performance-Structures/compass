import Database from "better-sqlite3"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

test.describe("personal project views", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Uses only synthetic projects in the isolated local database.")
  test.beforeAll(() => {
    if (process.env.PLAYWRIGHT_BASE_URL) return
    const db = new Database(resolve(process.env.LOCAL_DB_PATH ?? ".e2e/compass.db"))
    const now = new Date().toISOString()
    for (const [id, name] of [["hps-org-001", "Test Organization"], ["project-filter-other-org", "Other Organization"]]) {
      db.prepare("INSERT OR IGNORE INTO organizations (id,name,slug,type,created_at,updated_at) VALUES (?,?,?,'internal',?,?)").run(id, name, id, now, now)
    }
    for (const id of ["dev-user-1", "project-filter-colleague"]) {
      db.prepare("INSERT OR IGNORE INTO users (id,email,display_name,role,created_at,updated_at) VALUES (?,?,?,'admin',?,?)").run(id, `${id}@example.test`, id, now, now)
    }
    for (const [id, number, name, status, org] of [
      ["project-filter-h", "H-9901", "Filter Hill", "under_construction", "hps-org-001"],
      ["project-filter-o", "O-9902", "Filter Orchard", "complete", "hps-org-001"],
      ["project-filter-secret", "O-9999", "Filter Secret", "complete", "project-filter-other-org"],
    ]) {
      db.prepare("INSERT OR IGNORE INTO projects (id,project_number,name,job_status_id,organization_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(id, number, name, status, org, now, now)
    }
    const definition = JSON.stringify({ department: "O", status: { kind: "job", jobStatusId: "complete" } })
    db.prepare("INSERT OR IGNORE INTO project_saved_views (id,organization_id,owner_user_id,name,visibility,definition,created_at,updated_at) VALUES ('project-filter-shared','hps-org-001','project-filter-colleague','Filter team completed','shared',?,?,?)").run(definition, now, now)
    db.prepare("DELETE FROM user_view_preferences WHERE user_id='dev-user-1' AND view_key='project-hub-default:hps-org-001'").run()
    db.prepare("DELETE FROM project_saved_views WHERE owner_user_id='dev-user-1' AND name LIKE 'Filter browser%'").run()
    db.close()
  })

  test("defaults persist in page and sidebar; searches cross filters; named views can be edited and deleted", async ({ page, isMobile, browserName }, testInfo) => {
    test.setTimeout(180000)
    const errors: string[] = []
    page.on("pageerror", (error) => {
      // WebKit reports cancelled local Next RSC prefetches during navigation.
      // Keep application errors and every other network error visible.
      if (browserName === "webkit" && /^\/127\.0\.0\.1:\d+\/dashboard(?:\/[^?]*)?\?_rsc=\S+ due to access control checks\.$/.test(error.message)) return
      errors.push(error.message)
    })
    await page.goto("/dashboard/projects")
    const main = page.getByRole("main")
    await main.locator('[data-department-filter="H"]').click()
    await main.getByRole("combobox", { name: "Filter projects by status" }).click()
    await page.getByRole("option").filter({ hasText: "Under Construction" }).click()
    await expect(main.getByText("Filter Hill", { exact: true })).toBeVisible()
    await expect(main.getByText("Filter Orchard", { exact: true })).toHaveCount(0)
    await main.getByRole("button", { name: "Set as default", exact: true }).click()
    await expect(main.getByRole("button", { name: "Your default", exact: true })).toBeVisible()
    await page.reload()
    await expect(main.locator('[data-department-filter="H"]')).toHaveAttribute("aria-pressed", "true")
    await expect(main.getByRole("combobox", { name: "Filter projects by status" })).toContainText("Under Construction")
    await expect(main.getByText("Filter Orchard", { exact: true })).toHaveCount(0)

    const search = main.getByRole("searchbox", { name: "Search all projects" })
    await search.fill("Filter Orchard")
    await expect(main.getByText("Filter Orchard", { exact: true })).toBeVisible()
    await expect(main.getByRole("heading", { name: "Search results", exact: true })).toBeVisible()
    await search.fill("Filter Secret")
    await expect(main.getByText("Filter Secret", { exact: true })).toHaveCount(0)
    await main.getByRole("button", { name: "Clear filters", exact: true }).click()
    await expect(search).toHaveValue("")
    await expect(main.getByText("Filter Orchard", { exact: true })).toBeVisible()
    await main.locator('[data-department-filter="H"]').click()
    await main.getByRole("combobox", { name: "Filter projects by status" }).click()
    await page.getByRole("option").filter({ hasText: "Under Construction" }).click()
    await expect(main.getByText("Filter Hill", { exact: true })).toBeVisible()
    await expect(main.getByText("Filter Orchard", { exact: true })).toHaveCount(0)

    if (isMobile) await page.getByRole("button", { name: "Open menu", exact: true }).click()
    const sidebar = isMobile ? page.locator('[data-sidebar="sidebar"][data-mobile="true"]') : page.locator('[data-slot="sidebar-inner"]')
    await sidebar.getByRole("combobox", { name: "Switch project", exact: true }).click()
    await expect(page.getByRole("option").filter({ hasText: "Filter Hill" })).toBeVisible()
    await expect(page.getByRole("option").filter({ hasText: "Filter Orchard" })).toHaveCount(0)
    const pickerSearch = page.getByPlaceholder("Search number, name, or client...", { exact: true })
    await pickerSearch.fill("Filter Orchard")
    await expect(page.getByRole("option").filter({ hasText: "Filter Orchard" })).toBeVisible()
    await pickerSearch.fill("Filter Secret")
    await expect(page.getByRole("option").filter({ hasText: "Filter Secret" })).toHaveCount(0)
    await pickerSearch.fill("")
    await expect(page.getByRole("option").filter({ hasText: "Filter Hill" })).toBeVisible()
    await pickerSearch.press("Escape")
    if (isMobile) {
      await expect(pickerSearch).toHaveCount(0)
      const mobileSidebar = page.getByRole("dialog", { name: "Sidebar", exact: true })
      await mobileSidebar.press("Escape")
      await expect(mobileSidebar).toHaveCount(0)
    }

    await main.getByRole("button", { name: /Save.*manage|Save view/ }).click()
    const dialog = page.getByRole("dialog", { name: "Save project view", exact: true })
    await dialog.getByLabel("View name", { exact: true }).fill("Filter browser construction")
    await dialog.getByRole("checkbox", { name: "Share with internal staff in my organization" }).check()
    await dialog.getByRole("button", { name: "Save view", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await main.getByRole("button", { name: /Save.*manage/ }).click()
    await page.getByRole("button", { name: "Edit Filter browser construction", exact: true }).click()
    const edit = page.getByRole("dialog", { name: "Edit project view", exact: true })
    await edit.getByLabel("View name", { exact: true }).fill("Filter browser renamed")
    await edit.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(edit).toHaveCount(0)

    await main.getByRole("combobox", { name: "Saved project views" }).click()
    await page.getByRole("option").filter({ hasText: "Filter team completed" }).click()
    await expect(main.getByText("Filter Orchard", { exact: true })).toBeVisible()
    await expect(main.getByRole("button", { name: "Set as default", exact: true })).toBeVisible()
    await main.getByRole("button", { name: /Save.*manage/ }).click()
    await expect(page.getByRole("button", { name: "Edit Filter team completed", exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "Delete Filter browser renamed", exact: true }).click()
    const confirmation = page.getByRole("alertdialog")
    await expect(confirmation).toContainText("Personal defaults already saved from it will stay in place.")
    await confirmation.getByRole("button", { name: "Delete view", exact: true }).click()
    await expect(confirmation).toHaveCount(0)
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click()
    await page.reload()
    await expect(main.getByText("Filter Hill", { exact: true })).toBeVisible()
    await expect(main.getByText("Filter Orchard", { exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath("project-default-view.png"), fullPage: true })
    expect(errors).toEqual([])
  })

  test("an empty default remains searchable and the active project stays in the picker", async ({ page, isMobile }) => {
    await page.goto("/dashboard/projects")
    const main = page.getByRole("main")
    await main.locator('[data-department-filter="D"]').click()
    await main.getByRole("button", { name: "Set as default", exact: true }).click()
    await expect(main.getByRole("button", { name: "Your default", exact: true })).toBeVisible()
    await main.getByRole("searchbox", { name: "Search all projects" }).fill("Filter Orchard")
    await expect(main.getByText("Filter Orchard", { exact: true })).toBeVisible()
    await main.getByRole("searchbox", { name: "Search all projects" }).fill("")
    await expect(main.getByText("Filter Orchard", { exact: true })).toHaveCount(0)
    if (isMobile) await page.getByRole("button", { name: "Open menu", exact: true }).click()
    const sidebar = isMobile ? page.locator('[data-sidebar="sidebar"][data-mobile="true"]') : page.locator('[data-slot="sidebar-inner"]')
    const trigger = sidebar.getByRole("combobox", { name: "Switch project", exact: true })
    await expect(trigger).toBeEnabled()
    await trigger.click()
    await expect(page.getByRole("option")).toHaveCount(0)
    const search = page.getByPlaceholder("Search number, name, or client...", { exact: true })
    await search.fill("Filter Orchard")
    await expect(page.getByRole("option").filter({ hasText: "Filter Orchard" })).toBeVisible()
    await search.fill("")
    await expect(page.getByRole("option")).toHaveCount(0)
    await page.evaluate(() => window.localStorage.setItem("compass.activeProjectId", "project-filter-o"))
    await page.reload()
    if (isMobile) await page.getByRole("button", { name: "Open menu", exact: true }).click()
    await expect(trigger).toContainText("Filter Orchard")
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByRole("option").filter({ hasText: "Filter Orchard" })).toBeVisible()
    await expect(page.getByText(/Showing 0 of .*your default view/)).toBeVisible()
  })

  test("workflow-specific pickers keep browsing all accessible projects", async ({ page }) => {
    await page.goto("/dashboard/projects")
    const main = page.getByRole("main")
    await main.locator('[data-department-filter="D"]').click()
    if (await main.getByRole("button", { name: "Set as default", exact: true }).isVisible()) {
      await main.getByRole("button", { name: "Set as default", exact: true }).click()
    }
    await expect(main.getByRole("button", { name: "Your default", exact: true })).toBeVisible()
    await page.goto("/dashboard/rfis")
    await page.getByRole("combobox", { name: "Switch project", exact: true }).filter({ hasText: "Search projects for RFIs" }).click()
    await expect(page.getByRole("option").filter({ hasText: "Filter Hill" })).toBeVisible()
    await expect(page.getByRole("option").filter({ hasText: "Filter Orchard" })).toBeVisible()
    await expect(page.getByRole("option").filter({ hasText: "Filter Secret" })).toHaveCount(0)
  })
})
