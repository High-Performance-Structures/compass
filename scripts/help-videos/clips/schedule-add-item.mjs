// Help video: Schedules → Create or Edit a Schedule Item (topic schedule.schedule-item).
import { PROJECT_URL } from "../lib.mjs"

export const clip = {
  id: "schedule-add-item",
  topicId: "schedule.schedule-item",
  title: "Add a schedule item and link its predecessor",
}

export async function record({ page, open, caption, click, type, moveTo, pause }) {
  await open(`${PROJECT_URL}/schedule`)
  await page.getByRole("button", { name: "Collapse sidebar" }).click()
  await caption("Open the project's schedule and choose New item.", 1200)
  await click(page.getByRole("button", { name: "New Schedule Item" }))

  const dialog = page.getByRole("dialog", { name: "New Schedule Item" })
  await caption("Give the item a clear title and choose its phase.", 800)
  await type(dialog.getByRole("textbox", { name: "Schedule item name" }), "Set sill plates")
  await click(dialog.getByRole("combobox", { name: "Phase" }))
  await page.keyboard.type("Framing", { delay: 40 })
  await pause(400)
  await page.keyboard.press("Enter")
  await pause(500)

  await caption("Type the duration in workdays. Compass skips weekends and holidays.", 800)
  const duration = dialog.getByRole("spinbutton", { name: "Duration" })
  await click(duration)
  await duration.selectText()
  await duration.pressSequentially("2", { delay: 60 })
  await pause(800)

  await caption("Under Details, add the item that has to finish first.", 800)
  await click(dialog.getByRole("button", { name: "Details" }))
  const addPredecessor = dialog.getByRole("button", { name: "Add", exact: true })
  await addPredecessor.scrollIntoViewIfNeeded()
  await click(addPredecessor)
  await click(dialog.getByRole("combobox", { name: "Predecessor schedule item" }))
  await page.keyboard.type("Backfill", { delay: 40 })
  await pause(400)
  await page.keyboard.press("Enter")
  await pause(600)
  await moveTo(dialog.getByRole("combobox", { name: "Dependency relationship" }))
  await caption("Finish-to-Start with no lag: it starts the workday after backfill ends.", 1800)

  await click(dialog.getByRole("button", { name: "Create" }))
  const bar = page.getByText("Set sill plates", { exact: true }).first()
  await bar.waitFor({ timeout: 30000 })
  await pause(800)
  await moveTo(bar)
  await caption("Compass places the item after its predecessor. Check the dates before moving on.", 3000)
}
