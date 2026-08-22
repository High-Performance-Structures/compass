import { expect, test, _electron as electron } from "@playwright/test"

function isElectron(): boolean {
  return process.env.ELECTRON === "true" || process.env.ELECTRON_TEST === "true"
}

test.describe("Electron runtime", () => {
  test.skip(!isElectron(), "Desktop only")

  test("loads the app with the desktop preload bridge", async () => {
    const app = await electron.launch({
      args: ["dist-electron/electron/main.js"],
      env: {
        ...process.env,
        ELECTRON_DEV_SERVER_URL: "http://127.0.0.1:3000",
      },
    })

    try {
      const page = await app.firstWindow()
      await page.waitForLoadState("domcontentloaded")

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

      const previewWindowPromise = app.waitForEvent("window")
      await page.evaluate(() => {
        window.open(
          `${window.location.origin}/preview/projects/desktop-preview-test/owner`,
          "compass-project-audience-preview",
          "popup=yes,width=1180,height=800"
        )
      })
      const previewWindow = await previewWindowPromise
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
