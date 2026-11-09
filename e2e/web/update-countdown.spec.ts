import { expect, test, type Page } from "@playwright/test"

// Simulates a Compass deploy: the version check starts answering from a newer
// version. Open tabs must count down from the server's live time, then ask for
// a refresh, and a refresh must bring back text that was typed but not saved.

async function announceNewVersion(page: Page, wentLiveMsAgo: number): Promise<void> {
  await page.route("**/api/deployment-version", async (route) => {
    const now = Date.now()
    await route.fulfill({
      json: {
        deploymentId: "e2e-newer-version",
        versionId: null,
        workerName: null,
        liveAt: new Date(now - wentLiveMsAgo).toISOString(),
        serverNow: new Date(now).toISOString(),
      },
      headers: { "Cache-Control": "no-store" },
    })
  })
}

test.describe("Compass update countdown", () => {
  test("counts down from the server's time, then restores typed text after refresh", async ({ page }) => {
    await page.clock.install()
    await announceNewVersion(page, 15_000)
    await page.goto("/login")

    const notice = page.getByTestId("compass-update-notice")
    await expect(notice).toContainText("Compass will update in")
    await expect(notice).toContainText("save your work now")
    await expect(page.getByTestId("compass-update-countdown")).toHaveText(/^1:4\d$/)

    const email = page.getByLabel("Email", { exact: true }).and(page.locator("input"))
    await email.fill("unsaved-typing@example.test")

    await page.clock.fastForward(2 * 60_000)
    await expect(notice).toContainText("Compass has updated")

    // After the refresh the live version is this build again, so no notice.
    await page.unroute("**/api/deployment-version")
    await notice.getByRole("button", { name: "Refresh Compass" }).click()
    await page.waitForLoadState("load")
    await page.clock.fastForward(1_000)

    await expect(page.getByTestId("unsaved-text-restored")).toContainText(
      "Restored your unsaved text"
    )
    await expect(email).toHaveValue("unsaved-typing@example.test")
    await expect(page.getByTestId("compass-update-notice")).toHaveCount(0)

    await page.getByTestId("unsaved-text-restored").getByRole("button", { name: "Discard" }).click()
    await expect(email).toHaveValue("")
  })

  test("gives a tab that notices late at least 30 seconds", async ({ page }) => {
    await announceNewVersion(page, 10 * 60_000)
    await page.goto("/login")
    await expect(page.getByTestId("compass-update-countdown")).toHaveText(/^0:(30|29|28)$/)
  })
})
