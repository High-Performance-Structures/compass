// Help video: Owner Updates → Draft or Redraft with Jarvis (topic owner.updates.draft-with-jarvis).
// Needs a working AI provider; see docs/development/help-videos.md.
import { PROJECT_URL } from "../lib.mjs"

export const clip = {
  id: "owner-updates-draft-with-jarvis",
  topicId: "owner.updates.draft-with-jarvis",
  title: "Draft an owner update with Jarvis",
  captionAt: "top",
}

export async function record({ page, open, caption, click, moveTo, pause }) {
  await open(`${PROJECT_URL}/daily-logs`)
  await caption("Select the daily logs for the reporting period, then build a draft.", 1000)
  await click(page.getByRole("button", { name: "Select shown" }))
  await click(page.getByRole("button", { name: "Build draft from selected" }))
  await page.waitForURL(/owner-updates\//, { timeout: 120000 })
  await page.waitForLoadState("networkidle")
  await pause(800)

  await caption("In the update editor, choose Draft with Jarvis.", 800)
  const draft = page.getByRole("button", { name: "Draft with Jarvis" })
  await click(draft)
  await caption("Wait for the draft to finish. Only one draft request runs at a time.", 0)
  // The button is unavailable while drafting and returns when the draft is ready.
  await page.waitForTimeout(1500)
  await draft.waitFor({ state: "visible", timeout: 120000 })
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Draft with Jarvis") && !b.disabled),
    undefined,
    { timeout: 120000 }
  )
  await pause(1500)

  await caption("Review every section: period, source logs, schedule claims, captions, and links.", 800)
  const summary = page.getByRole("heading", { name: "Summary", level: 2 })
  await summary.scrollIntoViewIfNeeded()
  await moveTo(summary)
  await page.mouse.wheel(0, 250)
  await pause(2500)
  await caption("A Jarvis draft isn't published or approved. Edit it, then save or publish.", 3200)
}
