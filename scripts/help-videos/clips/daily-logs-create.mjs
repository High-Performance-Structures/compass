// Help video: Daily Logs → Create a Daily Log (topic daily.logs.create-log).
import { PROJECT_URL } from "../lib.mjs"

export const clip = {
  id: "daily-logs-create",
  topicId: "daily.logs.create-log",
  title: "Create a daily log",
}

export async function record({ page, open, caption, click, type, pause }) {
  await open(`${PROJECT_URL}/daily-logs`)
  await caption("Open the project's Daily Logs and choose New daily log.")
  await click(page.getByRole("button", { name: "New daily log" }))

  await caption("Check the log date, then record the conditions.", 1200)
  await type(page.getByRole("textbox", { name: "Temp" }), "54")
  await type(page.getByRole("textbox", { name: "Weather" }), "Partly cloudy, light wind")

  await caption("Describe the work in facts a teammate can follow later.", 1200)
  await type(
    page.getByRole("textbox", { name: "Work completed" }),
    "Set forms for the north footing. Inspector approved rebar placement at 10:30."
  )
  await type(page.getByRole("textbox", { name: "Crew present" }), "Framing crew (4), concrete sub (3)")
  await type(page.getByRole("textbox", { name: "Hours worked" }), "56")

  await caption("Add issues, safety notes, and specific next steps.", 1200)
  await type(page.getByRole("textbox", { name: "Safety" }), "No incidents.")
  await type(
    page.getByRole("textbox", { name: "Notes / Next" }),
    "Pour north footing Tuesday; confirm pump truck by Monday noon."
  )

  await caption("Save the log. It goes to review before anyone shares it with the owner.")
  await click(page.getByRole("button", { name: "Save daily log" }))
  await page.getByText("Set forms for the north footing").first().waitFor({ timeout: 30000 })
  await page.mouse.wheel(0, -2000)
  await pause(1200)
  await caption("The new log appears in the list, ready for review.", 2500)
}
