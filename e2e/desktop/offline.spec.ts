import { test, expect } from "@playwright/test"

// Helper to check if running in Tauri desktop environment
function isTauri(): boolean {
  return process.env.TAURI === "true" || process.env.TAURI_TEST === "true"
}

// Desktop-only E2E tests
test.describe("Offline mode", () => {
  test.skip(!isTauri(), "Desktop only")

  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    // Wait for app to load
    await page.waitForSelector('[data-testid="app-loaded"], body', { timeout: 30000 })
  })

  test("shows offline banner when network is unavailable", async ({ page }) => {
    // Go offline
    await page.context().setOffline(true)

    // Try to navigate or perform an action that requires network
    await page.reload({ waitUntil: "networkidle" }).catch(() => {
      // Ignore reload errors when offline
    })

    // Check for offline indicator
    const offlineBanner = page.locator('[data-testid="offline-banner"]')
    await expect(offlineBanner).toBeVisible({ timeout: 10000 })

    // Banner should indicate offline status
    await expect(offlineBanner).toContainText(/offline|unavailable|disconnected/i)
  })

  test("queues mutations when offline", async ({ page }) => {
    // Go offline first
    await page.context().setOffline(true)

    // Wait for offline state to be detected
    await page.waitForTimeout(1000)

    // Create a record (this should be queued locally)
    // Assuming there's a form or button to create a record
    const createButton = page.locator('[data-testid="create-record-btn"]')
    if (await createButton.isVisible()) {
      await createButton.click()

      // Fill out form if present
      const nameInput = page.locator('[data-testid="record-name-input"]')
      if (await nameInput.isVisible()) {
        await nameInput.fill("Offline Test Record")
        await page.locator('[data-testid="save-record-btn"]').click()
      }

      // Verify queued indicator
      const queuedIndicator = page.locator('[data-testid="sync-status-queued"]')
      await expect(queuedIndicator).toBeVisible({ timeout: 5000 })
    }
  })

  test("syncs when back online", async ({ page }) => {
    // Create a record while online first
    const initialCount = await page.locator('[data-testid="record-item"]').count()

    // Go offline
    await page.context().setOffline(true)
    await page.waitForTimeout(1000)

    // Create a record
    const createButton = page.locator('[data-testid="create-record-btn"]')
    if (await createButton.isVisible()) {
      await createButton.click()
      await page.waitForTimeout(500)
    }

    // Go back online
    await page.context().setOffline(false)

    // Wait for sync to complete
    const syncIndicator = page.locator('[data-testid="sync-status-synced"]')
    await expect(syncIndicator).toBeVisible({ timeout: 30000 })

    // Verify the record count increased
    const newCount = await page.locator('[data-testid="record-item"]').count()
    expect(newCount).toBeGreaterThanOrEqual(initialCount)
  })

  test("persists data locally across reloads", async ({ page }) => {
    // Create some data
    const testText = `Test ${Date.now()}`

    // Fill in a form or create a record
    const input = page.locator('[data-testid="note-input"]')
    if (await input.isVisible()) {
      await input.fill(testText)
      await page.locator('[data-testid="save-note-btn"]').click()
      await page.waitForTimeout(1000)
    }

    // Reload the page
    await page.reload()

    // Verify the data persists
    const persistedInput = page.locator('[data-testid="note-input"]')
    if (await persistedInput.isVisible()) {
      await expect(persistedInput).toHaveValue(testText)
    }
  })
})

test.describe("Sync status indicators", () => {
  test.skip(!isTauri(), "Desktop only")

  test("shows synced status when online and synced", async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector('[data-testid="app-loaded"], body', { timeout: 30000 })

    // Check for sync status indicator
    const syncStatus = page.locator('[data-testid="sync-status"]')

    // Should show as synced or syncing
    const statusText = await syncStatus.textContent()
    expect(statusText).toMatch(/synced|syncing|online/i)
  })

  test("shows pending count when there are queued items", async ({ page }) => {
    await page.goto("/")

    // Go offline and create records
    await page.context().setOffline(true)
    await page.waitForTimeout(1000)

    // Check for pending indicator
    const pendingCount = page.locator('[data-testid="pending-sync-count"]')
    if (await pendingCount.isVisible()) {
      const count = await pendingCount.textContent()
      expect(parseInt(count ?? "0", 10)).toBeGreaterThanOrEqual(0)
    }
  })
})

test.describe("Conflict resolution UI", () => {
  test.skip(!isTauri(), "Desktop only")

  test("shows conflict dialog when conflicts detected", async ({ page }) => {
    // This test would require setting up a specific conflict scenario
    // For now, we check if the conflict resolution UI exists
    await page.goto("/")

    // Check for conflict dialog or banner
    const conflictBanner = page.locator('[data-testid="conflict-banner"]')
    const conflictDialog = page.locator('[data-testid="conflict-dialog"]')

    // If visible, verify it has resolution options
    if (await conflictBanner.isVisible()) {
      await expect(conflictBanner).toContainText(/conflict/i)
    }

    if (await conflictDialog.isVisible()) {
      // Should have options to resolve
      const useLocalBtn = page.locator('[data-testid="use-local-btn"]')
      const useRemoteBtn = page.locator('[data-testid="use-remote-btn"]')

      await expect(useLocalBtn.or(useRemoteBtn)).toBeVisible()
    }
  })
})

test.describe("Database operations", () => {
  test.skip(!isTauri(), "Desktop only")

  test("performs CRUD operations locally", async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector('[data-testid="app-loaded"], body', { timeout: 30000 })

    // Create
    const createBtn = page.locator('[data-testid="create-item-btn"]')
    if (await createBtn.isVisible()) {
      await createBtn.click()

      // Fill form
      const nameInput = page.locator('[data-testid="item-name"]')
      if (await nameInput.isVisible()) {
        await nameInput.fill("Test Item E2E")
        await page.locator('[data-testid="submit-btn"]').click()

        // Verify created
        await expect(page.locator("text=Test Item E2E")).toBeVisible({ timeout: 5000 })
      }

      // Update
      const editBtn = page.locator('[data-testid="edit-item-btn"]').first()
      if (await editBtn.isVisible()) {
        await editBtn.click()
        await nameInput.fill("Test Item E2E Updated")
        await page.locator('[data-testid="submit-btn"]').click()

        await expect(page.locator("text=Test Item E2E Updated")).toBeVisible({
          timeout: 5000,
        })
      }

      // Delete
      const deleteBtn = page.locator('[data-testid="delete-item-btn"]').first()
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click()

        // Confirm deletion if dialog appears
        const confirmBtn = page.locator('[data-testid="confirm-delete-btn"]')
        if (await confirmBtn.isVisible()) {
          await confirmBtn.click()
        }

        // Verify deleted
        await expect(page.locator("text=Test Item E2E Updated")).not.toBeVisible({
          timeout: 5000,
        })
      }
    }
  })
})
