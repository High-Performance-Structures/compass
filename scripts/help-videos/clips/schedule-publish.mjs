// Help video: Schedules → Publish a Schedule (topic schedule.publish-schedule).
import { PROJECT_URL } from "../lib.mjs"

export const clip = {
  id: "schedule-publish",
  topicId: "schedule.publish-schedule",
  title: "Publish a schedule, then publish a change with a reason",
}

export async function record({ page, open, caption, click, type, moveTo, pause }) {
  await open(`${PROJECT_URL}/schedule`)
  await page.getByRole("button", { name: "Collapse sidebar" }).click()
  await moveTo(page.getByText("Draft · Never published"))
  await caption("A draft schedule is internal. Edit it freely; no shift reason is asked for.", 2200)

  await caption("When it's ready, choose Publish schedule.", 800)
  await click(page.getByRole("button", { name: "Publish schedule" }))
  await caption("The first publication needs no change reason.", 1400)
  await click(page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }))
  const published = page.getByText(/^Published /).first()
  await published.waitFor({ timeout: 30000 })
  await moveTo(published)
  await caption("Owners and trade partners can now see the visible items.", 2000)

  await caption("After publishing, a date change asks for a shift reason.", 800)
  const editButton = page.getByRole("button", { name: "Edit Backfill north side" })
  const editHandle = await editButton.elementHandle()
  await click(editButton)
  const dialog = page.getByRole("dialog", { name: "Edit Schedule Item" })
  // Reaching the row's edit button scrolls the item list sideways; put the
  // titles back in view for when the dialog closes.
  await editHandle?.evaluate((button) => {
    for (let element = button.parentElement; element; element = element.parentElement) element.scrollLeft = 0
  })
  const duration = dialog.getByRole("spinbutton", { name: "Duration" })
  await click(duration)
  await duration.selectText()
  await duration.pressSequentially("3", { delay: 60 })
  await pause(600)
  const reason = dialog.getByRole("textbox", { name: "Schedule shift reason" })
  await reason.scrollIntoViewIfNeeded()
  await type(reason, "Wet soil; backfill needs an extra day to compact.")
  await caption("The reason is saved in the schedule's activity history.", 1400)
  await click(dialog.getByRole("button", { name: "Save", exact: true }))
  await dialog.waitFor({ state: "hidden", timeout: 30000 })

  const publishChanges = page.getByRole("button", { name: "Publish changes" })
  await publishChanges.waitFor({ timeout: 30000 })
  await moveTo(publishChanges)
  await caption("Viewers still see the last published version until you publish the change.", 2200)
  await click(publishChanges)
  const changeReason = page.getByRole("textbox", { name: "Change reason" })
  await type(changeReason, "Backfill extended one day for wet soil.")
  await click(page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }))
  await changeReason.waitFor({ state: "hidden", timeout: 30000 })
  await pause(800)
  await moveTo(page.getByText(/^Published /).first())
  await caption("The revised schedule is live, with its change reason on record.", 3000)
}
