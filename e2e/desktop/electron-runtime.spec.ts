import {
  expect,
  test,
  _electron as electron,
} from "@playwright/test"

function isElectron(): boolean {
  return process.env.ELECTRON === "true" || process.env.ELECTRON_TEST === "true"
}

const appUrl = new URL(
  "/dashboard/projects/e2e-project-001",
  process.env.PLAYWRIGHT_BASE_URL ??
    `http://127.0.0.1:${process.env.PORT ?? "3000"}`,
).toString()
const previewUrl = new URL(
  "/preview/projects/e2e-project-001/owner",
  appUrl,
).toString()

// Desktop E2E runs against `next dev`, which compiles each route the first
// time it is requested. On macOS runners the project Overview and the owner
// preview each took 50-100 s to compile, and Playwright only reports the
// preview window once its first navigation commits, so the window-event wait
// was really timing the dev compiler (it failed whenever the preview compile
// passed ~90 s). Compile both routes here, as setup with its own budget, so
// the window assertions below measure only Electron's behaviour. Warming the
// routes was not enough on macOS: the dev server kept compiling after the
// Electron window loaded ("Compiling..." badge) and the popup's request never
// reached the server within 45 s (run 43380715621), so CI's macOS job serves
// a production build instead (playwright.config.ts, COMPASS_E2E_NEXT_START),
// where this warm-up is a quick no-op.
async function compileRoute(url: string): Promise<void> {
  // Any HTTP response (including the preview's "not found" error page) means
  // the route finished compiling; the status itself is irrelevant here.
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(240_000),
  })
  await response.arrayBuffer()
}

test.describe("Electron runtime", () => {
  test.skip(!isElectron(), "Desktop only")

  test.beforeAll(async () => {
    test.setTimeout(300_000)
    await compileRoute(appUrl)
    await compileRoute(previewUrl)
  })

  test("loads the app with the desktop preload bridge", async () => {
    // Routes are precompiled above; this covers Electron startup plus the
    // remaining client-side work on slow macOS runners.
    test.setTimeout(150_000)
    const app = await electron.launch({
      args: ["--disable-popup-blocking", "dist-electron/electron/main.js"],
      env: {
        ...process.env,
        ELECTRON_DEV_SERVER_URL: appUrl,
      },
    })

    try {
      const page = await app.firstWindow({ timeout: 90_000 })
      await page.waitForURL(/\/dashboard/)
      await page.waitForLoadState("domcontentloaded")

      await expect
        .poll(async () =>
          page.evaluate(() => window.compassDesktop?.platform.isDesktop ?? false),
        )
        .toBe(true)
      await page.bringToFront()
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
      const previewWindowPromise = app.waitForEvent("window", { timeout: 45_000 })
      await previewTrigger.click()
      const previewWindow = await previewWindowPromise
      await expect
        .poll(() => previewWindow.url(), { timeout: 30_000 })
        .toMatch(/\/preview\/projects\/e2e-project-001\/owner$/)
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
    } finally {
      await app.close()
    }
  })
})
