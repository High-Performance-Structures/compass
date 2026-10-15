import { describe, expect, it } from "vitest"

import {
  addWorkLine,
  emptyLogDraft,
  errorControlId,
  filledWorkLines,
  localDateInputValue,
  logDraftSchema,
  logFieldsHtml,
  logRequirements,
  removeWorkLine,
  saveButtonLabel,
  updateLogDraft,
} from "./daily-log-form"
import { emptyFollowUpDraft, followUpAction } from "./daily-log-followups"

const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
const form = {
  costCodes: [{ code: "01 71 13", name: "Mobilization", label: "01 71 13 Mobilization", group: "" }],
  requirements: { requireCostCodeTime: true, requiredFields: ["crewPresent" as const] },
  followUps: null,
}

describe("Field Mode daily log draft", () => {
  it("keeps typed values by control name, including line parts", () => {
    let draft = emptyLogDraft("2026-10-13")
    draft = updateLogDraft(draft, "workCompleted", "Poured footing")
    draft = updateLogDraft(draft, "workLines.0.hours", "3")
    draft = addWorkLine(draft)
    draft = updateLogDraft(draft, "workLines.1.costCode", "01 71 13")
    draft = updateLogDraft(draft, "unknown", "ignored")
    expect(draft.workCompleted).toBe("Poured footing")
    expect(draft.workLines).toEqual([
      { costCode: "", hours: "3", description: "" },
      { costCode: "01 71 13", hours: "", description: "" },
    ])
    expect(filledWorkLines(removeWorkLine(draft, 0).workLines)).toHaveLength(1)
    expect(removeWorkLine(removeWorkLine(draft, 0), 0).workLines).toHaveLength(1)
  })

  it("uses the phone's local date, not UTC", () => {
    expect(localDateInputValue(new Date(2026, 9, 13, 23, 30))).toBe("2026-10-13")
  })

  it("only requires a cost code when the phone has the list", () => {
    expect(logRequirements(null).requireCostCodeTime).toBe(false)
    expect(logRequirements({ ...form, costCodes: [] }).requireCostCodeTime).toBe(false)
    expect(logRequirements(form).requireCostCodeTime).toBe(true)
  })

  it("renders typed values, required marks and errors", () => {
    const draft = updateLogDraft(emptyLogDraft("2026-10-13"), "workCompleted", 'Set "A" <forms>')
    const html = logFieldsHtml({ draft, form, errors: new Map([["crewPresent", "Who was on site is required."]]), escape })
    expect(html).toContain("Set &quot;A&quot; &lt;forms>")
    expect(html).toContain("Who was on site<span class=\"required-tag\">Required</span>")
    expect(html).toContain('id="log-crewPresent" name="crewPresent"')
    expect(html).toContain("1 required item needs attention")
    expect(errorControlId("workLines.0.hours")).toBe("log-line-0-hours")
    expect(errorControlId("workLines")).toBe("log-line-0-costCode")
  })

  it("confirms the save on the button", () => {
    expect(saveButtonLabel("idle", false)).toBe("Save for sync")
    expect(saveButtonLabel("saved", false)).toBe("✓ Saved on this phone")
    expect(saveButtonLabel("synced", true)).toBe("✓ Saved and synced")
  })
})

describe("Field Mode daily log to-dos and client contact", () => {
  const setup = {
    rules: {
      todoMode: "ask" as const,
      todoTypes: ["staff_task" as const, "supplier_task" as const],
      workedMovesToInProgress: true,
      carryBlocked: true,
      todoCostCodes: true,
      tickAddsLine: true,
      crewPicksCostCode: true,
      clientContact: true,
      clientContactSuggest: true,
      minimumSummaryCharacters: 15,
    },
    openTodos: [
      { id: "t1", title: "Joists <east>", status: "open" as const, recordType: "staff_task", assigneeName: "Dan", companyName: null, costCode: "01 71 13", changedOn: "2026-10-12" },
      { id: "t2", title: "Framing inspection", status: "blocked" as const, recordType: "staff_task", assigneeName: null, companyName: null, costCode: null, changedOn: "2026-10-12" },
    ],
    clientContacts: [{ id: "c1", name: "Jordan Bishop", role: "Owner" }],
    assignees: [{ name: "Nu-Tech", kind: "supplier_task" as const }],
  }
  const withSetup = { ...form, followUps: setup }

  it("shows blocked to-dos, the checklist, line to-dos and a contact suggestion", () => {
    const draft = { ...emptyLogDraft("2026-10-14"), issues: "Short on subfloor", visitorLog: "Bishop stopped by" }
    const html = logFieldsHtml({ draft, form: withSetup, errors: new Map(), escape })
    expect(html).toContain("Blocked to-dos")
    expect(html).toContain('data-fu="blocked" data-fu-key="t2"')
    expect(html).toContain("Joists &lt;east>")
    expect(html).toContain('data-fu="line-toggle" data-fu-key="issues:Short on subfloor"')
    expect(html).toContain("Visitors mentions Jordan Bishop")
  })

  it("applies control changes to the draft", () => {
    const rules = setup.rules
    const key = () => "row-1"
    let draft = followUpAction(emptyFollowUpDraft(), rules, { control: "suggest-accept", key: "", value: "c1" }, key)
    expect(draft.contacts).toEqual([expect.objectContaining({ key: "row-1", contactId: "c1", interactionType: "site_visit" })])
    draft = followUpAction(draft, rules, { control: "contact-direction", key: "row-1", value: "inbound" }, key)
    draft = followUpAction(draft, rules, { control: "contact-todo", key: "row-1", value: "true" }, key)
    expect(draft.contacts[0]).toEqual(expect.objectContaining({ direction: "inbound", followUpTodo: true }))
    draft = followUpAction(draft, rules, { control: "line-toggle", key: "issues:Short", value: "" }, key)
    draft = followUpAction(draft, rules, { control: "line-type", key: "issues:Short", value: "supplier_task" }, key)
    draft = followUpAction(draft, rules, { control: "line-assignee", key: "issues:Short", value: "Nu-Tech" }, key)
    expect(draft.lineTodos["issues:Short"]).toEqual({ recordType: "supplier_task", assigneeName: "Nu-Tech", costCode: "" })
    // Changing the type clears an assignee of the old kind.
    draft = followUpAction(draft, rules, { control: "line-type", key: "issues:Short", value: "staff_task" }, key)
    expect(draft.lineTodos["issues:Short"]?.assigneeName).toBe("")
    draft = followUpAction(draft, rules, { control: "blocked", key: "t2", value: "still" }, key)
    expect(draft.blocked).toEqual({ t2: "still" })
    draft = followUpAction(draft, rules, { control: "blocked", key: "t2", value: "still" }, key)
    expect(draft.blocked).toEqual({})
  })

  it("keeps drafts saved before to-dos", () => {
    const old: Record<string, unknown> = { ...emptyLogDraft("2026-10-14") }
    delete old.followUps
    const parsed = logDraftSchema.parse(old)
    expect(parsed.followUps.worked).toEqual([])
  })
})
