import { expect, test, type Page, type Response } from "@playwright/test"

const applicationErrorText =
  /Application error|Internal Server Error|This page could not be found/i

type ProductionArea = {
  readonly path: string
  readonly expectedPath?: string
}

const productionAreas: readonly ProductionArea[] = [
  { path: "/dashboard" },
  { path: "/dashboard/projects" },
  { path: "/dashboard/projects/follow-up" },
  { path: "/dashboard/schedule" },
  { path: "/dashboard/rfis" },
  { path: "/dashboard/purchase-orders" },
  { path: "/dashboard/files" },
  { path: "/dashboard/contacts" },
  { path: "/dashboard/financials" },
  {
    path: "/dashboard/people",
    expectedPath: "/dashboard/contacts?tab=internal",
  },
  { path: "/dashboard/conversations" },
  { path: "/dashboard/settings" },
]

async function expectHealthyNavigation(
  page: Page,
  response: Response | null,
  path: string,
  expectedPath: string = path,
): Promise<void> {
  expect(response, `${path} did not return a document response`).not.toBeNull()
  if (!response) return

  expect(
    response.status(),
    `${path} returned HTTP ${response.status()}`,
  ).toBeLessThan(400)
  if (expectedPath === path) {
    await expect(page).toHaveURL(
      new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    )
  } else {
    await expect
      .poll(() => {
        const url = new URL(page.url())
        return `${url.pathname}${url.search}`
      })
      .toBe(expectedPath)
  }
  await expect(page.locator("body")).not.toContainText(applicationErrorText)
  await expect(page.locator("body")).not.toBeEmpty()
}

test.describe("production smoke", () => {
  test("demo workspace exposes healthy core navigation", async ({ page }) => {
    const context = page.context()
    const serverActionRequests: string[] = []
    context.on("request", (request) => {
      if (request.method() === "POST" && request.headers()["next-action"]) {
        serverActionRequests.push(request.url())
      }
    })
    await context.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const request = input instanceof Request ? input : null
        const method = (init?.method ?? request?.method ?? "GET").toUpperCase()
        const headers = new Headers(init?.headers ?? request?.headers)
        if (method.toUpperCase() === "POST" && headers.has("Next-Action")) {
          return Promise.reject(new Error("Read-only smoke blocked a server action."))
        }
        return nativeFetch(input, init)
      }
    })
    await page.goto("/demo")
    await page.waitForURL(/\/dashboard/)
    await expect(page.locator("body")).not.toContainText(applicationErrorText)
    test.slow()

    for (const area of productionAreas) {
      await test.step(area.path, async () => {
        const isolatedPage = await page.context().newPage()
        try {
          const response = await isolatedPage.goto(area.path)
          await expectHealthyNavigation(
            isolatedPage,
            response,
            area.path,
            area.expectedPath,
          )
        } finally {
          await isolatedPage.close()
        }
      })
    }

    expect(serverActionRequests).toEqual([])
  })
})