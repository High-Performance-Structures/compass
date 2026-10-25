// Help video: Schedules → Workday Exceptions (topic schedule.workday-exceptions).
import { PROJECT_URL } from "../lib.mjs"

export const clip = {
  id: "schedule-workday-exception",
  topicId: "schedule.workday-exceptions",
  title: "Add a weather day and review the moved dates",
}

/** The Wednesday of the seeded schedule's first week, while forms cure. */
function weatherDay() {
  const date = new Date()
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7 || 7) + 2)
  return date.toISOString().slice(0, 10)
}

export async function record({ page, open, caption, click, type, moveTo, pause }) {
  await open(`${PROJECT_URL}/schedule`)
  await page.getByRole("button", { name: "Collapse sidebar" }).click()
  await moveTo(page.getByText("Cure and strip forms", { exact: true }).first())
  await caption("Weather shuts the site down mid-week. Record it as a workday exception.", 1600)
  await click(page.getByRole("button", { name: "More schedule actions" }))
  await click(page.getByRole("menuitem", { name: "Workday Exceptions" }))

  const sheet = page.getByRole("dialog", { name: "Workday Exceptions" })
  await click(sheet.getByRole("button", { name: "Workday Exception" }).last())
  const form = page.getByRole("dialog", { name: "New Workday Exception" })
  await type(form.getByRole("textbox", { name: "Title" }), "Snow day")
  const day = weatherDay()
  await click(form.getByLabel("Start Date"))
  await form.getByLabel("Start Date").fill(day)
  await form.getByLabel("End Date").fill(day)
  await pause(600)

  await caption("Non-working time removes the day from the work calendar.", 800)
  await click(form.getByRole("combobox").nth(1))
  await click(page.getByRole("option", { name: "Weather Day" }))
  await pause(500)
  await caption("A draft schedule needs no reason. Once published, you'll add one here.", 1800)
  await click(form.getByRole("button", { name: "Create" }))
  await form.waitFor({ state: "hidden", timeout: 30000 })
  await pause(1200)
  await caption("The exception is listed, and the schedule recalculates around it.", 1800)

  await page.keyboard.press("Escape")
  await sheet.waitFor({ state: "hidden", timeout: 10000 })
  await pause(1200)
  await moveTo(page.getByText("Backfill north side", { exact: true }).first())
  await caption("Items after the snow day moved one workday later. Review them before publishing.", 3200)
}
