import { describe, expect, it } from "vitest"

import {
  formatTemplateChecklist,
  groupTemplateChecklistItems,
} from "@/lib/templates/template-checklist-hierarchy"

const parent = {
  id: "parent-content",
  sourceItemId: "task-qc",
  parentSourceItemId: null,
  title: "Drywall QC Inspection",
  description: null,
  sortOrder: 2,
}

const child = {
  id: "child-content",
  sourceItemId: "task-qc-1",
  parentSourceItemId: "task-qc",
  title: "Tape on all joints",
  description: "Confirm full coverage.",
  sortOrder: 1,
}

describe("template checklist hierarchy", () => {
  it("groups captured checklist items under their parent task", () => {
    expect(groupTemplateChecklistItems([child, parent])).toEqual([
      { task: parent, checklistItems: [child] },
    ])
  })

  it("formats checklist content inside the parent task", () => {
    expect(formatTemplateChecklist([child])).toBe(
      "Checklist:\n☐ Tape on all joints\n  Confirm full coverage."
    )
  })

  it("fails instead of flattening an orphan checklist item", () => {
    expect(() => groupTemplateChecklistItems([child])).toThrow(
      "Template checklist item references a missing parent task."
    )
  })
})
