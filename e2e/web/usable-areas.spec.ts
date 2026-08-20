import { expect, test, type Page, type Response } from "@playwright/test"

const applicationErrorText =
  /Application error|Internal Server Error|This page could not be found/i

const coreAreas = [
  { name: "dashboard", path: "/dashboard" },
  { name: "projects", path: "/dashboard/projects" },
  { name: "client follow-up", path: "/dashboard/projects/follow-up" },
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
  { name: "project information", suffix: "/information" },
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
        // Keep the authenticated browser context while giving each workspace a
        // page that cannot be interrupted by the previous route's client work.
        const isolatedPage = await page.context().newPage()
        try {
          const response = await isolatedPage.goto(area.path)
          await expectHealthyNavigation(isolatedPage, response, area.path)
        } finally {
          await isolatedPage.close()
        }
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
        const path = `/dashboard/projects/${projectId}${area.suffix}`
        const isolatedPage = await page.context().newPage()
        try {
          const response = await isolatedPage.goto(path)
          await expectHealthyNavigation(isolatedPage, response, path)
        } finally {
          await isolatedPage.close()
        }
      })
    }
  })

  test("project information and client follow-up workspaces render", async ({ page }) => {
    const projectsResponse = await page.goto("/dashboard/projects")
    await expectHealthyNavigation(page, projectsResponse, "/dashboard/projects")
    const projectId = await findProjectId(page)
    if (!projectId) {
      test.skip(true, "The deployed demo has no read-only project fixture")
      return
    }

    for (const path of [
      `/dashboard/projects/${projectId}/information`,
      "/dashboard/projects/follow-up",
    ]) {
      const response = await page.goto(path)
      await expectHealthyNavigation(page, response, path)
    }
  })

  test("project information explains approved job-status selection", async ({ page }) => {
    const projectsResponse = await page.goto("/dashboard/projects")
    await expectHealthyNavigation(page, projectsResponse, "/dashboard/projects")
    const projectId = await findProjectId(page)
    if (!projectId) {
      test.skip(true, "The demo workspace does not expose a project to test")
      return
    }

    const response = await page.goto(`/dashboard/projects/${projectId}/information`)
    await expectHealthyNavigation(page, response, `/dashboard/projects/${projectId}/information`)
    await expect(page.getByRole("combobox", { name: "Approved job status" })).toBeVisible()
    await expect(page.getByText(/Choose the approved operational stage for this project/)).toBeVisible()
  })

  test("timezone preference persists after reloading settings", async ({ page }) => {
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
    const schedulePath = "/dashboard/projects/e2e-project-001/schedule"
    const response = await page.goto(schedulePath)
    await expectHealthyNavigation(page, response, schedulePath)

    for (const view of ["Calendar", "List", "Gantt"] as const) {
      await test.step(view, async () => {
        await page.getByRole("button", { name: "Schedule view" }).click()
        const option = page.getByRole("menuitemradio", { name: view })
        await expect(option).toBeVisible()
        await option.click()
        await page.waitForURL(
          (url) => url.searchParams.get("view") === view.toLowerCase()
        )
        await expect(page.locator("body")).not.toContainText(applicationErrorText)
      })
    }
  })

  test("Schedule keeps controls compact and gives views a scrollable workspace", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 700 })
    const path = "/dashboard/projects/e2e-project-001/schedule?view=list"
    const response = await page.goto(path)
    await expectHealthyNavigation(page, response, "/dashboard/projects/e2e-project-001/schedule")

    const scrollRegion = page.locator(
      '[data-dashboard-scroll-region="schedule"]:visible'
    )
    await expect(scrollRegion).toHaveCSS("overflow-y", "auto")

    const controls = page.locator("[data-schedule-controls]:visible")
    await expect(controls).toBeVisible()
    const controlHeight = await controls.evaluate((element) => element.clientHeight)
    expect(controlHeight).toBeLessThanOrEqual(40)
    await expect(scrollRegion).toHaveCSS("overflow-x", "auto")

    const projectSwitcher = page.getByRole("combobox", {
      name: "Switch project",
    })
    await expect(projectSwitcher).toBeVisible()
    expect(
      await projectSwitcher.evaluate((element) => {
        const row = element.closest("[data-schedule-controls]")
        if (!row) return false
        const rowBounds = row.getBoundingClientRect()
        const controlBounds = element.getBoundingClientRect()
        return (
          controlBounds.top >= rowBounds.top &&
          controlBounds.bottom <= rowBounds.bottom
        )
      })
    ).toBe(true)

    const listActions = page.locator("[data-schedule-list-actions]:visible")
    await expect(listActions).toBeVisible()
    await expect(listActions).toHaveCSS("border-top-width", "0px")
    await expect(listActions).toHaveCSS("padding-top", "0px")

    const workspace = page.locator("[data-schedule-workspace]:visible")
    await expect(workspace).toBeVisible()
    const workspaceHeight = await workspace.evaluate((element) => element.clientHeight)
    expect(workspaceHeight).toBeGreaterThanOrEqual(460)
    expect(
      await scrollRegion.evaluate(
        (element) => element.scrollHeight > element.clientHeight
      )
    ).toBe(true)
  })

  test("Schedule gives a resized browser a longer scrollable workspace", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 700 })
    const path = "/dashboard/projects/e2e-project-001/schedule?view=list"
    const response = await page.goto(path)
    await expectHealthyNavigation(
      page,
      response,
      "/dashboard/projects/e2e-project-001/schedule"
    )

    const scrollRegion = page.locator(
      '[data-dashboard-scroll-region="schedule"]:visible'
    )
    const workspace = page.locator("[data-schedule-workspace]:visible")
    await expect(scrollRegion).toHaveCSS("overflow-x", "auto")
    await expect(workspace).toBeVisible()

    const scrollRange = await scrollRegion.evaluate((element) => ({
      horizontal: element.scrollWidth - element.clientWidth,
      vertical: element.scrollHeight - element.clientHeight,
      clientHeight: element.clientHeight,
    }))
    expect(scrollRange.vertical).toBeGreaterThanOrEqual(
      scrollRange.clientHeight
    )
    expect(scrollRange.horizontal).toBeGreaterThan(0)

    const regionBox = await scrollRegion.boundingBox()
    expect(regionBox).not.toBeNull()
    if (!regionBox) return

    await scrollRegion.evaluate((element) => {
      element.scrollLeft = 0
      element.scrollTop = 0
    })
    await page.mouse.move(regionBox.x + 5, regionBox.y + 5)
    await page.mouse.wheel(240, 0)
    await expect
      .poll(() => scrollRegion.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0)

    await page.mouse.wheel(0, 900)
    await expect
      .poll(() => scrollRegion.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0)
  })

  test("Global project schedules expose header actions through outer scrolling", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 700 })
    const path =
      "/dashboard/schedule?mode=projects&scope=project&view=gantt&order=chronological&project=e2e-project-001"
    const response = await page.goto(path)
    await expectHealthyNavigation(page, response, "/dashboard/schedule")

    const scrollRegion = page.locator(
      '[data-dashboard-scroll-region="schedule"]:visible'
    )
    const newScheduleItem = page.getByRole("button", {
      name: "New Schedule Item",
    })
    await expect(newScheduleItem).toBeVisible()

    const regionBox = await scrollRegion.boundingBox()
    expect(regionBox).not.toBeNull()
    if (!regionBox) return

    await page.mouse.move(regionBox.x + 5, regionBox.y + 5)
    await page.mouse.wheel(1_200, 0)
    await expect
      .poll(() => scrollRegion.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0)
    await scrollRegion.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })

    expect(
      await newScheduleItem.evaluate((element) => {
        const scrollRegion = element.closest(
          '[data-dashboard-scroll-region="schedule"]'
        )
        if (!scrollRegion) return false
        const regionBounds = scrollRegion.getBoundingClientRect()
        const actionBounds = element.getBoundingClientRect()
        return (
          actionBounds.left >= regionBounds.left - 1 &&
          actionBounds.right <= regionBounds.right + 1
        )
      })
    ).toBe(true)
  })

  test("Schedule puts view choices and Gantt controls in compact menus", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 700 })
    const path = "/dashboard/projects/e2e-project-001/schedule?view=list"
    const response = await page.goto(path)
    await expectHealthyNavigation(page, response, "/dashboard/projects/e2e-project-001/schedule")

    const toolbar = page.locator("[data-schedule-toolbar]:visible")
    await expect(toolbar).toBeVisible()
    expect(
      await toolbar.evaluate((element) => element.clientHeight)
    ).toBeLessThanOrEqual(40)

    await page.getByRole("button", { name: "Schedule view" }).click()
    await expect(
      page.getByRole("menuitemradio", { name: "Calendar" })
    ).toBeVisible()
    await expect(
      page.getByRole("menuitemradio", { name: "List" })
    ).toBeChecked()
    await page.getByRole("menuitemradio", { name: "Gantt" }).click()
    await page.waitForURL(
      (url) =>
        url.searchParams.get("view") === "gantt" && url.searchParams.has("order")
    )
    await expect(page.getByRole("button", { name: "Gantt controls" })).toBeVisible()

    await page.getByRole("button", { name: "Gantt controls" }).click()
    await expect(
      page.getByRole("menuitemradio", { name: "Day", exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("menuitemradio", { name: "Week" })
    ).toBeChecked()
    await expect(
      page.getByRole("menuitemradio", { name: "Month" })
    ).toBeVisible()
    await expect(
      page.getByRole("menuitemradio", { name: "Year" })
    ).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "Today" })).toBeVisible()
    await page.keyboard.press("Escape")
  })

  test("Gantt keeps rows synchronized and reserves horizontal scrolling for Shift", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    const response = await page.goto(
      "/dashboard/projects/e2e-project-001/schedule?view=gantt&order=chronological"
    )
    await expectHealthyNavigation(
      page,
      response,
      "/dashboard/projects/e2e-project-001/schedule"
    )

    const taskList = page.locator(".schedule-gantt-task-list:visible").first()
    const chart = page.locator(".gantt-container:visible").first()
    await expect(taskList).toBeVisible()
    await expect(chart).toBeVisible()
    await taskList.evaluate((element) => {
      element.style.height = "120px"
      element.scrollTop = 0
    })
    await chart.evaluate((element) => {
      element.style.height = "120px"
      element.scrollTop = 0
    })

    await page.getByRole("button", { name: "Gantt controls" }).click()
    await page.getByRole("menuitem", { name: "Today" }).click()
    await expect
      .poll(() => taskList.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0)
    await expect
      .poll(() => chart.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0)
    // Today centers the timeline smoothly; wait for that horizontal animation
    // to settle before asserting that a regular wheel leaves it anchored.
    await page.waitForTimeout(750)

    const ordinaryWheelStart = await chart.evaluate((element) => ({
      left: element.scrollLeft,
      top: element.scrollTop,
    }))
    await chart.evaluate((element) => {
      const deltaY = element.scrollTop > 0 ? -48 : 48
      element.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: 120,
          deltaY,
        })
      )
    })
    await expect
      .poll(() => chart.evaluate((element) => element.scrollTop))
      .not.toBe(ordinaryWheelStart.top)
    expect(await chart.evaluate((element) => element.scrollLeft)).toBe(
      ordinaryWheelStart.left
    )
    await expect
      .poll(() => taskList.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0)

    const shiftWheelStart = await chart.evaluate((element) => ({
      left: element.scrollLeft,
      top: element.scrollTop,
    }))
    await chart.evaluate((element) => {
      const deltaY = element.scrollLeft > 0 ? -96 : 96
      element.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY,
          shiftKey: true,
        })
      )
    })
    await expect
      .poll(() => chart.evaluate((element) => element.scrollLeft))
      .not.toBe(shiftWheelStart.left)
    expect(await chart.evaluate((element) => element.scrollTop)).toBe(
      shiftWheelStart.top
    )
  })

  test("Gantt releases edge wheel input to the surrounding Schedule workspace", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    const response = await page.goto(
      "/dashboard/projects/e2e-project-001/schedule?view=gantt&order=chronological"
    )
    await expectHealthyNavigation(
      page,
      response,
      "/dashboard/projects/e2e-project-001/schedule"
    )

    const scrollRegion = page.locator(
      '[data-dashboard-scroll-region="schedule"]:visible'
    )
    const taskList = page.locator(".schedule-gantt-task-list:visible")
    const chart = page.locator(".gantt-container:visible")
    await expect(taskList).toBeVisible()
    await expect(chart).toBeVisible()
    const outerScrollRange = await scrollRegion.evaluate(
      (element) => element.scrollHeight - element.clientHeight
    )
    expect(outerScrollRange).toBeGreaterThan(0)

    for (const pane of [taskList, chart]) {
      for (const edge of ["top", "bottom"] as const) {
        await pane.evaluate((element, paneEdge) => {
          element.style.height = "120px"
          element.scrollTop = paneEdge === "top" ? 0 : element.scrollHeight
        }, edge)
        await scrollRegion.evaluate((element, paneEdge) => {
          const distance = Math.min(240, element.scrollHeight - element.clientHeight)
          element.scrollTop = paneEdge === "top" ? distance : 0
        }, edge)
        const initialWorkspaceTop = await scrollRegion.evaluate(
          (element) => element.scrollTop
        )
        const paneBox = await pane.boundingBox()
        expect(paneBox).not.toBeNull()
        if (!paneBox) return

        await page.mouse.move(
          paneBox.x + paneBox.width / 2,
          paneBox.y + paneBox.height / 2
        )
        await page.mouse.wheel(0, edge === "top" ? -240 : 240)
        await expect
          .poll(() => scrollRegion.evaluate((element) => element.scrollTop))
          .not.toBe(initialWorkspaceTop)
      }
    }
  })

  test("Schedule Calendar controls use one compact menu", async ({ page }) => {
    await page.setViewportSize({ width: 980, height: 700 })
    const response = await page.goto(
      "/dashboard/projects/e2e-project-001/schedule?view=calendar"
    )
    await expectHealthyNavigation(
      page,
      response,
      "/dashboard/projects/e2e-project-001/schedule"
    )

    await page.getByRole("button", { name: "Calendar controls" }).click()
    await expect(
      page.getByRole("menuitemradio", { name: "Month", exact: true })
    ).toBeChecked()
    await expect(
      page.getByRole("menuitemradio", { name: "Agenda" })
    ).toBeVisible()
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
    // Clear through the editor's keyboard transaction so TipTap emits the
    // same update event a user produces in WebKit.
    await replyEditor.click()
    await page.keyboard.press("ControlOrMeta+A")
    await page.keyboard.press("Backspace")
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

    // WebKit can retain the previous streamed schedule tree for a frame while
    // App Router commits the current one. Use the active copy of the row.
    const scheduleRow = page
      .locator("#schedule-item-e2e-schedule-001")
      .last()
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

    const scheduleRow = page
      .locator("#schedule-item-e2e-schedule-001")
      .last()
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
    const response = await page.goto(internalPath)
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

    const scheduleRow = page
      .locator("#schedule-item-e2e-schedule-001")
      .last()
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
    const ownerPage = await page.context().newPage()
    try {
      const ownerResponse = await ownerPage.goto(ownerPath)
      await expectHealthyNavigation(ownerPage, ownerResponse, ownerPath)
      await expect(
        ownerPage.getByText("Published schedule commitment", { exact: true })
      ).toBeVisible()
      await expect(
        ownerPage.getByText("Owner-visible published milestone", {
          exact: true,
        })
      ).toBeVisible()
      await expect(
        ownerPage.getByText("Partner-visible published delivery", {
          exact: true,
        })
      ).toHaveCount(0)
      await expect(
        ownerPage.getByText("Regression Schedule Item", { exact: true })
      ).toHaveCount(0)
      await expect(
        ownerPage.getByText("Internal regression RFI link")
      ).toHaveCount(0)
      await expect(ownerPage.getByText("Awaiting confirmation")).toBeVisible()
      await expect(
        ownerPage.getByRole("button", { name: "Confirm" })
      ).toHaveCount(0)
    } finally {
      await ownerPage.close()
    }

    const partnerPath =
      "/preview/projects/e2e-project-001/sub-vendor/schedule"
    const partnerPage = await page.context().newPage()
    try {
      const partnerResponse = await partnerPage.goto(partnerPath)
      await expectHealthyNavigation(partnerPage, partnerResponse, partnerPath)
      await expect(
        partnerPage.getByText("Published schedule commitment", { exact: true })
      ).toBeVisible()
      await expect(
        partnerPage.getByText("Partner-visible published delivery", {
          exact: true,
        })
      ).toBeVisible()
      await expect(
        partnerPage.getByText("Owner-visible published milestone", {
          exact: true,
        })
      ).toHaveCount(0)
      await expect(
        partnerPage.getByText("Regression Schedule Item", { exact: true })
      ).toHaveCount(0)
      await expect(
        partnerPage.getByText("Internal regression RFI link")
      ).toHaveCount(0)
    } finally {
      await partnerPage.close()
    }
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
    // App Router can briefly retain the previous streamed tree while the next
    // calendar route commits. Both labels contain the same period, so target
    // the active tree without making the navigation assertion timing-sensitive.
    const periodLabel = page
      .getByTestId("work-calendar-period-label")
      .last()

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
      "Gantt overflow schedule item 19",
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
