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

function loginPathFor(path: string): string {
  return path === "/demo" ? "/login" : `/login?from=${encodeURIComponent(path)}`
}

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
  await expect
    .poll(() => {
      const url = new URL(page.url())
      const actualPath = `${url.pathname}${url.search}`
      return actualPath
    })
    .toBe(expectedPath)
  await expect(page.locator("body")).not.toContainText(applicationErrorText)
  await expect(page.locator("body")).not.toBeEmpty()
}

test.describe("production smoke", () => {
  test("demo workspace exposes healthy core navigation", async ({ page }) => {
    const context = page.context()
    const applicationPostRequests: string[] = []
    const blockedNextActionRequests: string[] = []
    await context.route("**/*", async (route) => {
      const request = route.request()
      if (request.method() === "POST") {
        const nextAction = request.headers()["next-action"]
        if (nextAction) {
          blockedNextActionRequests.push(request.url())
        } else {
          applicationPostRequests.push(request.url())
        }
        await route.abort("blockedbyclient")
        return
      }
      await route.continue()
    })
    const demoResponse = await page.goto("/demo")
    const demoRequiresAuthentication = new URL(page.url()).pathname === "/login"
    await expectHealthyNavigation(
      page,
      demoResponse,
      "/demo",
      demoRequiresAuthentication ? loginPathFor("/demo") : "/dashboard",
    )
    if (demoRequiresAuthentication) {
      await expect(page.locator("body")).toContainText("Welcome back")

      for (const area of productionAreas) {
        await test.step(`${area.path} redirects to login`, async () => {
          const isolatedPage = await page.context().newPage()
          try {
            const response = await isolatedPage.goto(area.path)
            await expectHealthyNavigation(
              isolatedPage,
              response,
              area.path,
              loginPathFor(area.path),
            )
            await expect(isolatedPage.locator("body")).toContainText("Welcome back")
          } finally {
            await isolatedPage.close()
          }
        })
      }

      expect(
        applicationPostRequests,
        "production smoke must not reach application POST endpoints",
      ).toEqual([])
      return
    }

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

    expect(
      applicationPostRequests,
      "production smoke must not reach application POST endpoints",
    ).toEqual([])
  })
})
