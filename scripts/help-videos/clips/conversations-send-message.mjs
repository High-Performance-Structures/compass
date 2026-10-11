// Help video: Conversations → Send a Message (topic conversations.send-message).
import { BASE_URL } from "../lib.mjs"

export const clip = {
  id: "conversations-send-message",
  topicId: "conversations.send-message",
  title: "Send a project message",
  captionAt: "top",
}

export async function record({ page, open, caption, click, moveTo, pause }) {
  await open(`${BASE_URL}/dashboard/conversations/help-video-channel`)
  await caption("Open the project's channel under Project messages.", 1200)
  await moveTo(page.getByText("h-dev-001-project-team").first())
  await page.getByText("Concrete sub confirmed").first().waitFor()

  await caption("Check the channel name and project before you write.", 2200)

  await caption("Mention only the people who need to act.", 1000)
  // The channel's own editor, not the Ask Jarvis box.
  const composer = page.locator('[contenteditable="true"]:has([data-placeholder^="Message h-dev-001"])')
  await click(composer)
  await page.keyboard.type("@Sam", { delay: 120 })
  await pause(800)
  await click(page.getByRole("option", { name: /Sam Rivera/ }).or(page.getByRole("button", { name: /Sam Rivera/ })).first())
  await caption("Include searchable context: project number, subject, or scope.", 800)
  await page.keyboard.type(
    "H-DEV-001 pump truck is booked for 7:00 Tuesday. Can you confirm the inspector?",
    { delay: 28 }
  )
  await pause(600)

  await caption("Send. Mentions notify people according to their own preferences.")
  await page.keyboard.press("Enter")
  await page.getByText("pump truck is booked").last().waitFor()
  await pause(2400)
}
