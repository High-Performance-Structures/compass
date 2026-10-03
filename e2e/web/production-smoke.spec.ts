import { expect, test, type Page, type Response } from "@playwright/test"

const applicationErrorText =
  /Application error|Internal Server Error|This page could not be found/i

const productionAreas = [
  "/dashboard",
  "/dashboard/projects",
  "/dashboard/projects/follow-up",
  "/dashboard/schedule",
  "/dashboard/rfis",
  "/dashboard/purchase-orders",
  "/dashboard/files",
  "/dashboard/contacts",
  "/dashboard/financials",
  "/dashboard/people",
  "/dashboard/conversations",
  "/dashboard/settings",
] as const

async function expectHealthyNavigation(
  page: Page,
  response: Response | null,
  path: string,
): Promise<void> {
  expect(response, `${path} did not return a document response`).not.toBeNull()
  if (!response) return

  expect(
    response.status(),
    `${path} returned HTTP ${response.status()}`,
  ).toBeLessThan(400)
  await expect(page).toHaveURL(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  await expect(page.locator("body")).not.toContainText(applicationErrorText)
  await expect(page.locator("body")).not.toBeEmpty()
}

test.describe("production smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo")
    await page.waitForURL(/\/dashboard/)
    await expect(page.locator("body")).not.toContainText(applicationErrorText)
  })

  test("demo workspace exposes healthy core navigation", async ({ page }) => {
    test.slow()

    for (const path of productionAreas) {
      await test.step(path, async () => {
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
})