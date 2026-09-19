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
    const videoDir = testInfo.outputPath("videos")
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
        ELECTRON_DEV_SERVER_URL: "http://127.0.0.1:3000",
      },
    })

    try {
      const page = await app.firstWindow()
      mainVideo = page.video()
      await page.waitForLoadState("domcontentloaded")

      const demoUrl = new URL(
        "/demo",
        process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      ).toString()
      const demoResponse = await page.goto(demoUrl)
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
      previewVideo = previewWindow.video()
      await expect(previewWindow).toHaveURL(
        /\/preview\/projects\/e2e-project-001\/owner$/,
      )
      await expect(previewWindow.locator("body")).not.toContainText(
        /This page could not be found|Application error|Internal Server Error|404/i,
      )
      await expect(
        previewWindow.getByText("Owner workspace", { exact: true }),
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
      await previewWindow.close()

      await expect
        .poll(async () =>
          page.evaluate(() => window.compassDesktop?.window.isFocused())
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
