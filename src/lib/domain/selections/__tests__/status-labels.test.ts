import { describe, expect, it } from "vitest"

import {
  DEFAULT_SELECTION_STATUS_LABELS,
  resolveSelectionStatusLabels,
  selectionProgressLabel,
  selectionStatusLabel,
  selectionStatusNameProblems,
  selectionStatusOptions,
} from "@/lib/domain/selections/status-labels"
import { PROJECT_SELECTION_STATUSES } from "@/lib/domain/selections/statuses"
import { parseFeatureSettings } from "@/lib/feature-settings/registry"
import { selectionStatusNamesSettingsSchema } from "@/lib/feature-settings/selection-status-names-settings"
import { selectionListFilters } from "@/lib/selections/sheet"

describe("selection status labels", () => {
  it("uses the default label when the company renamed nothing", () => {
    expect(selectionStatusLabel("owner_review")).toBe("With owner")
    expect(resolveSelectionStatusLabels(null)).toEqual(DEFAULT_SELECTION_STATUS_LABELS)
    expect(resolveSelectionStatusLabels({})).toEqual(DEFAULT_SELECTION_STATUS_LABELS)
  })

  it("uses the company's name and falls back for the rest, blank or missing", () => {
    const labels = resolveSelectionStatusLabels({ owner_review: "  Client review ", rfq_sent: "   " })
    expect(selectionStatusLabel("owner_review", labels)).toBe("Client review")
    expect(selectionStatusLabel("rfq_sent", labels)).toBe("RFQ sent")
    expect(selectionStatusLabel("needed", labels)).toBe("Needed")
  })

  it("builds picker options in workflow order with the company's names, keys unchanged", () => {
    const options = selectionStatusOptions(resolveSelectionStatusLabels({ owner_review: "Client review" }))
    expect(options.map((option) => option.value)).toEqual([...PROJECT_SELECTION_STATUSES])
    expect(options.find((option) => option.value === "owner_review")?.label).toBe("Client review")
  })

  it("labels the owner portal's progress, including the awaiting-approval state", () => {
    const labels = resolveSelectionStatusLabels({ ordered: "Purchased" })
    expect(selectionProgressLabel("ordered", labels)).toBe("Purchased")
    expect(selectionProgressLabel("awaiting_owner_approval", labels)).toBe("Awaiting owner signature")
    expect(selectionProgressLabel("something_else", labels)).toBe("Something else")
  })

  it("names the sheet's filter buttons after the statuses; Open and All stay", () => {
    const filters = selectionListFilters(resolveSelectionStatusLabels({ owner_review: "Client review", installed: "Done" }))
    expect(filters.map((filter) => filter.value)).toEqual(["open", "needed", "with_owner", "approved", "ordered", "installed", "all"])
    expect(filters.map((filter) => filter.label)).toEqual(["Open", "Needed", "Client review", "Approved (signed)", "Ordered", "Done", "All"])
    expect(selectionListFilters().find((filter) => filter.value === "with_owner")?.label).toBe("With owner")
  })
})

describe("status name validation", () => {
  it("accepts renames, including a case-only change of the status's own default", () => {
    expect(selectionStatusNameProblems({ owner_review: "Client review", needed: "NEEDED" })).toEqual({})
    expect(selectionStatusNamesSettingsSchema.safeParse({ names: { owner_review: "Client review" } }).success).toBe(true)
  })

  it("blocks blank names", () => {
    expect(selectionStatusNameProblems({ approved: "  " }).approved).toMatch(/Enter a name/)
    expect(selectionStatusNamesSettingsSchema.safeParse({ names: { approved: "" } }).success).toBe(false)
  })

  it("blocks duplicates without case, against renamed and default names", () => {
    const againstDefault = selectionStatusNameProblems({ owner_review: "approved (signed)" })
    expect(againstDefault.owner_review).toMatch(/already the name of another status/)
    expect(againstDefault.approved).toMatch(/already the name of another status/)

    const twoRenamed = selectionStatusNameProblems({ ordered: "Done", installed: "done" })
    expect(Object.keys(twoRenamed).sort()).toEqual(["installed", "ordered"])

    const result = selectionStatusNamesSettingsSchema.safeParse({ names: { ordered: "Done", installed: "DONE" } })
    expect(result.success).toBe(false)
  })

  it("rejects unknown statuses and overly long names", () => {
    expect(selectionStatusNamesSettingsSchema.safeParse({ names: { shipped: "Shipped" } }).success).toBe(false)
    expect(selectionStatusNamesSettingsSchema.safeParse({ names: { needed: "x".repeat(41) } }).success).toBe(false)
  })

  it("falls back to every default when the stored names are bad", () => {
    expect(parseFeatureSettings("selection-status-names", null)).toEqual({ names: {} })
    expect(parseFeatureSettings("selection-status-names", JSON.stringify({ names: { ordered: "A", installed: "a" } }))).toEqual({ names: {} })
    expect(parseFeatureSettings("selection-status-names", JSON.stringify({ names: { ordered: "Purchased" } }))).toEqual({ names: { ordered: "Purchased" } })
  })
})
