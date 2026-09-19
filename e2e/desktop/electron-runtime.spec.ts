import { expect, test, _electron as electron } from "@playwright/test"

function isElectron(): boolean {
  return process.env.ELECTRON === "true" || process.env.ELECTRON_TEST === "true"
}

test.describe("Electron runtime", () => {
  test.skip(!isElectron(), "Desktop only")

  test("loads the app with the desktop preload bridge", async ({}, testInfo) => {
    const app = await electron.launch({
      args: ["dist-electron/electron/main.js"],
      artifactsDir: testInfo.outputPath("electron-artifacts"),
      recordVideo: {
        size: { width: 1180, height: 800 },
      },
      env: {
        ...process.env,
        ELECTRON_DEV_SERVER_URL: "http://127.0.0.1:3000",
      },
    })

    try {
      const page = await app.firstWindow()
      await page.waitForLoadState("domcontentloaded")

      const demoResponse = await page.goto("/demo")
      expect(demoResponse).not.toBeNull()
      if (!demoResponse) throw new Error("Demo route did not return a response")
      expect(demoResponse.status()).toBeLessThan(400)
      await page.waitForURL(/\/dashboard/)

      await expect
        .poll(async () =>
          page.evaluate(() => window.compassDesktop?.platform.isDesktop ?? false),
        )
        .toBe(true)

      await expect
        .poll(async () =>
          page.evaluate(() => window.compassDesktop?.window.isFocused()),
        )
        .toBe(true)

      const previewWindowPromise = page.waitForEvent("popup")
      await page.evaluate(() => {
        window.open(
          `${window.location.origin}/preview/projects/e2e-project-001/owner`,
          "compass-project-audience-preview",
          "popup=yes,width=1180,height=800"
        )
      })
      const previewWindow = await previewWindowPromise
      await expect(previewWindow).toHaveURL(
        /\/preview\/projects\/e2e-project-001\/owner$/,
      )
      await expect(previewWindow.locator("body")).not.toContainText(
        /This page could not be found|Application error|Internal Server Error|404/i,
      )
      await expect(
        previewWindow.getByRole("link", {
          name: /H-E2E-001.*Regression Test Project/,
        }).first(),
      ).toBeVisible()
      await expect(
        previewWindow.getByText(
          "Preview mode — external users see this same guarded workspace.",
          { exact: true },
        ),
      ).toBeVisible()
      await previewWindow.screenshot({
        path: testInfo.outputPath("electron-preview.png"),
        fullPage: true,
      })
      await previewWindow.close()

      await expect
        .poll(async () =>
          page.evaluate(() => window.compassDesktop?.window.isFocused())
        )
        .toBe(true)
    } finally {
      await app.close()
    }
  })
})
