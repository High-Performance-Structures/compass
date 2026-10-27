// Help video: Client Meetings → Start or Schedule a Project Meeting (topic client.meetings.meet-with-client).
// Stops before sending: booking the Meet needs Google, which local recording doesn't have.
import { PROJECT_URL } from "../lib.mjs"

export const clip = {
  id: "client-meetings-schedule",
  topicId: "client.meetings.meet-with-client",
  title: "Schedule a Google Meet with the client",
}

/** The next weekday, as the Date field expects. */
function nextWeekday() {
  const date = new Date(Date.now() + 86_400_000)
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export async function record({ page, open, caption, click, type, moveTo, pause }) {
  await open(PROJECT_URL)
  await page.getByRole("button", { name: "Collapse sidebar" }).click()
  await caption("Open the project and choose Project Meetings.", 1000)
  await click(page.getByRole("button", { name: /Project Meetings/ }).first())

  const dialog = page.getByRole("dialog", { name: "New project meeting" })
  await caption("Start now opens the call right away. Schedule books it for later.", 800)
  await click(dialog.getByRole("radio", { name: "Schedule" }))
  const date = dialog.getByRole("textbox", { name: "Date" })
  await click(date)
  await date.fill(nextWeekday())
  const time = dialog.getByRole("textbox", { name: "Time" })
  await click(time)
  await time.fill("10:00")
  await pause(600)

  await caption("Invite the client by contact or email. Guests don't need a Compass or Google account.", 600)
  await click(dialog.getByRole("combobox", { name: "Clients, vendors and guests" }))
  await page.keyboard.type("jordan.lee@example.com", { delay: 30 })
  await pause(400)
  await page.keyboard.press("Enter")
  await page.keyboard.press("Escape")
  await pause(600)
  await caption("Add coworkers under Staff. They also get a Compass notification.", 600)
  await click(dialog.getByRole("combobox", { name: "Staff (optional)" }))
  await page.keyboard.type("Sam", { delay: 50 })
  await pause(500)
  await page.keyboard.press("Enter")
  await page.keyboard.press("Escape")
  await pause(600)
  await type(
    dialog.getByRole("textbox", { name: "Note for the invitation (optional)" }),
    "Walk through the foundation schedule and the deposit."
  )

  const send = dialog.getByRole("button", { name: "Schedule and send invites" })
  await send.scrollIntoViewIfNeeded()
  await moveTo(send)
  // The send button sits where the caption usually goes.
  await page.evaluate(() => {
    const element = document.getElementById("help-video-caption")
    if (element) Object.assign(element.style, { top: "24px", bottom: "auto" })
  })
  await caption("Choose Schedule and send invites. Google emails each guest the Meet link and dial-in.", 3200)
}
