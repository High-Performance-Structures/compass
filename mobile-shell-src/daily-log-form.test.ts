import { describe, expect, it } from "vitest"

import {
  addWorkLine,
  emptyLogDraft,
  errorControlId,
  filledWorkLines,
  localDateInputValue,
  logFieldsHtml,
  logRequirements,
  removeWorkLine,
  saveButtonLabel,
  updateLogDraft,
} from "./daily-log-form"

const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
const form = {
  costCodes: [{ code: "01 71 13", name: "Mobilization", label: "01 71 13 Mobilization", group: "" }],
  requirements: { requireCostCodeTime: true, requiredFields: ["crewPresent" as const] },
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
