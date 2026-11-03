import { describe, expect, it } from "vitest"

import type { ProjectEstimateLineItem } from "@/app/actions/project-estimates"
import {
  EMPTY_LINE,
  draftNumber,
  estimateDivisions,
  formNumber,
  formText,
  groupEstimateLines,
  lineDraft,
  lineDraftCalculationInput,
  lineEditorIsInline,
  localDateInput,
  percent,
  selectedTemplateBody,
  statusLabel,
  taxEntityComboboxOptions,
} from "@/components/projects/estimate-workspace/estimate-workspace-helpers"
import { calculateEstimateLine } from "@/lib/domain/estimates/rules"

function line(overrides: Partial<ProjectEstimateLineItem> = {}): ProjectEstimateLineItem {
  return {
    assemblyId: null,
    id: "line-1",
    reportPhaseId: null,
    divisionCode: "03",
    divisionName: "Concrete",
    costCode: "03-100",
    costCodeName: "Footings",
    description: "Footings",
    specifications: null,
    quantity: 2,
    unit: "CY",
    unitCostCents: 12_550,
    directCostCents: 25_100,
    markupRateBasisPoints: 1_000,
    markupCents: 2_510,
    taxable: false,
    taxEntityId: null,
    taxCode: null,
    taxName: null,
    taxRateBasisPoints: 0,
    taxCents: 0,
    lineTotalCents: 27_610,
    ownerVisible: true,
    includeInBuilderFee: true,
    sortOrder: 1,
    costItems: [],
    ...overrides,
  }
}

describe("estimate workspace form readers", () => {
  it("reads trimmed text and comma numbers", () => {
    const form = new FormData()
    form.set("title", "  Kitchen  ")
    form.set("blank", "   ")
    form.set("amount", "1,250.5")
    form.set("bad", "abc")
    expect(formText(form, "title")).toBe("Kitchen")
    expect(formText(form, "blank")).toBeNull()
    expect(formText(form, "missing")).toBeNull()
    expect(formNumber(form, "amount")).toBe(1250.5)
    expect(formNumber(form, "bad")).toBeNull()
    // A missing field reads as "" and so as 0, as before the split.
    expect(formNumber(form, "missing")).toBe(0)
  })

  it("reads draft numbers, falling back to 0", () => {
    expect(draftNumber("1,000")).toBe(1000)
    expect(draftNumber("x")).toBe(0)
  })
})

describe("estimate workspace labels", () => {
  it("formats basis points and status labels", () => {
    expect(percent(825)).toBe("8.25%")
    expect(percent(12_345)).toBe("123.45%")
    expect(statusLabel("signature_pending")).toBe("signature pending")
  })

  it("returns today's local date", () => {
    expect(localDateInput(new Date(2026, 9, 31, 23, 30))).toBe("2026-10-31")
  })

  it("finds a template body", () => {
    const options = [{ value: "t1", label: "T1", departmentCode: null, templateType: "terms" as const, body: "Body", sourceDocumentId: null, sourceUrl: null }]
    expect(selectedTemplateBody(options, "t1")).toBe("Body")
    expect(selectedTemplateBody(options, "nope")).toBe("")
  })

  it("builds tax entity options", () => {
    expect(taxEntityComboboxOptions([{ value: "tx", label: "Teller County", code: "TC", rateBasisPoints: 290 }])).toEqual([
      {
        value: "tx",
        label: "Teller County",
        selectedLabel: "Teller County · 2.90%",
        description: "2.90% · Sage tax entity",
        keywords: "TC 2.9",
      },
    ])
  })
})

describe("line drafts", () => {
  it("turns a saved line into an editable draft", () => {
    expect(lineDraft(line({ specifications: "Rebar", taxEntityId: "tx" }))).toMatchObject({
      id: "line-1",
      quantity: "2",
      unitCost: "125.5",
      markupPercent: "10",
      specifications: "Rebar",
      taxEntityId: "tx",
      pricingSource: "",
    })
  })

  it("previews with the shared estimate line rules", () => {
    const draft = { ...EMPTY_LINE, quantity: "2", unitCost: "125.50", markupPercent: "10", taxable: true }
    const input = lineDraftCalculationInput(draft, 290)
    expect(input).toEqual({
      quantity: 2,
      unitCostCents: 12_550,
      markupRateBasisPoints: 1_000,
      taxable: true,
      taxRateBasisPoints: 290,
    })
    expect(calculateEstimateLine(input).directCostCents).toBe(25_100)
  })

  it("never previews negative costs or markup", () => {
    const input = lineDraftCalculationInput({ ...EMPTY_LINE, unitCost: "-5", markupPercent: "-2" }, 0)
    expect(input.unitCostCents).toBe(0)
    expect(input.markupRateBasisPoints).toBe(0)
  })
})

describe("grouping", () => {
  const lines = [
    line({ id: "b", divisionCode: "09", divisionName: "Finishes", sortOrder: 1 }),
    line({ id: "a2", sortOrder: 2 }),
    line({ id: "a1", sortOrder: 1, assemblyId: "asm" }),
  ]

  it("lists distinct divisions sorted by code", () => {
    const option = { label: "", description: "", divisionName: "", sageMapped: true }
    expect(estimateDivisions([
      { ...option, value: "09-1", divisionCode: "09", divisionLabel: "09 Finishes" },
      { ...option, value: "03-1", divisionCode: "03", divisionLabel: "03 Concrete" },
      { ...option, value: "03-2", divisionCode: "03", divisionLabel: "03 Concrete" },
    ])).toEqual([["03", "03 Concrete"], ["09", "09 Finishes"]])
  })

  it("groups by division in line order", () => {
    const groups = groupEstimateLines("division", [], lines)
    expect(groups.map((group) => [group.key, group.name, group.items.map((item) => item.id)])).toEqual([
      ["03", "03 · Concrete", ["a1", "a2"]],
      ["09", "09 · Finishes", ["b"]],
    ])
  })

  it("groups by assembly with other work last", () => {
    const groups = groupEstimateLines("assembly", [{ id: "asm", name: "Foundation", description: null, sortOrder: 1, clientDetail: false }], lines)
    expect(groups.map((group) => [group.key, group.assemblyId, group.items.map((item) => item.id)])).toEqual([
      ["asm", "asm", ["a1"]],
      ["unassigned", null, ["b", "a2"]],
    ])
  })

  it("places the line editor inline only when its anchor is shown", () => {
    const groups = groupEstimateLines("division", [], lines)
    const none = { lineId: null, insertAfterLineId: null, addToGroupKey: null }
    expect(lineEditorIsInline(groups, none)).toBe(false)
    expect(lineEditorIsInline(groups, { ...none, lineId: "a1" })).toBe(true)
    expect(lineEditorIsInline(groups, { ...none, lineId: "gone" })).toBe(false)
    expect(lineEditorIsInline(groups, { ...none, insertAfterLineId: "b" })).toBe(true)
    expect(lineEditorIsInline(groups, { ...none, addToGroupKey: "09" })).toBe(true)
    expect(lineEditorIsInline(groups, { ...none, addToGroupKey: "asm" })).toBe(false)
  })
})
