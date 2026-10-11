// Help video: Photo Review → Approve and Set Visibility (topic photos.visibility.approve-visibility).
import { PROJECT_URL } from "../lib.mjs"

export const clip = {
  id: "photos-approve-visibility",
  topicId: "photos.visibility.approve-visibility",
  title: "Approve photos and set who can see them",
}

export async function record({ page, open, caption, click, moveTo, pause }) {
  await open(`${PROJECT_URL}/photos`)
  await caption("New photos start internal and wait for review.", 2200)

  await caption("Select the photos you want to approve.", 1000)
  await click(page.getByRole("button", { name: "Select North footing forms" }))
  await click(page.getByRole("button", { name: "Select Rebar inspection" }))

  await caption("Choose each audience. Owner, Subs/vendors and Public are separate choices.", 1400)
  await moveTo(page.getByRole("combobox", { name: "Photo type" }))
  await pause(500)
  await click(page.getByRole("checkbox", { name: "Owner" }))

  await caption("Apply visibility. Anything left unchecked stays internal.")
  await click(page.getByRole("button", { name: "Apply visibility" }))
  await page.getByText("2", { exact: true }).first().waitFor({ timeout: 20000 })
  await pause(800)

  await caption("Photos that shouldn't be used can be rejected instead.", 1200)
  await click(page.getByRole("button", { name: "Select Site cleanup" }))
  await moveTo(page.getByRole("button", { name: "Reject selected" }))
  await caption("Owner-visible is not public, and nothing makes the Drive folder public.", 2800)
}
