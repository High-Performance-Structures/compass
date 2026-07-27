import { expect, test, type Page, type Response } from "@playwright/test"

const applicationErrorText =
  /Application error|Internal Server Error|This page could not be found/i

const coreAreas = [
  { name: "dashboard", path: "/dashboard" },
  { name: "projects", path: "/dashboard/projects" },
  { name: "work calendar", path: "/dashboard/schedule" },
  { name: "RFIs", path: "/dashboard/rfis" },
  { name: "purchase orders", path: "/dashboard/purchase-orders" },
  { name: "files", path: "/dashboard/files" },
  { name: "contacts", path: "/dashboard/contacts" },
  { name: "financials", path: "/dashboard/financials" },
  { name: "people", path: "/dashboard/people" },
  { name: "conversations", path: "/dashboard/conversations" },
  { name: "settings", path: "/dashboard/settings" },
]

const projectAreas = [
  { name: "overview", suffix: "" },
  { name: "schedule", suffix: "/schedule" },
  { name: "to-dos", suffix: "/todos" },
  { name: "daily logs", suffix: "/daily-logs" },
  { name: "photos", suffix: "/photos" },
  { name: "contacts", suffix: "/contacts" },
  { name: "financials", suffix: "/financials" },
  { name: "budget", suffix: "/budget" },
  { name: "purchase orders", suffix: "/purchase-orders" },
  { name: "RFIs", suffix: "/rfis" },
  { name: "RFQs", suffix: "/rfqs" },
  { name: "selections", suffix: "/selections" },
  { name: "owner updates", suffix: "/owner-updates" },
]

async function enterDemo(page: Page): Promise<void> {
  await page.goto("/demo")
  await page.waitForURL(/\/dashboard/)
  await expect(page.locator("body")).not.toContainText(applicationErrorText)
}

async function expectHealthyNavigation(
  page: Page,
  response: Response | null,
  path: string
): Promise<void> {
  expect(response, `${path} did not return a document response`).not.toBeNull()
  if (!response) return

  expect(
    response.status(),
    `${path} returned HTTP ${response.status()}`
  ).toBeLessThan(400)
  await expect(page).toHaveURL(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  await expect(page.locator("body")).not.toContainText(applicationErrorText)
  await expect(page.locator("body")).not.toBeEmpty()
}

async function findProjectId(page: Page): Promise<string | null> {
  const projectLink = page
    .locator(
      'a[href^="/dashboard/projects/"]' +
        ':not([href^="/dashboard/projects/select"])'
    )
    .first()

  if ((await projectLink.count()) === 0) {
    const response = await page.goto("/dashboard")
    await expectHealthyNavigation(page, response, "/dashboard")
  }

  if ((await projectLink.count()) === 0) {
    if (process.env.PLAYWRIGHT_REQUIRE_PROJECT !== "false") {
      throw new Error("The demo workspace does not expose a project to test")
    }
    return null
  }

  const href = await projectLink.getAttribute("href")
  const match = href?.match(/^\/dashboard\/projects\/([^/?#]+)/)
  if (match?.[1]) return match[1]

  return null
}

test.describe("usable Compass areas", () => {
  test.beforeEach(async ({ page }) => {
    await enterDemo(page)
  })

  test("core areas render without application errors", async ({ page }) => {
    test.slow()

    for (const area of coreAreas) {
      await test.step(area.name, async () => {
        // Isolate each route from background client navigation started by the
        // previous workspace while keeping the authenticated demo context.
        await page.goto("about:blank")
        const response = await page.goto(area.path)
        await expectHealthyNavigation(page, response, area.path)
      })
    }
  })

  test("project workspaces render without application errors", async ({
    page,
  }) => {
    // This test intentionally compiles and opens every project workspace in a
    // single cold dev-server session. Keep the 30-second navigation limit for
    // each route, but give the complete cross-browser sweep a realistic budget.
    test.slow()

    const projectsResponse = await page.goto("/dashboard/projects")
    await expectHealthyNavigation(
      page,
      projectsResponse,
      "/dashboard/projects"
    )
    const projectId = await findProjectId(page)
    if (!projectId) {
      test.skip(true, "The deployed demo has no read-only project fixture")
      return
    }

    for (const area of projectAreas) {
      await test.step(area.name, async () => {
        await page.goto("about:blank")
        const path = `/dashboard/projects/${projectId}${area.suffix}`
        const response = await page.goto(path)
        await expectHealthyNavigation(page, response, path)
      })
    }
  })

  test("timezone preference persists after reloading settings", async ({
    page,
  }) => {
    const path = "/dashboard/settings"
    const response = await page.goto(path)
    await expectHealthyNavigation(page, response, path)

    const timezone = page.getByRole("combobox", { name: "Timezone" })
    await timezone.click()
    await page.getByRole("option", { name: "Pacific (PT)" }).click()
    await page.getByRole("button", { name: "Save preferences" }).click()
    await expect(page.getByText("Preferences saved.")).toBeVisible()

    await page.reload()
    await expect(
      page.getByRole("combobox", { name: "Timezone" })
    ).toContainText("Pacific (PT)")
  })

  test("schedule switches between calendar, list, and Gantt", async ({
    page,
  }) => {
    await page.goto("/dashboard/projects")
    const projectId = await findProjectId(page)
    if (!projectId) {
      test.skip(true, "The deployed demo has no read-only project fixture")
      return
    }
    const schedulePath = `/dashboard/projects/${projectId}/schedule`
    const response = await page.goto(schedulePath)
    await expectHealthyNavigation(page, response, schedulePath)

    for (const view of ["Calendar", "List", "Gantt"]) {
      await test.step(view, async () => {
        const switcher = page.locator("button").filter({ hasText: view }).first()
        await expect(switcher).toBeVisible()
        await switcher.click()
        await expect(page.locator("body")).not.toContainText(applicationErrorText)
      })
    }
  })

  test("schedule list exposes edit and selection actions", async ({ page }) => {
    const path =
      "/dashboard/projects/e2e-project-001/schedule?view=list"
    const response = await page.goto(path)
    await expectHealthyNavigation(
      page,
      response,
      "/dashboard/projects/e2e-project-001/schedule"
    )

    const scheduleRow = page.locator("#schedule-item-e2e-schedule-001")
    await expect(
      scheduleRow
        .getByRole("button", { name: "Edit Regression Schedule Item" })
        .first()
    ).toBeVisible()

    await scheduleRow
      .getByRole("checkbox", { name: "Select Regression Schedule Item" })
      .check()
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Edit selected" })
    ).toBeEnabled()
    await expect(
      page.getByRole("button", { name: "Mark complete" })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Delete selected" })
    ).toBeVisible()

    await page.getByRole("button", { name: "Clear" }).click()
    await expect(page.getByText("1 selected", { exact: true })).toHaveCount(0)
  })

  test("schedule assignee choices include active organization team members", async ({
    page,
  }) => {
    const path =
      "/dashboard/projects/e2e-project-001/schedule?view=list"
    const response = await page.goto(path)
    await expectHealthyNavigation(
      page,
      response,
      "/dashboard/projects/e2e-project-001/schedule"
    )

    const scheduleRow = page.locator("#schedule-item-e2e-schedule-001")
    await scheduleRow.locator('button[title="Edit schedule item"]').click()

    const editDialog = page.getByRole("dialog", {
      name: "Edit Schedule Item",
    })
    await editDialog.getByRole("button", { name: "Demo User" }).click()
    await expect(
      page.getByText("Project & team contacts", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Demo User" })
    ).toHaveCount(2)
  })

  test("work calendar list shows the actual item title", async ({
    page,
  }) => {
    const response = await page.goto("/dashboard/schedule")
    await expectHealthyNavigation(page, response, "/dashboard/schedule")

    await page
      .getByRole("group", { name: "Work calendar view" })
      .getByRole("button", { name: "List" })
      .click()
    const workQueue = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Work Queue" }),
    })
    await expect(
      workQueue.getByText("Regression Schedule Item", {
        exact: true,
      }).first()
    ).toBeVisible()
    await expect(
      workQueue.getByText("Regression follow-up", {
        exact: true,
      }).first()
    ).toBeVisible()
  })

  test("work calendar reveals every item hidden behind the overflow count", async ({
    page,
  }) => {
    const response = await page.goto("/dashboard/schedule?view=month")
    await expectHealthyNavigation(page, response, "/dashboard/schedule")

    const overflowButton = page.getByRole("button", {
      name: /Show \d+ more items for/,
    })
    await expect(overflowButton).toBeVisible()
    await overflowButton.click()

    const dayDialog = page.getByRole("dialog")
    await expect(dayDialog).toContainText("5 work items scheduled for this day")
    for (const title of [
      "Regression Schedule Item",
      "Overflow schedule item two",
      "Overflow schedule item three",
      "Overflow schedule item four",
      "Regression follow-up",
    ]) {
      await expect(dayDialog.getByText(title, { exact: true })).toBeVisible()
    }
  })

  test("work calendar to-dos open and focus the exact project record", async ({
    page,
  }) => {
    const response = await page.goto("/dashboard/schedule")
    await expectHealthyNavigation(page, response, "/dashboard/schedule")

    await page
      .getByRole("group", { name: "Work calendar view" })
      .getByRole("button", { name: "List" })
      .click()
    const todoLink = page
      .getByRole("link", { name: /Regression follow-up/ })
      .first()
    await expect(todoLink).toHaveAttribute(
      "href",
      /\/dashboard\/projects\/e2e-project-001\/todos\?item=e2e-todo-001/
    )
    await todoLink.click()

    await expect(page).toHaveURL(
      /\/dashboard\/projects\/e2e-project-001\/todos\?item=e2e-todo-001/
    )
    const focusedTodo = page.locator(
      'article[data-focused="true"]#todo-e2e-todo-001'
    )
    await expect(focusedTodo).toContainText("Regression follow-up")
    await expect(focusedTodo).toBeFocused()
  })
})
