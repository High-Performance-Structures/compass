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
})
