import { expect, test, type Page, type Response } from "@playwright/test"

import { applicationErrorText, enterDemo, usingSmokeLogin } from "./smoke-session"

// The anonymous demo workspace seeds fixtures (project e2e-project-001,
// conversations, calendar items) that production's real smoke account cannot
// reach; PR CI exercises those journeys against a local server instead.
function skipWithoutDemoFixtures(): void {
  test.skip(
    usingSmokeLogin,
    "Needs demo workspace fixtures; covered by PR CI, not the production smoke account"
  )
}

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
    const jobStatus = page.getByRole("combobox", { name: "Approved job status" })
    await expect(jobStatus).toBeVisible()
    await expect(jobStatus).toHaveAttribute("aria-describedby", "job-status-help")
    await expect(
      page.getByRole("main").getByText(/Choose the approved operational stage for this project/)
    ).toBeVisible()
  })

  test("timezone preference persists after reloading settings", async ({ page }) => {
    // Production can drop individual requests without answering them
    // (issue #1036). The Preferences tab retries internally and surfaces an
    // error when every attempt dies, so drive it the way a user would —
    // re-click Save on a reported failure, reload again on a failed load —
    // inside an extended budget. A genuine persistence bug still fails: the
    // saved notice never appears, or the reloaded value is wrong.
    test.slow()
    const path = "/dashboard/settings"
    const response = await page.goto(path)
    await expectHealthyNavigation(page, response, path)

    const timezone = page.getByRole("combobox", { name: "Timezone" })
    await expect(timezone).toBeVisible({ timeout: 45_000 })
    await timezone.click()
    await page.getByRole("option", { name: "Pacific (PT)" }).click()
    await expect(timezone).toContainText("Pacific (PT)")

    const savedNotice = page.getByText("Preferences saved.")
    const saveFailedNotice = page.getByText(
      "Could not save preferences. Please try again."
    )
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.getByRole("button", { name: "Save preferences" }).click()
      await expect(savedNotice.or(saveFailedNotice).first()).toBeVisible({
        timeout: 45_000,
      })
      if (await savedNotice.isVisible()) break
    }
    await expect(savedNotice).toBeVisible()

    const loadFailedNotice = page.getByText(
      "Could not load notification preferences. Reload the page to try again."
    )
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.reload()
      await expect(
        page.getByRole("combobox", { name: "Timezone" })
      ).toBeVisible({ timeout: 45_000 })
      if (!(await loadFailedNotice.isVisible())) break
    }
    await expect(
      page.getByRole("combobox", { name: "Timezone" })
    ).toContainText("Pacific (PT)")
  })

  test("SMS opt-in and permission controls remain available", async ({
    page,
  }) => {
    skipWithoutDemoFixtures()
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
    skipWithoutDemoFixtures()
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

  test("project schedules expose single and multiple selection modes", async ({
    page,
  }) => {
    skipWithoutDemoFixtures()
    const path = "/dashboard/schedule?mode=projects&scope=all&view=list"
    const response = await page.goto(path)
    await expectHealthyNavigation(page, response, "/dashboard/schedule")

    await page.getByRole("combobox", { name: "Choose schedule scope" }).click()
    await expect(page.getByText("Project selection", { exact: true })).toBeVisible()
    await expect(page.locator('[data-slot="command-item"]').first()).toHaveAttribute(
      "aria-label",
      /Not the current project$/
    )

    const multipleMode = page.getByRole("radio", {
      name: "Multiple schedules",
    })
    await multipleMode.click()
    await expect(page).toHaveURL(/selection=multiple/)
    await page.getByRole("combobox", { name: "Choose schedule scope" }).click()
    await expect(
      page.getByText("Check projects to compare their schedules.")
    ).toBeVisible()

    const projectRows = page.locator('[data-slot="command-item"]')
    const project = projectRows.first()
    await expect(project).toBeVisible()
    await expect(project).toHaveAttribute(
      "aria-label",
      /Not selected for schedule comparison$/
    )
    // The scope navigation rerenders the cmdk row while Playwright is waiting
    // for click stability; dispatching the real DOM event avoids that race.
    await project.dispatchEvent("click")
    await expect(page).toHaveURL(/scope=selected.*projects=[^&]+/)
    await page.reload()
    await page.getByRole("combobox", { name: "Choose schedule scope" }).click()
    const selectedProject = page.locator('[data-schedule-selected="true"]').first()
    await expect(selectedProject).toBeVisible()
    await expect(selectedProject).toHaveAttribute(
      "aria-label",
      /Selected for schedule comparison$/
    )

    await selectedProject.dispatchEvent("click")
    await expect
      .poll(() => new URL(page.url()).searchParams.get("projects"))
      .toBe("")
    await expect(page.getByText("No projects selected", { exact: true }).last()).toBeVisible()
    await page.getByRole("combobox", { name: "Choose schedule scope" }).click()
    await expect(page.locator('[data-slot="command-item"]').first()).toHaveAttribute(
      "aria-label",
      /Not selected for schedule comparison$/
    )
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
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile-safari",
      "mobile WebKit does not expose page.mouse.wheel"
    )
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
    browserName,
    isMobile,
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

    // Mouse wheel events are unsupported in mobile WebKit, so only the
    // pointer-driven browsers assert the user-initiated scroll; mobile Safari
    // still verifies the header actions via the programmatic scroll below.
    if (!(browserName === "webkit" && isMobile)) {
      await page.mouse.move(regionBox.x + 5, regionBox.y + 5)
      await page.mouse.wheel(1_200, 0)
      await expect
        .poll(() => scrollRegion.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0)
    }
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
    skipWithoutDemoFixtures()
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

  test("Gantt persists a seeded viewport before an immediate refresh", async ({
    page,
  }, testInfo) => {
    skipWithoutDemoFixtures()
    await page.setViewportSize({ width: 1366, height: 768 })
    const schedulePath =
      "/dashboard/projects/e2e-project-001/schedule?view=gantt&order=chronological"
    const response = await page.goto(schedulePath)
    await expectHealthyNavigation(page, response, schedulePath)

    const chart = page.locator(".gantt-container:visible").first()
    await expect(chart).toBeVisible()

    const seeded = await chart.evaluate((element) => {
      const maximumLeft = element.scrollWidth - element.clientWidth
      const left = Math.max(1, Math.round(maximumLeft * 0.7))
      element.scrollLeft = left
      element.dispatchEvent(new Event("scroll"))
      const stored = window.sessionStorage.getItem(
        "compass:schedule-scroll:e2e-project-001"
      )
      return { left: element.scrollLeft, stored }
    })
    expect(seeded.left).toBeGreaterThan(0)
    expect(seeded.stored).toContain(`"left":${seeded.left}`)

    // Do not wait for a debounce. WebKit can tear down the page before a
    // timer callback runs during a refresh.
    await page.reload({ waitUntil: "commit" })
    await expect(chart).toBeVisible()
    await expect
      .poll(() => chart.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(seeded.left * 0.5)
    await page.screenshot({
      path: testInfo.outputPath("gantt-viewport-restored.png"),
      fullPage: false,
    })
  })

  test("Global Gantt restores its viewport after an immediate refresh", async ({
    page,
  }, testInfo) => {
    skipWithoutDemoFixtures()
    await page.setViewportSize({ width: 1366, height: 768 })
    const schedulePath =
      "/dashboard/schedule?mode=projects&scope=all&view=gantt&order=chronological"
    const response = await page.goto(schedulePath)
    await expectHealthyNavigation(page, response, "/dashboard/schedule")

    const chart = page.locator(".gantt-container:visible").first()
    await expect(chart).toBeVisible()

    const seeded = await chart.evaluate((element) => {
      const maximumLeft = element.scrollWidth - element.clientWidth
      const left = Math.max(1, Math.round(maximumLeft * 0.7))
      element.scrollLeft = left
      element.dispatchEvent(new Event("scroll"))
      const stored = window.sessionStorage.getItem(
        "compass:schedule-scroll:unified"
      )
      return { left: element.scrollLeft, stored }
    })
    expect(seeded.left).toBeGreaterThan(0)
    expect(seeded.stored).toContain(`"left":${seeded.left}`)

    await page.reload({ waitUntil: "commit" })
    await expect(chart).toBeVisible()
    await expect
      .poll(() => chart.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(seeded.left * 0.5)
    await page.screenshot({
      path: testInfo.outputPath("gantt-viewport-global-restored.png"),
      fullPage: false,
    })
  })

  test("Gantt restores its viewport on mobile after an immediate refresh", async ({
    page,
  }, testInfo) => {
    skipWithoutDemoFixtures()
    test.skip(!testInfo.project.name.startsWith("mobile-"), "mobile project only")
    const schedulePath =
      "/dashboard/projects/e2e-project-001/schedule?view=gantt&order=chronological"
    const response = await page.goto(schedulePath)
    await expectHealthyNavigation(page, response, schedulePath)

    const chart = page.locator(".gantt-container:visible").first()
    await expect(chart).toBeVisible()
    const seeded = await chart.evaluate((element) => {
      const maximumLeft = element.scrollWidth - element.clientWidth
      const left = Math.max(1, Math.round(maximumLeft * 0.6))
      element.scrollLeft = left
      element.dispatchEvent(new Event("scroll"))
      return {
        left: element.scrollLeft,
        stored: window.sessionStorage.getItem(
          "compass:schedule-scroll:e2e-project-001"
        ),
      }
    })
    expect(seeded.left).toBeGreaterThan(0)
    expect(seeded.stored).toContain(`"left":${seeded.left}`)
    await page.reload({ waitUntil: "commit" })
    await expect(chart).toBeVisible()
    await expect
      .poll(() => chart.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(seeded.left * 0.5)
    await page.screenshot({
      path: testInfo.outputPath("gantt-viewport-mobile-restored.png"),
      fullPage: false,
    })
  })

  test("Gantt keeps rows synchronized and reserves horizontal scrolling for Shift", async ({
    page,
  }) => {
    skipWithoutDemoFixtures()
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
  }, testInfo) => {
    skipWithoutDemoFixtures()
    test.skip(
      testInfo.project.name === "mobile-safari",
      "mobile WebKit does not expose page.mouse.wheel"
    )
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
        // Keep the pane on screen: scroll the workspace no further than the
        // pane's own offset, so the wheel lands on the pane at any density.
        await scrollRegion.evaluate((element) => {
          element.scrollTop = 0
        })
        const paneOffset = await pane.evaluate(
          (element) => element.getBoundingClientRect().top
        )
        await scrollRegion.evaluate(
          (element, args) => {
            const offset = args.paneTop - element.getBoundingClientRect().top
            const distance = Math.min(
              240,
              element.scrollHeight - element.clientHeight,
              Math.max(1, Math.floor(offset))
            )
            element.scrollTop = args.paneEdge === "top" ? distance : 0
          },
          { paneEdge: edge, paneTop: paneOffset }
        )
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
    skipWithoutDemoFixtures()
    const path = "/dashboard/conversations/e2e-channel-001"
    const response = await page.goto(path)
    await expectHealthyNavigation(page, response, path)

    const message = page
      .locator('[data-slot="scroll-area-viewport"]:visible')
      .last()
      .getByText("Regression conversation message", { exact: true })
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
    skipWithoutDemoFixtures()
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

    const message = page
      .locator('[data-slot="scroll-area-viewport"]:visible')
      .last()
      .getByText("Regression conversation message", { exact: true })
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

  test("project conversation history aligns messages and preserves navigation", async ({
    page,
  }, testInfo) => {
    skipWithoutDemoFixtures()
    await page.setViewportSize(testInfo.project.name.startsWith("mobile") ? { width: 390, height: 844 } : { width: 1366, height: 768 })
    const path = "/dashboard/conversations/e2e-channel-001"
    const response = await page.goto(path)
    await expectHealthyNavigation(page, response, path)

    // App Router can briefly retain a hidden streamed tree in WebKit.
    const viewport = page
      .locator('[data-slot="scroll-area-viewport"]:visible')
      .last()
    await expect(viewport).toBeVisible()
    await expect(viewport.locator('[data-message-id="e2e-message-001"]')).toHaveClass(
      /justify-end/
    )
    await expect(
      viewport.locator('[data-message-id="e2e-message-history-064"]')
    ).toHaveClass(/justify-start/)

    const alignment = await viewport.evaluate((element) => {
      const viewportBounds = element.getBoundingClientRect()
      const own = element
        .querySelector('[data-message-id="e2e-message-001"] [data-slot="avatar"]')
        ?.getBoundingClientRect()
      const other = element
        .querySelector('[data-message-id="e2e-message-history-064"] [data-slot="avatar"]')
        ?.getBoundingClientRect()
      if (!own || !other) {
        throw new Error("Conversation alignment fixtures did not render")
      }
      return {
        ownLeft: own.left,
        otherLeft: other.left,
        viewportRight: viewportBounds.right,
        ownRight: own.right,
        pageWidth: window.innerWidth,
        contentWidth: element.scrollWidth,
        viewportWidth: element.clientWidth,
      }
    })
    expect(alignment.ownLeft).toBeGreaterThan(alignment.otherLeft)
    expect(alignment.ownRight).toBeLessThanOrEqual(alignment.viewportRight)
    expect(alignment.viewportRight).toBeLessThanOrEqual(alignment.pageWidth)
    expect(alignment.contentWidth).toBeLessThanOrEqual(alignment.viewportWidth + 1)

    const newestEdge = async () =>
      viewport.evaluate((element) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error("Conversation viewport is not an HTMLElement")
        }
        return {
          distance: element.scrollHeight - (element.scrollTop + element.clientHeight),
          scrollTop: element.scrollTop,
          scrollHeight: element.scrollHeight,
        }
      })

    await expect.poll(async () => (await newestEdge()).distance).toBeLessThanOrEqual(24)
    await page.screenshot({ path: testInfo.outputPath("conversation-newest.png") })

    await viewport.evaluate((element) => {
      element.scrollTop = 0
    })
    await expect(
      page.getByRole("button", { name: "Jump to newest messages" })
    ).toBeVisible()
    const beforeHistory = await viewport.evaluate((element) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error("Conversation viewport is not an HTMLElement")
      }
      return {
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
      }
    })
    await page.screenshot({ path: testInfo.outputPath("conversation-jump-control.png") })

    await page.getByRole("button", { name: "Load older messages" }).click()
    await expect(page.getByText("History message 001", { exact: true })).toBeVisible()
    await expect
      .poll(async () =>
        viewport.evaluate((element) => {
          if (!(element instanceof HTMLElement)) {
            throw new Error("Conversation viewport is not an HTMLElement")
          }
          return element.scrollTop
        }),
      )
      .toBeGreaterThan(beforeHistory.scrollTop)
    const afterHistory = await viewport.evaluate((element) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error("Conversation viewport is not an HTMLElement")
      }
      return {
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
      }
    })
    expect(afterHistory.scrollTop).toBeGreaterThan(
      afterHistory.scrollHeight - beforeHistory.scrollHeight - 24
    )
    await page.screenshot({ path: testInfo.outputPath("conversation-history-prepended.png") })

    await page.getByRole("button", { name: "Jump to newest messages" }).click()
    await expect.poll(async () => (await newestEdge()).distance).toBeLessThanOrEqual(24)
  })

  test("project Messages opens newest, aligns quiet rows and preserves older history", async ({ page }, testInfo) => {
    skipWithoutDemoFixtures()
    await page.context().clearCookies()
    await page.setViewportSize(testInfo.project.name.startsWith("mobile") ? { width: 390, height: 844 } : { width: 1366, height: 768 })
    const path = "/dashboard/projects/e2e-correspondence-project-001/messages?conversationId=e2e-quiet-correspondence-001"
    const response = await page.goto(path)
    await expectHealthyNavigation(page, response, "/dashboard/projects/e2e-correspondence-project-001/messages")
    const viewport = page.locator("[data-correspondence-viewport]:visible").last()
    await expect(viewport).toBeVisible()
    await expect(viewport.locator('[data-message-author="self"]').last()).toHaveClass(/ml-auto/)
    const distance = async () => viewport.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)
    await expect.poll(distance).toBeLessThanOrEqual(24)
    await viewport.evaluate(element => { element.scrollTop = 0 })
    await expect(page.getByRole("button", { name: "Jump to newest messages" })).toBeVisible()
    const before = await viewport.evaluate(element => ({ height: element.scrollHeight, top: element.scrollTop }))
    await page.getByRole("button", { name: "Load earlier messages", exact: true }).click()
    await expect(viewport.getByText("Correspondence history 001", { exact: true })).toBeAttached()
    await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(before.top)
    const after = await viewport.evaluate(element => ({ height: element.scrollHeight, top: element.scrollTop, width: element.clientWidth, contentWidth: element.scrollWidth }))
    expect(Math.abs(after.top - (before.top + after.height - before.height))).toBeLessThan(24)
    expect(after.contentWidth).toBeLessThanOrEqual(after.width + 1)
    await page.getByRole("button", { name: "Jump to newest messages" }).click()
    await expect.poll(distance).toBeLessThanOrEqual(24)
    await page.screenshot({ path: testInfo.outputPath("correspondence-quiet-rows.png") })
  })

  test("schedule list exposes edit and selection actions", async ({ page }) => {
    skipWithoutDemoFixtures()
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

  test("schedule assignee choices respect shared-directory access", async ({
    page,
  }) => {
    skipWithoutDemoFixtures()
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
    await expect(page.getByText("No matching contacts.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Demo User" })).toHaveCount(1)
  })

  test("schedule items expose related records in the existing to-do workspace", async ({
    page,
  }) => {
    skipWithoutDemoFixtures()
    const schedulePath =
      "/dashboard/projects/e2e-project-001/schedule?view=list"
    const response = await page.goto(schedulePath)
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
    await expect(
      editDialog.getByRole("heading", { name: "Related to-dos" })
    ).toBeVisible()
    const linkedTodo = editDialog.getByRole("link", {
      name: "Regression follow-up",
    })
    await expect(linkedTodo).toHaveAttribute(
      "href",
      /\/dashboard\/projects\/e2e-project-001\/todos\?item=e2e-todo-001/
    )
    await linkedTodo.click()

    await expect(page).toHaveURL(
      /\/dashboard\/projects\/e2e-project-001\/todos\?item=e2e-todo-001/
    )
    const focusedTodo = page.locator(
      'article[data-focused="true"]#todo-e2e-todo-001'
    )
    await expect(focusedTodo).toContainText("Regression follow-up")
    await expect(
      focusedTodo.getByRole("link", { name: "View linked schedule item" })
    ).toHaveAttribute(
      "href",
      /\/dashboard\/projects\/e2e-project-001\/schedule\?view=list&item=e2e-schedule-001/
    )
  })

  test("published audience schedules stay isolated from drafts and internal links", async ({
    page,
  }) => {
    skipWithoutDemoFixtures()
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
      "/preview/projects/e2e-project-001/owner/schedule?previewAs=e2e-owner-001"
    const ownerPage = await page.context().newPage()
    try {
      const ownerResponse = await ownerPage.goto(ownerPath)
      await expectHealthyNavigation(ownerPage, ownerResponse, ownerPath)
      const ownerSchedule = ownerPage.locator("#schedule")
      await expect(
        ownerSchedule.getByText("Published schedule commitment", { exact: true })
      ).toBeVisible()
      await expect(
        ownerSchedule.getByText("Owner-visible published milestone", {
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
      "/preview/projects/e2e-project-001/sub-vendor/schedule?previewAs=e2e-vendor-001"
    const partnerPage = await page.context().newPage()
    try {
      const partnerResponse = await partnerPage.goto(partnerPath)
      await expectHealthyNavigation(partnerPage, partnerResponse, partnerPath)
      const partnerSchedule = partnerPage.locator("#schedule")
      await expect(
        partnerSchedule.getByText("Published schedule commitment", {
          exact: true,
        })
      ).toBeVisible()
      await expect(
        partnerSchedule.getByText("Partner-visible published delivery", {
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
    skipWithoutDemoFixtures()
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

  test("project selectors use the searchable project standard", async ({
    page,
  }) => {
    skipWithoutDemoFixtures()
    const path = "/dashboard/projects/e2e-project-001/schedule?view=list"
    const response = await page.goto(path)
    await expectHealthyNavigation(
      page,
      response,
      "/dashboard/projects/e2e-project-001/schedule"
    )

    const projectCombobox = page
      .getByRole("main")
      .getByRole("combobox", { name: "Switch project" })
    await expect(projectCombobox).toBeVisible()
    await projectCombobox.click()

    const projectPopover = page.locator('[data-slot="popover-content"]:visible')
    const projectSearch = projectPopover.getByPlaceholder(
      "Search number, name, or client..."
    )
    await projectSearch.fill("Regression Test")
    await expect(
      projectPopover.getByText("H-E2E-001", { exact: true })
    ).toBeVisible()

    await projectSearch.fill("not-a-real-project")
    await expect(
      projectPopover.getByText("No matching projects.")
    ).toBeVisible()
  })

  test("work calendar arrows move by the active view period", async ({
    page,
  }) => {
    // Production can drop the RSC round trip behind router.replace, so the
    // label moves while the URL never commits (issue #1036). Mirror a user
    // nudging the stalled navigation: step back and forward again to fire a
    // fresh replace before treating the stale URL as a failure. Arrows that
    // never commit a URL still fail after the nudges.
    test.slow()

    async function arrowCommitsUrl(
      arrowName: string,
      oppositeName: string,
      committed: (url: string) => boolean
    ): Promise<void> {
      await page.getByRole("button", { name: arrowName }).click()
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await page.waitForURL((url) => committed(url.toString()), {
            timeout: 15_000,
          })
          return
        } catch {
          await page.getByRole("button", { name: oppositeName }).click()
          await page.getByRole("button", { name: arrowName }).click()
        }
      }
      await page.waitForURL((url) => committed(url.toString()), {
        timeout: 15_000,
      })
    }

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
    const dayPattern = /view=today&date=\d{4}-\d{2}-\d{2}&kind=event/
    await arrowCommitsUrl("Next day", "Previous day", (url) =>
      dayPattern.test(url)
    )
    await expect(periodLabel).not.toHaveText(initialDay)
    const nextDayUrl = page.url()
    await arrowCommitsUrl(
      "Previous day",
      "Next day",
      (url) => dayPattern.test(url) && url !== nextDayUrl
    )
    await expect(periodLabel).toHaveText(initialDay)
    await expect(page).not.toHaveURL(nextDayUrl)

    response = await page.goto("/dashboard/schedule?view=week")
    await expectHealthyNavigation(page, response, "/dashboard/schedule")
    const initialWeek = await periodLabel.innerText()
    const weekPattern = /view=week&date=\d{4}-\d{2}-\d{2}/
    await arrowCommitsUrl("Next week", "Previous week", (url) =>
      weekPattern.test(url)
    )
    await expect(periodLabel).not.toHaveText(initialWeek)
    const nextWeekUrl = page.url()
    await arrowCommitsUrl(
      "Previous week",
      "Next week",
      (url) => weekPattern.test(url) && url !== nextWeekUrl
    )
    await expect(periodLabel).toHaveText(initialWeek)
    await expect(page).not.toHaveURL(nextWeekUrl)

    response = await page.goto("/dashboard/schedule?view=month")
    await expectHealthyNavigation(page, response, "/dashboard/schedule")
    const initialMonth = await periodLabel.innerText()
    const monthPattern = /view=month&date=\d{4}-\d{2}-\d{2}/
    await arrowCommitsUrl("Next month", "Previous month", (url) =>
      monthPattern.test(url)
    )
    await expect(periodLabel).not.toHaveText(initialMonth)
    const nextMonthUrl = page.url()
    await arrowCommitsUrl(
      "Previous month",
      "Next month",
      (url) => monthPattern.test(url) && url !== nextMonthUrl
    )
    await expect(periodLabel).toHaveText(initialMonth)
    await expect(page).not.toHaveURL(nextMonthUrl)
  })

  test("work calendar reveals every item hidden behind the overflow count", async ({
    page,
  }) => {
    skipWithoutDemoFixtures()
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
    skipWithoutDemoFixtures()
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
