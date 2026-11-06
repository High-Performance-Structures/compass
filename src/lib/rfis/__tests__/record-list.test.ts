import { describe, expect, it } from "vitest"

import {
  rfiAssigneeSortValue,
  rfiDateSortValue,
  rfiMatchesSearch,
  rfiRecordHref,
  rfiStatusLabel,
  rfiStatusSortValue,
  rfiStatusFilterOptions,
  selectedRfiIdFromLocation,
  type RfiListRow,
} from "@/lib/rfis/record-list"
import { compareSortValues } from "@/components/ui/sortable-header"
import { defaultRecordStatusList, resolveRecordStatuses } from "@/lib/domain/record-statuses/rules"

const RFI_STATUSES = defaultRecordStatusList("rfi")

const row: RfiListRow = {
  id: "rfi-1",
  rfiNumber: "O-58-RFI-002",
  subject: "Footing depth",
  question: "Confirm the frost depth at grid B",
  status: "info_needed",
  priority: "normal",
  assignedToName: null,
  companyName: "Acme Concrete",
  requesterName: "Sam Super",
  submittedAt: "2026-11-02T15:30:00.000Z",
  dueDate: "2026-11-10",
  answeredAt: null,
}

describe("RFI record list sort values", () => {
  it("sorts dates by when they are, not by display text", () => {
    // "Dec 1" sorts before "Nov 30" as text; the typed value must not.
    const nov30 = rfiDateSortValue("2026-11-30")
    const dec1 = rfiDateSortValue("2026-12-01")
    expect(nov30).toBeTypeOf("number")
    expect(compareSortValues(nov30, dec1)).toBeLessThan(0)
    // A date-only due date and an ISO timestamp share one time line.
    expect(compareSortValues(rfiDateSortValue("2026-11-02T08:00:00.000Z"), rfiDateSortValue("2026-11-10"))).toBeLessThan(0)
  })

  it("leaves blank and unreadable dates blank so they sort last", () => {
    expect(rfiDateSortValue(null)).toBeUndefined()
    expect(rfiDateSortValue("")).toBeUndefined()
    expect(rfiDateSortValue("not a date")).toBeUndefined()
    expect(compareSortValues(rfiDateSortValue(null), rfiDateSortValue("2026-11-10"))).toBeGreaterThan(0)
  })

  it("sorts status in workflow order, legacy names included", () => {
    const order = ["void", "complete", "info_needed", "answered", "open"]
      .map((status) => ({ status, value: rfiStatusSortValue(status, RFI_STATUSES) }))
      .sort((a, b) => a.value - b.value)
      .map((item) => item.status)
    expect(order).toEqual(["open", "answered", "info_needed", "complete", "void"])
    expect(rfiStatusLabel("additional_information_needed", RFI_STATUSES)).toBe("Info needed")
  })

  it("sorts who answers by person, else the company asked", () => {
    expect(rfiAssigneeSortValue(row)).toBe("Acme Concrete")
    expect(rfiAssigneeSortValue({ ...row, assignedToName: "Pat Engineer" })).toBe("Pat Engineer")
    expect(rfiAssigneeSortValue({ ...row, companyName: "  " })).toBeUndefined()
  })

  it("orders RFI numbers numerically", () => {
    expect(compareSortValues("RFI-9", "RFI-10")).toBeLessThan(0)
  })
})

describe("RFI record list search", () => {
  it("matches number, subject, question, people and status", () => {
    for (const query of ["rfi-002", "FOOTING", "frost", "acme", "sam", "info needed"]) {
      expect(rfiMatchesSearch(row, query, RFI_STATUSES)).toBe(true)
    }
    expect(rfiMatchesSearch(row, "  ", RFI_STATUSES)).toBe(true)
    expect(rfiMatchesSearch(row, "roofing", RFI_STATUSES)).toBe(false)
  })
})

describe("RFI deep links", () => {
  it("links a row to its record, keeping the status filter", () => {
    expect(rfiRecordHref("proj 1", "rfi/1", "open")).toBe(
      "/dashboard/projects/proj%201/rfis?status=open&item=rfi%2F1#rfi-rfi%2F1",
    )
  })

  it("selects the vendor RFI from ?item= first, then the #rfi- hash", () => {
    const ids = ["a", "b", "c/d"]
    expect(selectedRfiIdFromLocation("?item=b", "#rfi-a", ids)).toBe("b")
    expect(selectedRfiIdFromLocation("", "#rfi-a", ids)).toBe("a")
    expect(selectedRfiIdFromLocation("", "#rfi-c%2Fd", ids)).toBe("c/d")
  })

  it("opens nothing for unknown ids, other hashes or bad encoding", () => {
    const ids = ["a"]
    expect(selectedRfiIdFromLocation("?item=zzz", "", ids)).toBeNull()
    expect(selectedRfiIdFromLocation("", "#rfq-a", ids)).toBeNull()
    expect(selectedRfiIdFromLocation("", "#rfi-%E0%A4%A", ids)).toBeNull()
    expect(selectedRfiIdFromLocation("", "", ids)).toBeNull()
  })
})

describe("RFI status filter buttons", () => {
  it("counts each status, Open and All, and pins Open and All", () => {
    const options = rfiStatusFilterOptions(["open", "answered", "closed", "void", "in_progress"], RFI_STATUSES)
    const byValue = Object.fromEntries(options.map((option) => [option.value, option]))
    expect(options.map((option) => option.value)).toEqual(["open", "new", "in_progress", "info_needed", "complete", "void", "all"])
    expect(byValue.open?.count).toBe(3)
    expect(byValue.in_progress?.count).toBe(2)
    expect(byValue.info_needed?.count).toBe(0)
    expect(byValue.all?.count).toBe(5)
    expect(options.filter((option) => option.pinned).map((option) => option.value)).toEqual(["open", "all"])
  })
})

describe("RFI status filter buttons from company statuses", () => {
  it("follow the company's order, labels and hidden statuses", () => {
    const company = resolveRecordStatuses("rfi", [
      { statusKey: "info_needed", label: "Waiting on owner", color: "orange", statusGroup: "open", sortOrder: 0, showAsButton: true, hidden: false, builtIn: true },
      { statusKey: "void", label: "Void", color: "red", statusGroup: "void", sortOrder: 1, showAsButton: true, hidden: true, builtIn: true },
      { statusKey: "with_engineer", label: "With engineer", color: "blue", statusGroup: "open", sortOrder: 2, showAsButton: true, hidden: false, builtIn: false },
    ])
    const options = rfiStatusFilterOptions(["info_needed", "with_engineer", "void"], company)
    // Built-ins with no stored row follow the default status before them; Void is hidden.
    expect(options.map((option) => option.value)).toEqual([
      "open", "new", "in_progress", "info_needed", "complete", "with_engineer", "all",
    ])
    expect(options.find((option) => option.value === "info_needed")?.label).toBe("Waiting on owner")
    expect(options[0]?.count).toBe(2)
    expect(rfiStatusLabel("with_engineer", company)).toBe("With engineer")
  })
})
