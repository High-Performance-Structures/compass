// Help video: Ask Jarvis → Find and Summarize Live Compass Records (topic jarvis.find-records).
// Needs a working AI provider; see docs/development/help-videos.md.
import { PROJECT_URL } from "../lib.mjs"

export const clip = {
  id: "jarvis-find-records",
  topicId: "jarvis.find-records",
  title: "Ask Jarvis to find and summarize records",
  captionAt: "top",
}

export async function record({ page, open, caption, click, pause }) {
  await open(PROJECT_URL)
  await caption("From a project, open Jarvis.", 1000)
  await click(page.getByRole("button", { name: "Toggle Jarvis" }))
  const input = page.getByPlaceholder("Ask Jarvis...").last()
  await input.waitFor()

  await caption("Ask for a summary of live records. Name the project number to be specific.", 800)
  await click(input)
  await page.keyboard.type("Find the latest daily logs for H-DEV-001 and summarize the issues.", { delay: 32 })
  await pause(500)
  await page.keyboard.press("Enter")

  await caption("Jarvis looks up the records you can access.", 0)
  await page.getByText(/groundwater|rebar|inspect/i).last().waitFor({ timeout: 90000 })
  // Let the answer finish streaming before moving on.
  await page.getByRole("button", { name: /copy/i }).last().waitFor({ timeout: 90000 }).catch(() => {})
  await pause(2500)
  await caption("Use the links to open the actual records before relying on a summary.", 3500)
}
