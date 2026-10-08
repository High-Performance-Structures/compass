import { expect, test, type Locator } from "@playwright/test"

async function expectNativeScrollbar(region: Locator, browserName: string): Promise<void> {
  const styles = await region.evaluate((element, inspectWebkit) => {
    const style = getComputedStyle(element)
    const width = style.getPropertyValue("scrollbar-width")
    const color = style.getPropertyValue("scrollbar-color") || getComputedStyle(element, "::-webkit-scrollbar-thumb").backgroundColor
    const scrollbar = inspectWebkit ? getComputedStyle(element, "::-webkit-scrollbar") : null
    return {
      width,
      color,
      display: scrollbar?.display ?? "",
      verticalSize: scrollbar?.width ?? "",
      horizontalSize: scrollbar?.height ?? "",
    }
  }, browserName !== "firefox")
  expect(styles.width, await region.evaluate((element) => element.tagName + " " + element.className)).not.toBe("none")
  expect(styles.color).not.toBe("")
  expect(styles.color).not.toBe("auto")
  expect(styles.color).not.toBe("rgba(0, 0, 0, 0)")
  if (browserName !== "firefox") {
    expect(styles.display).not.toBe("none")
    expect(Number.parseFloat(styles.verticalSize)).toBeGreaterThan(0)
    expect(Number.parseFloat(styles.horizontalSize)).toBeGreaterThan(0)
  }
}

// Chromium also hides native bars by default in its headless launch arguments.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } })

test.beforeEach(async ({ page, baseURL, browserName, headless }) => {
  // Firefox Juggler injects hidden-scrollbars.css with an agent-level !important
  // rule in headless mode. Run these native-bar checks with --headed for Firefox.
  test.skip(browserName === "firefox" && headless, "Firefox headless suppresses native scrollbars; verify with --headed.")
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Uses the isolated local demo workspace.")
  if (!baseURL) throw new Error("A local URL is required.")
  await page.context().addCookies([{ name: "compass-demo", value: "true", url: baseURL }])
})

test("long pages and custom panels expose bars without hover; short panels do not", async ({ page, browserName }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 600 })
  await page.goto("/dashboard/help/navigating-projects")
  const frame = page.locator('[data-slot="sidebar-inset"]')
  const pageRegion = frame.locator("div.overflow-y-auto").first()
  await expect.poll(() => pageRegion.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await expectNativeScrollbar(pageRegion, browserName)
  await page.getByRole("button", { name: "Open Compass drawer", exact: true }).click()
  await page.getByRole("button", { name: "Open Compass Help", exact: true }).click()
  const drawer = page.locator('[data-slot="sheet-content"]')
  const viewport = drawer.locator('[data-slot="scroll-area-viewport"]')
  const bars = drawer.locator('[data-slot="scroll-area-scrollbar"]')
  const bar = drawer.locator('[data-slot="scroll-area-scrollbar"][data-orientation="vertical"]')
  // Opening from the sidebar leaves the pointer outside the scroll viewport.
  await expect(bar).toHaveAttribute("data-state", "visible")
  await drawer.getByLabel("Search Compass Help").fill("no matching guide abcxyz")
  await expect(drawer.getByText("No matching guide yet", { exact: true })).toBeVisible()
  await expect.poll(() => viewport.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true)
  await expect(bars).toHaveCount(0)
  await drawer.getByLabel("Search Compass Help").fill("")
  await drawer.getByRole("button", { name: /Navigating Projects and Keeping Context/ }).click()
  await expect.poll(() => viewport.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await page.mouse.move(0, 0)
  // Wait beyond Radix's hover hide delay to verify the bar stays available.
  await page.waitForTimeout(800)
  await expect(bar).toHaveAttribute("data-state", "visible")
  await expect(drawer.locator('[data-slot="scroll-area-thumb"]')).toBeVisible()
  const thumb = drawer.locator('[data-slot="scroll-area-scrollbar"][data-orientation="vertical"] [data-slot="scroll-area-thumb"]')
  const thumbBounds = await thumb.boundingBox()
  if (!thumbBounds) throw new Error("The visible vertical thumb must have bounds.")
  await page.mouse.move(thumbBounds.x + thumbBounds.width / 2, thumbBounds.y + thumbBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(thumbBounds.x + thumbBounds.width / 2, thumbBounds.y + thumbBounds.height / 2 + 60, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await viewport.evaluate((element) => { element.scrollTop = 0 })
  // Simulate a wide block arriving in the real shared panel after it opens.
  await viewport.evaluate((element) => {
    const block = document.createElement("pre")
    block.dataset.scrollbarTestWide = "true"
    block.style.width = "1200px"
    block.textContent = "Wide document content ".repeat(30)
    element.firstElementChild?.appendChild(block)
  })
  const horizontalBar = drawer.locator('[data-slot="scroll-area-scrollbar"][data-orientation="horizontal"]')
  await page.mouse.move(0, 0)
  await expect(horizontalBar).toHaveAttribute("data-state", "visible")
  await expect(horizontalBar.locator('[data-slot="scroll-area-thumb"]')).toBeVisible()
  await viewport.evaluate((element) => { element.querySelector('[data-scrollbar-test-wide="true"]')?.remove() })
  await expect(horizontalBar).toHaveCount(0)
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("visible-panel-scrollbar.png") })
  const lightPanelBackground = await drawer.evaluate((element) => getComputedStyle(element).backgroundColor)
  const lightScrollbarColor = await pageRegion.evaluate((element) => getComputedStyle(element).getPropertyValue("scrollbar-color") || getComputedStyle(element, "::-webkit-scrollbar-thumb").backgroundColor)
  // Exercise the global dark tokens without persisting a user preference.
  await page.evaluate(() => {
    document.documentElement.classList.add("dark")
    document.documentElement.removeAttribute("style")
  })
  await expectNativeScrollbar(pageRegion, browserName)
  expect(await drawer.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(lightPanelBackground)
  expect(await pageRegion.evaluate((element) => getComputedStyle(element).getPropertyValue("scrollbar-color") || getComputedStyle(element, "::-webkit-scrollbar-thumb").backgroundColor)).not.toBe(lightScrollbarColor)
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("visible-panel-scrollbar-dark.png") })
})

for (const width of [1024, 390]) {
  test(`growing document forms remain scrollable with visible bars at width ${width}`, async ({ page, browserName }, testInfo) => {
    await page.setViewportSize({ width, height: 320 })
    await page.goto("/dashboard/templates")
    await page.getByRole("button", { name: "New estimate template", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "New estimate template", exact: true })
    const description = dialog.getByLabel("Description", { exact: true })
    await description.fill(Array.from({ length: 50 }, (_, index) => `Scope paragraph ${index}: document content grows while drafting.`).join("\n"))
    await expect.poll(() => dialog.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await expectNativeScrollbar(dialog, browserName)
    await expectNativeScrollbar(description, browserName)
    const frame = page.locator('[data-slot="sidebar-inset"]')
    await expect.poll(() => frame.evaluate((element) => element.scrollTop)).toBe(0)
    await dialog.getByRole("button", { name: "Create editable draft", exact: true }).scrollIntoViewIfNeeded()
    await expect(dialog.getByRole("button", { name: "Create editable draft", exact: true })).toBeInViewport()
    await expect.poll(() => frame.evaluate((element) => element.scrollTop)).toBe(0)
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`visible-form-scrollbar-${width}.png`) })
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(dialog).toHaveCount(0)
  })
}
