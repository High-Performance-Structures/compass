import { describe, expect, it } from "vitest"

import {
  budgetPaymentBreakdown,
  sanitizeBudgetApplicationForOwner,
  sanitizeBudgetLineForOwner,
  scopeBudgetLinesToApplication,
  selectBudgetApplication,
  type BudgetApplicationView,
  type BudgetLineSnapshotRow,
} from "@/lib/project-budget-snapshot"

function application(
  id: string,
  ownerVisible = true
): BudgetApplicationView {
  return {
    id,
    sourceSystem: "sage",
    applicationNumber: id,
    periodTo: "2026-07-30",
    status: "current",
    originalContractSum: 1_000,
    netChanges: 0,
    contractSumToDate: 1_000,
    totalCompletedStoredToDate: 400,
    retainageHeld: 40,
    totalEarnedLessRetainage: 360,
    previousCertificates: 200,
    currentPaymentDue: 160,
    balanceToFinish: 600,
    ownerVisible,
    documentAvailable: true,
    sourceUrl: "https://internal.example/source",
    lastSyncedAt: "2026-07-30T12:00:00.000Z",
  }
}

function line(
  id: string,
  applicationId: string | null
): BudgetLineSnapshotRow {
  return {
    applicationId,
    id,
    sourceSystem: "sage",
    costCode: "01 00 00",
    csiDivision: "01",
    csiDivisionName: "General Requirements",
    description: id,
    notes: "Internal source note",
    originalEstimate: 1_000,
    priorChanges: 0,
    currentChanges: 0,
    totalChanges: 0,
    adjustedEstimate: 1_000,
    priorCosts: 200,
    currentCosts: 100,
    totalCosts: 300,
    percentComplete: 30,
    balanceToFinish: 700,
    retainageHeld: 30,
    vendorName: "Internal vendor",
    ownerLabel: "General Requirements",
    ownerVisible: true,
    internalNotes: "Internal reconciliation note",
  }
}

describe("project budget snapshot boundary", () => {
  it("never mixes lines from two pay applications", () => {
    const applications = [application("pay-app-2"), application("pay-app-1")]
    const selected = selectBudgetApplication(applications, "pay-app-1")
    const lines = [
      line("line-current", "pay-app-2"),
      line("line-selected", "pay-app-1"),
      line("line-unassigned", null),
    ]

    expect(selected?.id).toBe("pay-app-1")
    expect(
      scopeBudgetLinesToApplication(lines, selected?.id ?? null).map(
        (item) => item.id
      )
    ).toEqual(["line-selected"])
  })

  it("does not fall back when a requested application is unavailable", () => {
    const selected = selectBudgetApplication(
      [application("published")],
      "internal-draft"
    )

    expect(selected).toBeNull()
    expect(scopeBudgetLinesToApplication([line("line", "published")], null)).toEqual(
      []
    )
  })

  it("removes internal source and reconciliation detail from owner data", () => {
    const safeApplication = sanitizeBudgetApplicationForOwner(
      application("pay-app-1")
    )
    const safeLine = sanitizeBudgetLineForOwner(line("line-1", "pay-app-1"))

    expect(safeApplication.sourceUrl).toBeNull()
    expect(safeApplication.lastSyncedAt).toBeNull()
    expect(safeLine.notes).toBeNull()
    expect(safeLine.vendorName).toBeNull()
    expect(safeLine.internalNotes).toBeNull()
  })

  it("includes a deposit already applied to the first payment application", () => {
    const firstApplication: BudgetApplicationView = {
      ...application("pay-app-1"),
      totalCompletedStoredToDate: 68_782.88,
      totalEarnedLessRetainage: 68_782.88,
      previousCertificates: 0,
      currentPaymentDue: 18_460.77,
    }

    expect(budgetPaymentBreakdown(firstApplication)).toEqual({
      applicationTotal: 68_782.88,
      currentPaymentDue: 18_460.77,
      depositApplied: 50_322.11,
    })
  })

  it("does not invent a deposit when the application has no positive balance", () => {
    const laterApplication: BudgetApplicationView = {
      ...application("pay-app-2"),
      totalEarnedLessRetainage: 199_584.37,
      previousCertificates: 68_782.88,
      currentPaymentDue: 133_149.11,
    }

    expect(budgetPaymentBreakdown(laterApplication)).toEqual({
      applicationTotal: 133_149.11,
      currentPaymentDue: 133_149.11,
      depositApplied: 0,
    })
  })
})
