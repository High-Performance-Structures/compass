import { expect, test } from "@playwright/test"

for (const platform of ["ios", "android"]) {
  test(`${platform} can return to Field Mode through tablet resizing and navigation`, async ({ page }) => {
    await page.setViewportSize({ width: 1194, height: 834 })
    await page.goto(`/dashboard/projects?nativePlatform=${platform}`)
    const headerReturn = page.getByRole("link", { name: "Return to Field Mode", exact: true })
    await expect(headerReturn).toBeVisible()
    await expect(headerReturn).toHaveAttribute("href", "compass://field")

    // The app handoff hint must survive page navigation without its query string.
    await page.goto("/dashboard/settings")
    for (const width of [834, 600, 1194, 767, 768, 1366]) {
      await page.setViewportSize({ width, height: 834 })
      const returnLink = width < 768
        ? page.getByRole("link", { name: "Field", exact: true })
        : headerReturn
      await expect(returnLink).toBeVisible()
      await expect(returnLink).toHaveAttribute("href", "compass://field")
      // Exercise the visible control without asking the test machine to launch an app.
      await returnLink.evaluate((link) => link.removeAttribute("data-field-return-requested"))
      await page.evaluate(() => {
        document.addEventListener("click", (event) => {
          const target = event.target instanceof Element ? event.target.closest("a") : null
          if (target?.getAttribute("href") === "compass://field") {
            event.preventDefault()
            target.setAttribute("data-field-return-requested", "true")
          }
        }, { capture: true, once: true })
      })
      await returnLink.click()
      await expect(returnLink).toHaveAttribute("data-field-return-requested", "true")
      const bounds = await returnLink.boundingBox()
      expect(bounds).not.toBeNull()
      if (bounds) {
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
        if (width >= 768) {
          const searchBounds = await page.locator("header").getByRole("textbox").boundingBox()
          expect(searchBounds).not.toBeNull()
          if (searchBounds) {
            expect(searchBounds.x).toBeGreaterThanOrEqual(bounds.x + bounds.width)
            expect(searchBounds.width).toBeGreaterThan(80)
          }
        }
      }
    }
  })
}

test("ordinary desktop browsers keep their hosted navigation", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mobile browsers offer the app handoff independently of viewport width.")
  await page.setViewportSize({ width: 1194, height: 834 })
  await page.goto("/dashboard/projects")
  await expect(page.getByRole("link", { name: "Return to Field Mode", exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 600, height: 834 })
  await expect(page.getByRole("link", { name: "Field", exact: true })).toHaveAttribute("href", "/dashboard/field")
})
