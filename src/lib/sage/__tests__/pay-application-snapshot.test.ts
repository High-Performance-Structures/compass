import { describe, expect, it } from "vitest"

import {
  hashSagePayApplicationSnapshot,
  normalizeSagePayApplicationSnapshot,
  reconcileSagePayApplicationSnapshot,
  sagePayApplicationSnapshotSchema,
  type SagePayApplicationSnapshot,
} from "@/lib/sage/pay-application-snapshot"

function snapshot(): SagePayApplicationSnapshot {
  return {
    runId: "550e8400-e29b-41d4-a716-446655440000",
    claimToken: "8cae3eb4-757d-419d-9f88-21719ac08e1d",
    capturedAt: "2026-07-30T20:00:00.000Z",
    header: {
      sourceApplicationId: "sage-pay-app-3",
      sourceRevision: "3",
      sageJobId: "170",
      sageJobNumber: "O-170-2684",
      applicationNumber: "3",
      periodTo: "2026-07-30",
      status: "posted",
      originalContractSum: 1000,
      netChanges: 100,
      contractSumToDate: 1100,
      totalCompletedStoredToDate: 600,
      retainageHeld: 60,
      totalEarnedLessRetainage: 540,
      previousCertificates: 400,
      currentPaymentDue: 140,
      balanceToFinish: 560,
    },
    lines: [
      {
        sourceLineId: "line-2",
        costCode: "02 00 00",
        csiDivision: "02",
        csiDivisionName: "Existing Conditions",
        description: "Selective demolition",
        originalEstimate: 400,
        priorChanges: 0,
        currentChanges: 100,
        totalChanges: 100,
        adjustedEstimate: 500,
        previousWorkCompleted: 150,
        currentWorkCompleted: 50,
        storedMaterials: 0,
        totalCompletedStoredToDate: 200,
        retainageHeld: 20,
        balanceToFinish: 300,
        sortOrder: 2,
      },
      {
        sourceLineId: "line-1",
        costCode: "01 00 00",
        csiDivision: "01",
        csiDivisionName: "General Requirements",
        description: "General conditions",
        originalEstimate: 600,
        priorChanges: 0,
        currentChanges: 0,
        totalChanges: 0,
        adjustedEstimate: 600,
        previousWorkCompleted: 300,
        currentWorkCompleted: 50,
        storedMaterials: 50,
        totalCompletedStoredToDate: 400,
        retainageHeld: 40,
        balanceToFinish: 200,
        sortOrder: 1,
      },
    ],
  }
}

describe("Sage pay application snapshots", () => {
  it("validates and reconciles a balanced snapshot", () => {
    const parsed = sagePayApplicationSnapshotSchema.parse(snapshot())
    const result = reconcileSagePayApplicationSnapshot(parsed)

    expect(result.passed).toBe(true)
    expect(result.rowCount).toBe(2)
    expect(result.duplicateSourceLineIds).toEqual([])
  })

  it("fails closed when header and line formulas do not reconcile", () => {
    const input = snapshot()
    const changed: SagePayApplicationSnapshot = {
      ...input,
      header: {
        ...input.header,
        currentPaymentDue: 200,
      },
    }

    const result = reconcileSagePayApplicationSnapshot(changed)

    expect(result.passed).toBe(false)
    expect(
      result.checks.find(
        (item) => item.key === "header.current_payment_due"
      )?.passed
    ).toBe(false)
  })

  it("rejects duplicate source line identifiers", () => {
    const input = snapshot()
    const duplicate: SagePayApplicationSnapshot = {
      ...input,
      lines: [
        input.lines[0],
        {
          ...input.lines[1],
          sourceLineId: input.lines[0].sourceLineId,
        },
      ],
    }

    const result = reconcileSagePayApplicationSnapshot(duplicate)

    expect(result.passed).toBe(false)
    expect(result.duplicateSourceLineIds).toEqual(["line-2"])
  })

  it("normalizes line order before hashing exact replays", async () => {
    const input = snapshot()
    const reversed: SagePayApplicationSnapshot = {
      ...input,
      lines: [...input.lines].reverse(),
    }

    expect(normalizeSagePayApplicationSnapshot(input).lines[0]?.sourceLineId)
      .toBe("line-1")
    await expect(hashSagePayApplicationSnapshot(input)).resolves.toBe(
      await hashSagePayApplicationSnapshot(reversed)
    )
  })

  it("does not include run or capture transport metadata in the source hash", async () => {
    const input = snapshot()
    const laterCapture: SagePayApplicationSnapshot = {
      ...input,
      runId: "19b22780-0fa8-4f5f-8799-2c59c34354b8",
      claimToken: "6c08be20-900e-4f35-b0cb-3f445da30290",
      capturedAt: "2026-07-31T20:00:00.000Z",
    }

    await expect(hashSagePayApplicationSnapshot(input)).resolves.toBe(
      await hashSagePayApplicationSnapshot(laterCapture)
    )
  })

  it("reconciles G702 balance including retained funds", () => {
    const result = reconcileSagePayApplicationSnapshot(snapshot())

    expect(
      result.checks.find(
        (item) => item.key === "header.balance_to_finish"
      )
    ).toMatchObject({
      expected: 560,
      actual: 560,
      passed: true,
    })
    expect(
      result.checks.find(
        (item) => item.key === "lines.balance_plus_retainage"
      )
    ).toMatchObject({
      expected: 560,
      actual: 560,
      passed: true,
    })
  })
})
