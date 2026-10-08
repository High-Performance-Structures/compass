import { expect, test, _electron as electron } from "@playwright/test"

function isElectron(): boolean {
  return process.env.ELECTRON === "true" || process.env.ELECTRON_TEST === "true"
}

test.describe("Electron runtime", () => {
  test.skip(!isElectron(), "Desktop only")

  test("loads the app with the desktop preload bridge", async () => {
    const appUrl = new URL(
      "/dashboard/projects/e2e-project-001",
      process.env.PLAYWRIGHT_BASE_URL ??
        `http://127.0.0.1:${process.env.PORT ?? "3000"}`,
    ).toString()
    const app = await electron.launch({
      args: ["--disable-popup-blocking", "dist-electron/electron/main.js"],
      env: {
        ...process.env,
        ELECTRON_DEV_SERVER_URL: appUrl,
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

      await expect(
        page.getByText("Regression Test Project", { exact: true }),
      ).toBeVisible()
      await page.bringToFront()
      const previewUrl = new URL(
        "/preview/projects/e2e-project-001/owner",
        appUrl,
      ).toString()
      await page.evaluate((url) => {
        const previewLink = document.createElement("a")
        previewLink.dataset.e2ePreviewLink = "true"
        previewLink.href = url
        previewLink.target = "compass-project-audience-preview"
        previewLink.textContent = "Open owner preview"
        previewLink.style.cssText =
          "position: fixed; top: 8px; left: 8px; z-index: 2147483647; display: block"
        document.body.appendChild(previewLink)
      }, previewUrl)
      const previewTrigger = page.locator('a[data-e2e-preview-link="true"]')
      await expect(previewTrigger).toBeVisible()
      await previewTrigger.click()
      await expect.poll(() => app.windows().length).toBeGreaterThan(1)
      const previewWindow = app
        .windows()
        .find((window) => window !== page)
      if (!previewWindow) throw new Error("Preview Electron window not found")
      await expect(previewWindow).toHaveURL(
        /\/preview\/projects\/e2e-project-001\/owner$/,
      )
      await expect(
        previewWindow
          .getByLabel("Owner dashboard")
          .getByText("Owner workspace", { exact: true }),
      ).toBeVisible()
      await expect(
        previewWindow.getByText(
          "Preview mode — external users see this same guarded workspace.",
          { exact: true },
        ),
      ).toBeVisible()
      const focusRequestSwitch = "compass-e2e-main-focus-requested"
      await app.evaluate(
        ({ app: electronApp, BrowserWindow }, switchName) => {
          const mainWindow = BrowserWindow.getAllWindows().find(
            (candidate) => !candidate.webContents.getURL().includes("/preview/"),
          )
          if (!mainWindow) throw new Error("Main Electron window not found")
          const focusMainWindow = mainWindow.focus.bind(mainWindow)
          mainWindow.focus = () => {
            electronApp.commandLine.appendSwitch(switchName)
            focusMainWindow()
          }
        },
        focusRequestSwitch,
      )
      await previewWindow.close()

      await expect
        .poll(async () =>
          app.evaluate(
            ({ app: electronApp }, switchName) =>
              electronApp.commandLine.hasSwitch(switchName),
            focusRequestSwitch,
          ),
        )
        .toBe(true)
    } finally {
      await app.close()
    }
  })
})
