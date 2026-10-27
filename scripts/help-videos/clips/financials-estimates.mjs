// Help video: Financial Workflows → Estimates (topic financials.estimates).
import { PROJECT_URL } from "../lib.mjs"

export const clip = {
  id: "financials-estimates",
  topicId: "financials.estimates",
  title: "Start an estimate and add a line",
}

export async function record({ page, open, caption, click, type, moveTo, pause }) {
  await open(`${PROJECT_URL}/estimate`)
  await page.getByRole("button", { name: "Collapse sidebar" }).click()
  await caption("Open the project's Estimate. Start from a template or a blank estimate.", 1200)
  await click(page.getByRole("button", { name: "Create blank estimate" }))
  await page.getByText("Estimate draft created.").first().waitFor({ timeout: 30000 })
  await pause(800)

  await caption("Add a line using an approved division and cost code.", 1000)
  await click(page.getByRole("button", { name: "Add estimate line" }))
  await click(page.getByRole("combobox", { name: "CSI division" }))
  await click(page.getByRole("option", { name: /Concrete/ }).first())
  await click(page.getByRole("combobox", { name: "Cost code" }))
  await click(page.getByRole("option", { name: /03-3000/ }).first())

  await caption("Enter quantities and costs carefully, then check the line total.", 800)
  await type(page.getByRole("textbox", { name: "Description" }), "North footing concrete")
  const quantity = page.getByRole("textbox", { name: "Quantity" }).or(page.getByRole("spinbutton", { name: "Quantity" })).first()
  await click(quantity)
  await quantity.fill("")
  await quantity.pressSequentially("24", { delay: 60 })
  const unitCost = page.getByRole("textbox", { name: "Unit cost" }).or(page.getByRole("spinbutton", { name: "Unit cost" })).first()
  await type(unitCost, "185")
  await pause(800)
  await click(page.getByRole("button", { name: "Add line" }))
  await page.getByText("North footing concrete").first().waitFor({ timeout: 20000 })
  await page.mouse.wheel(0, -3000)
  await pause(1000)

  await caption("Totals update as you go. Reconcile them before sharing.", 2000)
  await caption("Use Work on to switch between areas such as builder fee, report format, and terms.", 1000)
  const workOn = page.getByRole("combobox").filter({ hasText: "Estimate costs" }).first()
  await click(workOn)
  await click(page.getByRole("option", { name: "Builder fee & markup" }))
  await pause(2200)
  await click(page.getByRole("combobox").filter({ hasText: "Builder fee & markup" }).first())
  await click(page.getByRole("option", { name: "Estimate costs" }))
  await pause(800)
  await moveTo(page.getByText("Print Preview", { exact: true }).first())
  await caption("Print Preview shows the estimate the way the customer will see it.", 2600)
}
