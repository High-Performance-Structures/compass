import { describe, expect, it } from "vitest"

import { reconcileSearchableComboboxValue } from "@/lib/searchable-combobox"

describe("reconcileSearchableComboboxValue", () => {
  const options = [
    { value: "project-1" },
    { value: "project-2" },
  ] as const

  it("keeps a selection that is still present in refreshed data", () => {
    expect(reconcileSearchableComboboxValue(options, "project-2")).toBe(
      "project-2"
    )
  })

  it("clears a selection removed from refreshed data", () => {
    expect(reconcileSearchableComboboxValue(options, "project-3")).toBe("")
  })

  it("preserves an intentionally empty selection", () => {
    expect(reconcileSearchableComboboxValue(options, "")).toBe("")
  })
})
