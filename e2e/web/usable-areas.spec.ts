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
    await expect(timezone).toContainText("Pacific (PT)")
    await page.getByRole("button", { name: "Save preferences" }).click()
    await expect(page.getByText("Preferences saved.")).toBeVisible()

    await page.reload()
    await expect(
      page.getByRole("combobox", { name: "Timezone" })
    ).toContainText("Pacific (PT)")
  })

  test("SMS opt-in and permission controls remain available", async ({
    page,
  }) => {
    const path = "/dashboard/settings"
    const response = await page.goto(path)
    await expectHealthyNavigation(page, response, path)

    await expect(page.getByText("Text notifications")).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Send test text" })
    ).toBeVisible()

    await page.getByRole("button", { name: "Permissions" }).click()
    await expect(
      page.getByRole("heading", { name: "Permission Matrix" })
    ).toBeVisible()
    await expect(
      page.getByText("Demo review only", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Open Office Talk" })
    ).toHaveCount(0)
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

  test("project conversation replies enable the explicit send action", async ({
    page,
  }) => {
    const path = "/dashboard/conversations/e2e-channel-001"
    const response = await page.goto(path)
    await expectHealthyNavigation(page, response, path)

    const message = page.getByText("Regression conversation message", {
      exact: true,
    })
    await message.hover()
    await page.getByRole("button", { name: "Reply to message" }).click()

    const threadPanel = page
      .getByRole("heading", { name: "Thread" })
      .locator("..")
      .locator("..")
    const replyEditor = threadPanel.locator('[contenteditable="true"]').last()
    const sendButton = threadPanel.getByRole("button", {
      name: "Send message",
    })

    await expect(replyEditor).toBeVisible()
    await expect(sendButton).toBeDisabled()
    await replyEditor.fill("Unsaved regression reply")
    await expect(sendButton).toBeEnabled()
    await replyEditor.fill("")
    await expect(sendButton).toBeDisabled()
  })

  test("project conversation threads recover from a stale deployment", async ({
    page,
  }) => {
    const path = "/dashboard/conversations/e2e-channel-001"
    const response = await page.goto(path)
    await expectHealthyNavigation(page, response, path)

    let rejectServerActions = false
    await page.route("**/*", async (route) => {
      const request = route.request()
      if (
        rejectServerActions &&
        request.method() === "POST" &&
        request.headers()["next-action"]
      ) {
        await route.fulfill({
          status: 500,
          contentType: "text/plain",
          body:
            'UnrecognizedActionError: Server Action "stale-e2e-action" was not found on the server.',
        })
        return
      }
      await route.continue()
    })

    const message = page.getByText("Regression conversation message", {
      exact: true,
    })
    await message.hover()
    const replyButton = page.getByRole("button", { name: "Reply to message" })
    await expect(replyButton).toBeVisible()
    rejectServerActions = true
    await replyButton.click({ force: true })

    await expect(
      page.getByText(
        "Compass was updated while this conversation was open. Reload to continue replying."
      )
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Reload conversation" })
    ).toBeVisible()
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

    const selectionCheckbox = scheduleRow.getByRole("checkbox", {
      name: "Select Regression Schedule Item",
    })
    await selectionCheckbox.click()
    await expect(selectionCheckbox).toHaveAttribute("aria-checked", "true")
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

  test("published audience schedules stay isolated from drafts and internal links", async ({
    page,
  }) => {
    const internalPath =
      "/dashboard/projects/e2e-project-001/schedule?view=list"
    let response = await page.goto(internalPath)
    await expectHealthyNavigation(
      page,
      response,
      "/dashboard/projects/e2e-project-001/schedule"
    )

    await expect(
      page.getByText("Regression Schedule Item", { exact: true }).first()
    ).toBeVisible()
    await expect(
      page.getByText("Published schedule commitment", { exact: true })
    ).toHaveCount(0)

    const scheduleRow = page.locator("#schedule-item-e2e-schedule-001")
    await scheduleRow.locator('button[title="Edit schedule item"]').click()
    const editDialog = page.getByRole("dialog", {
      name: "Edit Schedule Item",
    })
    await expect(editDialog.getByText("Operational links")).toBeVisible()
    await expect(
      editDialog.getByRole("link", { name: "Internal regression RFI link" })
    ).toBeVisible()

    await page.keyboard.press("Escape")
    const ownerPath =
      "/preview/projects/e2e-project-001/owner/schedule"
    response = await page.goto(ownerPath)
    await expectHealthyNavigation(page, response, ownerPath)
    await expect(
      page.getByText("Published schedule commitment", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByText("Owner-visible published milestone", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByText("Partner-visible published delivery", { exact: true })
    ).toHaveCount(0)
    await expect(
      page.getByText("Regression Schedule Item", { exact: true })
    ).toHaveCount(0)
    await expect(page.getByText("Internal regression RFI link")).toHaveCount(0)
    await expect(page.getByText("Awaiting confirmation")).toBeVisible()
    await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0)

    const partnerPath =
      "/preview/projects/e2e-project-001/sub-vendor/schedule"
    response = await page.goto(partnerPath)
    await expectHealthyNavigation(page, response, partnerPath)
    await expect(
      page.getByText("Published schedule commitment", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByText("Partner-visible published delivery", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByText("Owner-visible published milestone", { exact: true })
    ).toHaveCount(0)
    await expect(
      page.getByText("Regression Schedule Item", { exact: true })
    ).toHaveCount(0)
    await expect(page.getByText("Internal regression RFI link")).toHaveCount(0)
  })

  test("work calendar list shows the actual item title", async ({
    page,
  }) => {
    const response = await page.goto("/dashboard/schedule?view=list")
    await expectHealthyNavigation(page, response, "/dashboard/schedule")

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

  test("work calendar arrows move by the active view period", async ({
    page,
  }) => {
    const periodLabel = page.getByTestId("work-calendar-period-label")

    let response = await page.goto("/dashboard/schedule?view=today")
    await expectHealthyNavigation(page, response, "/dashboard/schedule")
    const initialDay = await periodLabel.innerText()
    await page.getByRole("button", { name: "Events" }).click()
    await page.getByRole("button", { name: "Next day" }).click()
    await expect(periodLabel).not.toHaveText(initialDay)
    await expect(page).toHaveURL(
      /view=today&date=\d{4}-\d{2}-\d{2}&kind=event/
    )
    const nextDayUrl = page.url()
    await page.getByRole("button", { name: "Previous day" }).click()
    await expect(periodLabel).toHaveText(initialDay)
    await expect(page).not.toHaveURL(nextDayUrl)

    response = await page.goto("/dashboard/schedule?view=week")
    await expectHealthyNavigation(page, response, "/dashboard/schedule")
    const initialWeek = await periodLabel.innerText()
    await page.getByRole("button", { name: "Next week" }).click()
    await expect(periodLabel).not.toHaveText(initialWeek)
    await expect(page).toHaveURL(/view=week&date=\d{4}-\d{2}-\d{2}/)
    const nextWeekUrl = page.url()
    await page.getByRole("button", { name: "Previous week" }).click()
    await expect(periodLabel).toHaveText(initialWeek)
    await expect(page).not.toHaveURL(nextWeekUrl)

    response = await page.goto("/dashboard/schedule?view=month")
    await expectHealthyNavigation(page, response, "/dashboard/schedule")
    const initialMonth = await periodLabel.innerText()
    await page.getByRole("button", { name: "Next month" }).click()
    await expect(periodLabel).not.toHaveText(initialMonth)
    await expect(page).toHaveURL(/view=month&date=\d{4}-\d{2}-\d{2}/)
    const nextMonthUrl = page.url()
    await page.getByRole("button", { name: "Previous month" }).click()
    await expect(periodLabel).toHaveText(initialMonth)
    await expect(page).not.toHaveURL(nextMonthUrl)
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
    const response = await page.goto("/dashboard/schedule?view=list")
    await expectHealthyNavigation(page, response, "/dashboard/schedule")

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
