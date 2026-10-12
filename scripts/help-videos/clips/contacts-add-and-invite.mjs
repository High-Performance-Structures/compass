// Help video: Contacts → Add and Invite a Contact (topic contacts.access.add-and-invite).
import { PROJECT_URL } from "../lib.mjs"

export const clip = {
  id: "contacts-add-and-invite",
  topicId: "contacts.access.add-and-invite",
  title: "Add a contact to a project and invite them",
}

export async function record({ page, open, caption, click, moveTo, pause }) {
  await open(`${PROJECT_URL}/contacts`)
  await caption("From the project's Contacts page, choose Add contact.", 1200)
  await click(page.getByRole("button", { name: "Add contact" }).first())
  const dialog = page.getByRole("dialog")

  await caption("Pick the existing directory record. Check the email carefully.", 1000)
  await click(dialog.getByRole("combobox").nth(1))
  await click(page.getByRole("option", { name: /Lakeside Family Trust/ }).first())
  await pause(800)
  const person = page.getByRole("option", { name: /Jordan Lee/ })
  if (await person.count()) await click(person.first())
  await pause(600)

  await caption("Review the contact type, role, and who can see this contact.", 2400)
  await moveTo(dialog.getByRole("checkbox", { name: "Owner workspace" }))
  await click(dialog.getByRole("checkbox", { name: "Owner workspace" }))
  await click(dialog.getByRole("button", { name: "Save contact" }))
  await page.getByText("No project access").first().waitFor({ timeout: 20000 })
  await pause(1000)

  await caption("Invite to Compass for a new person. If they already have a login, it reads Grant project access.", 1600)
  await click(page.getByRole("button", { name: /Grant project access|Invite to Compass/ }).first())
  await pause(1200)
  await caption("Check the recipient, the single project granted, and the message, then send.", 3200)
}
