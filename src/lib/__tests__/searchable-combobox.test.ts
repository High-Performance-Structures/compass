import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { SearchableCombobox } from "@/components/searchable-combobox"
import { creatableComboboxText, listedComboboxOptions, reconcileSearchableComboboxValue } from "@/lib/searchable-combobox"

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

describe("SearchableCombobox unlisted options", () => {
  // An old Sage name and its numbered twin: one Sage record, offered once.
  const options = [
    { value: "03 11 20.60", label: "03 11 20.60 Fox-S800" },
    { value: "Fox-S800", label: "Fox-S800", unlisted: true },
    { value: "ICF Shipping", label: "ICF Shipping" },
  ]

  it("offers only listed options", () => {
    expect(listedComboboxOptions(options).map((option) => option.value)).toEqual(["03 11 20.60", "ICF Shipping"])
  })

  it("still shows a saved unlisted value instead of clearing it", () => {
    expect(reconcileSearchableComboboxValue(options, "Fox-S800")).toBe("Fox-S800")
    const html = renderToStaticMarkup(
      createElement(SearchableCombobox, { options, value: "Fox-S800", onValueChange: (): void => undefined, ariaLabel: "Cost code", placeholder: "Choose a cost code" })
    )
    expect(html).toContain("Fox-S800")
    expect(html).not.toContain("Choose a cost code")
  })
})
