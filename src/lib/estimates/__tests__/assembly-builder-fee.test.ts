import { describe, expect, it } from "vitest"
import { assemblyBuilderFeeAllocation } from "@/lib/estimates/assembly-builder-fee"
import { clientEstimateReportGroups, type ClientEstimateLine } from "@/lib/estimates/client-report"

function line(id: string, total: number, extra: Partial<ClientEstimateLine> = {}): ClientEstimateLine & { readonly assemblyId: string | null } {
  return { id, assemblyId: id, reportPhaseId: null, divisionCode: "03", divisionName: "Concrete", costCode: "03 30 00", costCodeName: "Concrete", description: id, specifications: null, quantity: 1, unit: "LS", unitCostCents: total, taxCode: null, taxName: null, taxRateBasisPoints: 0, taxCents: 0, lineTotalCents: total, ownerVisible: true, includeInBuilderFee: true, sortOrder: 0, costItems: [], ...extra }
}
function allocate(lines: readonly ReturnType<typeof line>[], fee: number): ReturnType<typeof assemblyBuilderFeeAllocation> {
  const assemblies = lines.map((item, index) => ({ id: item.id, name: item.id, description: null, sortOrder: index }))
  const groups = clientEstimateReportGroups({ mode: "assembly_summary", assemblies, lines, phaseDescriptions: {} })
  return assemblyBuilderFeeAllocation({ groups, lines, builderFeeCents: fee })
}

describe("assembly builder-fee allocation", () => {
  it("uses the tax-inclusive eligible subtotal and never charges excluded items", () => {
    const allocation = allocate([line("taxed", 11000, { taxCents: 1000 }), line("other", 5000), line("excluded", 40000, { includeInBuilderFee: false })], 3200)
    expect([...allocation.byGroup.values()]).toEqual([2200, 1000, 0])
    expect(allocation.unallocatedCents).toBe(0)
  })
  it("reconciles a saved imported fee and penny rounding across assemblies", () => {
    const allocation = allocate([line("a", 1), line("b", 1), line("c", 1)], 2)
    expect([...allocation.byGroup.values()]).toEqual([1, 0, 1])
    expect(allocation.unallocatedCents).toBe(0)
  })
  it("preserves signed credit adjustments and large currency precision", () => {
    expect([...allocate([line("cost", 300), line("credit", -100)], 21).byGroup.values()]).toEqual([32, -11])
    expect([...allocate([line("a", 10000000001), line("b", 10000000000)], 10000000001).byGroup.values()]).toEqual([5000000001, 5000000000])
  })
  it("leaves internal-only fees in the project recap without disclosing hidden work", () => {
    const allocation = allocate([line("shown", 100), line("hidden", 300, { ownerVisible: false })], 80)
    expect([...allocation.byGroup.entries()]).toEqual([["shown", 20]])
    expect(allocation.unallocatedCents).toBe(60)
  })
  it("keeps Other work and orphaned assignments in the allocation", () => {
    const lines = [line("a", 100), { ...line("b", 100), assemblyId: "missing" }]
    const groups = clientEstimateReportGroups({ mode: "assembly_items", assemblies: [{ id: "a", name: "Phase A", description: null, sortOrder: 0 }], lines, phaseDescriptions: {} })
    expect([...assemblyBuilderFeeAllocation({ groups, lines, builderFeeCents: 30 }).byGroup.entries()]).toEqual([["a", 15], ["unassigned", 15]])
  })
  it("handles zero fees and a zero eligible base without inventing charges", () => {
    expect([...allocate([line("a", 100)], 0).byGroup.values()]).toEqual([0])
    const allocation = allocate([line("excluded", 100, { includeInBuilderFee: false })], 5)
    expect([...allocation.byGroup.values()]).toEqual([0])
    expect(allocation.unallocatedCents).toBe(5)
  })
})
