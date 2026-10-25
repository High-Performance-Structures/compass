// Help video: Schedules → Schedule Templates (topic schedule.schedule-templates).
import { BASE_URL, PROJECT_URL } from "../lib.mjs"

export const clip = {
  id: "schedule-save-template",
  topicId: "schedule.schedule-templates",
  title: "Save a schedule as a template and import it into another job",
}

/** Two Mondays out, so the imported schedule starts on a workday. */
function nextJobStart() {
  const date = new Date()
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7 || 7) + 7)
  return date.toISOString().slice(0, 10)
}

export async function record({ page, open, caption, click, moveTo, pause }) {
  await open(`${PROJECT_URL}/schedule`)
  await page.getByRole("button", { name: "Collapse sidebar" }).click()
  await caption("To reuse this schedule on other jobs, save it as a template.", 1400)
  await click(page.getByRole("button", { name: "More schedule actions" }))
  await click(page.getByRole("menuitem", { name: "Save schedule as template" }))

  const saveDialog = page.getByRole("dialog", { name: "Save schedule as template" })
  const name = saveDialog.getByRole("textbox", { name: "Template name" })
  await click(name)
  await name.selectText()
  await name.pressSequentially("Footing and framing sequence", { delay: 28 })
  await pause(400)
  await moveTo(saveDialog.getByText(/schedule items? ·/))
  await caption("Items, workdays, spacing, and predecessors are saved. Progress stays with this job.", 2200)
  await click(saveDialog.getByRole("button", { name: "Save template" }))
  await saveDialog.getByRole("link", { name: "Open in Template Library" }).waitFor({ timeout: 30000 })
  await caption("It's saved in the Template Library as a Schedule template.", 1600)
  await click(saveDialog.getByRole("button", { name: "Done" }))

  await caption("Now open the new job's schedule.", 0)
  await page.goto(`${BASE_URL}/dashboard/projects/compass-developer-2/schedule`, { waitUntil: "networkidle" })
  await pause(1200)
  await click(page.getByRole("button", { name: "More schedule actions" }))
  await click(page.getByRole("menuitem", { name: "Import schedule items" }))

  const importDialog = page.getByRole("dialog", { name: "Import schedule items from a template" })
  await caption("Pick the saved schedule. Every item comes in selected.", 600)
  await click(importDialog.getByRole("combobox", { name: "Choose published schedule template" }))
  await page.keyboard.type("Footing", { delay: 40 })
  await pause(400)
  await page.keyboard.press("Enter")
  await pause(800)
  await caption("Set the first item's start date. The rest follow this job's workday calendar.", 600)
  const anchor = importDialog.getByLabel("First-item start date")
  await click(anchor)
  await anchor.fill(nextJobStart())
  await pause(1200)
  await caption("", 0)
  const importButton = importDialog.getByRole("button", { name: /^Import whole schedule/ })
  await click(importButton)
  await importDialog.waitFor({ state: "hidden", timeout: 30000 })

  const lastItem = page.getByText("Frame first-floor walls", { exact: true }).first()
  await lastItem.waitFor({ timeout: 30000 })
  await pause(1000)
  await moveTo(lastItem)
  await caption("The whole schedule is in, predecessors and all. Adjust anything this job needs.", 3200)
}
