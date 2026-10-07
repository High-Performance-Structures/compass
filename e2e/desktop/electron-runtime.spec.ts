import {
  expect,
  test,
  _electron as electron,
  type Video,
} from "@playwright/test"

function isElectron(): boolean {
  return process.env.ELECTRON === "true" || process.env.ELECTRON_TEST === "true"
}

type AttemptResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: unknown }

async function attempt(action: () => Promise<void>): Promise<AttemptResult> {
  try {
    await action()
    return { success: true }
  } catch (error) {
    return { success: false, error }
  }
}

test.describe("Electron runtime", () => {
  test.skip(!isElectron(), "Desktop only")

  test("loads the app with the desktop preload bridge", async ({}, testInfo) => {
    // macOS runners can spend longer preparing the bundled Electron process
    // than Playwright's default 30-second window-event timeout.
    test.setTimeout(120_000)
    const videoDir = testInfo.outputPath("videos")
    const appUrl = new URL(
      "/demo",
      process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    ).toString()
    let mainVideo: Video | null = null
    let previewVideo: Video | null = null
    let testFailure: unknown = null
    const app = await electron.launch({
      args: ["dist-electron/electron/main.js"],
      recordVideo: {
        dir: videoDir,
        size: { width: 1180, height: 800 },
        showActions: { position: "top-right" },
      },
      env: {
        ...process.env,
        ELECTRON_DEV_SERVER_URL: appUrl,
      },
    })

    try {
      const page = await app.firstWindow({ timeout: 90_000 })
      mainVideo = page.video()
      await page.waitForURL(/\/dashboard/)
      await page.waitForLoadState("domcontentloaded")

      await expect
        .poll(async () =>
          page.evaluate(() => window.compassDesktop?.platform.isDesktop ?? false),
        )
        .toBe(true)
      const dashboardHeading = page.getByText("Morning launchpad", {
        exact: true,
      })
      await expect(dashboardHeading).toBeVisible()

      // Electron exposes a window.open popup as a Page event on Linux, while
      // macOS and Windows can surface the same native window through the
      // Electron application event. Listen on both surfaces so the test proves
      // the same popup workflow without depending on platform event plumbing.
      const previewWindowPromise = Promise.race([
        page.waitForEvent("popup", { timeout: 90_000 }),
        app.waitForEvent("window", { timeout: 90_000 }),
      ])
      const previewUrl = new URL(
        "/preview/projects/e2e-project-001/owner",
        appUrl,
      ).toString()
      // A real target=_blank click is required here. On macOS, window.open()
      // can return a non-null proxy without creating a native Electron window.
      // The click exercises the same guarded handler with an actual user gesture.
      await page.evaluate((url) => {
        const link = document.createElement("a")
        link.href = url
        link.target = "compass-project-audience-preview"
        link.rel = "noreferrer"
        link.dataset.e2ePreviewLink = "true"
        link.textContent = "Open preview"
        Object.assign(link.style, {
          position: "fixed",
          top: "8px",
          left: "8px",
          zIndex: "2147483647",
          width: "120px",
          height: "32px",
        })
        document.body.appendChild(link)
      }, previewUrl)
      await page.bringToFront()
      await page
        .locator('[data-e2e-preview-link="true"]')
        .click({ force: true })
      await page.locator('[data-e2e-preview-link="true"]').evaluate((link) =>
        link.remove(),
      )
      const previewWindow = await previewWindowPromise
      previewVideo = previewWindow.video()
      await expect(previewWindow).toHaveURL(
        /\/preview\/projects\/e2e-project-001\/owner$/,
      )
      await expect(previewWindow.locator("body")).not.toContainText(
        /This page could not be found|Application error|Internal Server Error|404/i,
      )
      await expect(
        previewWindow
          .getByLabel("Owner dashboard")
          .getByText("Owner workspace", { exact: true }),
      ).toBeVisible()
      await expect(
        previewWindow.getByRole("link", {
          name: "H-E2E-001 · Regression Test Project",
        }),
      ).toBeVisible()
      await expect(
        previewWindow.getByText(
          "Preview mode — external users see this same guarded workspace.",
          { exact: true },
        ),
      ).toBeVisible()
      const previewScreenshot = testInfo.outputPath("preview-window.png")
      await previewWindow.screenshot({ path: previewScreenshot, fullPage: true })
      await testInfo.attach("preview-window", {
        path: previewScreenshot,
        contentType: "image/png",
      })
      const focusRequestSwitch = "compass-e2e-main-focus-requested"
      await app.evaluate(
        ({ app: electronApp, BrowserWindow }, switchName) => {
          const mainWindow = BrowserWindow.getAllWindows().find(
            (candidate) => !candidate.webContents.getURL().includes("/preview/"),
          )
          if (!mainWindow) throw new Error("Main Electron window not found")

          // Headless CI desktops may refuse OS focus. Observe the native focus
          // request while still forwarding it to verify Compass restores focus.
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
        .poll(() =>
          app.evaluate(
            ({ app: electronApp }, switchName) =>
              electronApp.commandLine.hasSwitch(switchName),
            focusRequestSwitch,
          ),
        )
        .toBe(true)
    } catch (error) {
      testFailure = error
    }

    async function preserveFirstFailure(action: () => Promise<void>): Promise<void> {
      const result = await attempt(action)
      if (!result.success && testFailure === null) testFailure = result.error
    }

    await preserveFirstFailure(() => app.close())
    if (mainVideo) {
      await preserveFirstFailure(async () => {
        await testInfo.attach("desktop-main-window-recording", {
          path: await mainVideo.path(),
          contentType: "video/webm",
        })
      })
    }
    if (previewVideo) {
      await preserveFirstFailure(async () => {
        await testInfo.attach("desktop-preview-window-recording", {
          path: await previewVideo.path(),
          contentType: "video/webm",
        })
      })
    }

    if (testFailure !== null) throw testFailure
  })
})
