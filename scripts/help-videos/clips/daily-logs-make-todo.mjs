// Help video: Daily Logs → To-dos and Client Contact on a Log (topic daily.logs.todos-client-contact).
import { PROJECT_URL } from "../lib.mjs"

export const clip = {
  id: "daily-logs-make-todo",
  topicId: "daily.logs.todos-client-contact",
  title: "Turn a daily log line into a to-do",
}

/** Two days from now, as the Due field expects. */
function dueDate() {
  return new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
}

export async function record({ page, open, caption, click, moveTo, pause }) {
  await open(`${PROJECT_URL}/daily-logs`)
  await page.getByRole("button", { name: "Collapse sidebar" }).click()
  const makeTodo = page.getByRole("button", { name: /Make a to-do from "Inspector/ })
  await makeTodo.scrollIntoViewIfNeeded()
  await pause(600)
  await moveTo(page.getByText("Inspector moved the rebar inspection from 9:00 to 10:30.").first())
  await caption("Each line of Issues and Notes / next steps can become a to-do.", 1600)
  await click(makeTodo)

  const dialog = page.getByRole("dialog", { name: "Create to-do" })
  await caption("The line becomes the to-do. Choose who owns it and when it's due.", 1400)
  await click(dialog.getByRole("button", { name: "Choose contact or type a name..." }))
  await page.keyboard.type("Sam", { delay: 50 })
  await pause(500)
  await click(page.getByText("Sam Rivera", { exact: true }).last())
  const due = dialog.getByRole("textbox", { name: "Due" })
  await click(due)
  await due.fill(dueDate())
  await pause(600)
  await moveTo(dialog.getByRole("textbox", { name: "Notes" }))
  await caption("The notes link the to-do back to this log.", 1600)

  await click(dialog.getByRole("button", { name: "Create to-do" }))
  await dialog.waitFor({ state: "hidden", timeout: 30000 })
  const made = page.getByText("To-do made").first()
  await made.waitFor({ timeout: 30000 })
  await pause(600)
  await moveTo(made)
  await caption("The line now shows To-do made, so it can't be made twice.", 2200)
  const todos = page.getByText("Inspector moved the rebar inspection from 9:00 to 10:30.").nth(1)
  await moveTo(todos)
  await caption("The to-do is on the job's list, assigned to Sam and linked to this log.", 3000)
}
