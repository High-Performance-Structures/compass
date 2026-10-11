// Help video: Schedules → Ask Jarvis to Help with the Schedule (topic schedule.jarvis-schedule).
// Needs a working AI provider; see docs/development/help-videos.md.
import { PROJECT_URL } from "../lib.mjs"

export const clip = {
  id: "jarvis-schedule-confirm",
  topicId: "schedule.jarvis-schedule",
  title: "Change the schedule with Jarvis and Confirm",
  captionAt: "top",
}

export async function record({ page, open, caption, click, moveTo, pause }) {
  await open(PROJECT_URL)
  await caption("Ask Jarvis for a schedule change in plain words.", 1000)
  await click(page.getByRole("button", { name: "Toggle Jarvis" }))
  const input = page.getByPlaceholder("Ask Jarvis...").last()
  await click(input)
  await page.keyboard.type("On H-DEV-001, push 'Backfill north side' back by one workday.", { delay: 32 })
  await pause(500)
  await page.keyboard.press("Enter")

  // Jarvis's card, not the overview's own schedule Confirm buttons.
  const card = page.locator("div.my-2.rounded-lg.border", { hasText: 'Update "Backfill north side"' }).last()
  const confirm = card.getByRole("button", { name: "Confirm" })
  await confirm.waitFor({ timeout: 90000 })
  await pause(1500)
  await caption("Nothing changes until you Confirm. Check the project, task, and dates first.", 1200)
  await moveTo(card)
  await pause(2000)
  await click(confirm)
  await pause(2500)

  await caption("Then open the schedule to check the task and the dates that follow it.", 1000)
  await click(page.getByRole("button", { name: "Toggle Jarvis" }))
  await click(page.getByRole("link", { name: "View schedule" }).first())
  await page.waitForURL(/\/schedule/)
  await page.waitForLoadState("networkidle")
  // The schedule row's exact name, not the sentences mentioning it in chat.
  const task = page.getByText("Backfill north side", { exact: true }).first()
  await task.waitFor({ timeout: 30000 })
  await pause(800)
  await moveTo(task)
  await caption("Confirming doesn't publish the revised schedule. Publish it separately.", 3200)
}
