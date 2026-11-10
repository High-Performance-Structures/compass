import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { SearchableCombobox } from "@/components/searchable-combobox"
import { creatableComboboxText, reconcileSearchableComboboxValue } from "@/lib/searchable-combobox"

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

describe("creatableComboboxText (the “Add …” item)", () => {
  const options = [
    { value: "Kitchen", label: "Kitchen" },
    { value: "Primary Bath", label: "Primary Bath" },
  ]

  it("offers typed text that matches no option, trimmed", () => {
    expect(creatableComboboxText(options, "  Mudroom ")).toBe("Mudroom")
  })

  it("offers nothing for blank text", () => {
    expect(creatableComboboxText(options, "   ")).toBeNull()
  })

  it("offers nothing when the text is an existing option in any case", () => {
    expect(creatableComboboxText(options, "kitchen")).toBeNull()
    expect(creatableComboboxText(options, "PRIMARY BATH ")).toBeNull()
  })

  it("offers a longer name that only starts like an option", () => {
    expect(creatableComboboxText(options, "Kitchen 2")).toBe("Kitchen 2")
  })

  it("offers text when there are no options yet (a new company)", () => {
    expect(creatableComboboxText([], "Kitchen")).toBe("Kitchen")
  })
})

describe("SearchableCombobox creatable", () => {
  const props = {
    options: [{ value: "Kitchen", label: "Kitchen" }],
    onValueChange: (): void => undefined,
    ariaLabel: "Room",
    placeholder: "Choose or type a room",
  }

  it("keeps and shows a typed value that is not an option", () => {
    const html = renderToStaticMarkup(
      createElement(SearchableCombobox, { ...props, value: "Mudroom", creatable: true })
    )
    expect(html).toContain("Mudroom")
    expect(html).not.toContain("Choose or type a room")
  })

  it("stays usable with no options so a first value can be typed", () => {
    const html = renderToStaticMarkup(
      createElement(SearchableCombobox, { ...props, options: [], value: "", creatable: true })
    )
    expect(html).not.toMatch(/ disabled=""/)
    // Control: the same empty list without creatable is disabled.
    const plain = renderToStaticMarkup(createElement(SearchableCombobox, { ...props, options: [], value: "" }))
    expect(plain).toMatch(/ disabled=""/)
  })

  it("a plain combobox still shows only listed values", () => {
    const html = renderToStaticMarkup(createElement(SearchableCombobox, { ...props, value: "Mudroom" }))
    expect(html).toContain("Choose or type a room")
    expect(html).not.toContain("Mudroom")
  })
})
