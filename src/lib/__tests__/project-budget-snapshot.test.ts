import { describe, expect, it } from "vitest"

import {
  budgetApplicationStatus,
  budgetPaymentBreakdown,
  budgetReconciliation,
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
  const paidFinal: BudgetApplicationView = {
    ...application("final"),
    sourceSystem: "google_drive_g702_g703",
    status: "paid_in_full",
    contractSumToDate: 1_000,
    totalCompletedStoredToDate: 1_000.01,
    totalEarnedLessRetainage: 1_000.01,
    previousCertificates: 1_000.01,
    currentPaymentDue: 0,
    balanceToFinish: 0,
    retainageHeld: 0,
  }
  const finalTotals = {
    adjustedEstimate: 1_000.02,
    priorCosts: 700,
    currentCosts: 300.01,
    totalCosts: 1_000.01,
    balanceToFinish: 0,
  }

  it("requires explicit client-closeout acceptance before displaying paid in full", () => {
    expect(budgetApplicationStatus({ ...paidFinal, status: "current", syncStatus: "pending_sage_reconciliation" })).toBe("current")
    expect(budgetApplicationStatus({ ...paidFinal, status: "current", syncStatus: "client_final_closeout_accepted" })).toBe("paid_in_full")
    expect(budgetApplicationStatus({ ...paidFinal, status: "current", syncStatus: "client_final_closeout_accepted", currentPaymentDue: 1 })).toBe("current")
  })

  it("preserves the original G703 draw period after the final payment settles", () => {
    const result = budgetReconciliation(paidFinal, finalTotals)
    expect(result).toMatchObject({ kind: "paid_closeout", reconciliationRequired: false, priorDifference: -300.01, currentDifference: 300.01 })
    expect(finalTotals.currentCosts).toBe(300.01)
  })

  it("keeps ordinary draws subject to the existing reconciliation checks", () => {
    expect(budgetReconciliation({ ...paidFinal, status: "current" }, finalTotals).reconciliationRequired).toBe(true)
  })

  it.each([
    { ...finalTotals, totalCosts: 1_000.02 },
    { ...finalTotals, balanceToFinish: 1 },
    { ...finalTotals, adjustedEstimate: 1_000.03 },
  ])("does not hide a material or unreconciled closeout difference", (totals) => {
    expect(budgetReconciliation(paidFinal, totals)).toMatchObject({ kind: "periodic", reconciliationRequired: true })
  })

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
