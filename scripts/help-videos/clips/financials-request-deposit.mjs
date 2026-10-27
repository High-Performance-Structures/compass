// Help video: Financial Workflows → Contract Deposits (topic financials.contract-deposits).
import { PROJECT_URL } from "../lib.mjs"

export const clip = {
  id: "financials-request-deposit",
  topicId: "financials.contract-deposits",
  title: "Request a deposit and record the payment",
}

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

export async function record({ page, open, caption, click, type, moveTo, pause }) {
  await open(`${PROJECT_URL}/financials`)
  await page.getByRole("button", { name: "Collapse sidebar" }).click()
  const deposits = page.getByText("Contract deposits").first()
  await moveTo(deposits)
  await caption("Deposits live on the project's Financials page. To ask the client for one, choose Request deposit.", 1400)
  await click(page.getByRole("button", { name: "Request deposit" }))

  const dialog = page.getByRole("dialog", { name: "Request a deposit" })
  await caption("Enter the amount and due date. A note prints on the request.", 600)
  await type(dialog.getByRole("textbox", { name: "Deposit amount" }), "25000")
  const due = dialog.getByRole("textbox", { name: "Due date" })
  await click(due)
  await due.fill(isoDaysFromNow(10))
  await pause(500)
  await type(
    dialog.getByRole("textbox", { name: "Note to the client (printed on the request)" }),
    "Deposit to schedule the foundation pour."
  )
  await click(dialog.getByRole("button", { name: "Request deposit" }))
  await dialog.waitFor({ state: "hidden", timeout: 30000 })

  const row = page.getByText("Requested", { exact: true }).first()
  await row.waitFor({ timeout: 30000 })
  await pause(800)
  await moveTo(row)
  await caption("The numbered request shows to the owner in the client portal right away.", 2000)
  await moveTo(page.getByText("Create email").first())
  await caption("Create email or Send notification lets the owner know. Deposit request opens its Print Preview.", 2600)

  await caption("When the money arrives, choose Record payment.", 600)
  await click(page.getByRole("button", { name: "Record payment" }).first())
  const payment = page.getByRole("dialog", { name: "Edit deposit" })
  const received = payment.getByRole("textbox", { name: "Date received" })
  await click(received)
  await received.fill(isoDaysFromNow(0))
  await pause(400)
  await type(payment.getByRole("textbox", { name: "Check or reference no." }), "4417")
  await click(payment.getByRole("button", { name: "Save deposit" }))
  await payment.waitFor({ state: "hidden", timeout: 30000 })
  await pause(1000)
  await moveTo(page.getByText("Not yet applied").first())
  await caption("It's received, and will be applied to the next draft pay applications.", 3000)
}
