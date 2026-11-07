import { z } from "zod/v4"

import type { SageChangeOrderPlan } from "@/lib/domain/sage-bridge/change-order-rules"
import { sageAmount, sageDescription } from "@/lib/domain/sage-bridge/change-order-rules"
import { envFlag } from "@/lib/shared/env"

/*
 * The request Compass hands the Sage writer for one prime change order
 * (ChangeOrderAddRq), and the result the writer reports back. Amounts are
 * decimal strings so the writer never rounds a float.
 */

const decimalAmount = z.string().regex(/^-?\d{1,9}\.\d{2}$/)
const sageRecordNumber = z.string().regex(/^\d{1,12}$/)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const sageChangeOrderWritePayloadSchema = z.strictObject({
  operationType: z.literal("add_prime_change_order"),
  compassProjectId: z.string().min(1),
  compassChangeOrderId: z.string().min(1),
  job: z.strictObject({
    sageJobNumber: sageRecordNumber,
    sageJobId: z.string().min(1).nullable(),
  }),
  changeOrder: z.strictObject({
    number: z.string().trim().min(1).max(20),
    date: isoDate,
    approvedDate: isoDate,
    description: z.string().trim().min(1).max(50),
    statusNumber: z.number().int().min(0).max(99),
    totalApprovedAmount: decimalAmount,
  }),
  lines: z
    .array(
      z.strictObject({
        description: z.string().trim().min(1).max(50),
        costCodeRecordNumber: sageRecordNumber,
        costTypeNumber: z.number().int().min(0).max(99),
        approvedAmount: decimalAmount,
      })
    )
    .min(1)
    .max(200),
})

export type SageChangeOrderWritePayload = z.infer<typeof sageChangeOrderWritePayloadSchema>

export const sageChangeOrderWriteResultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("succeeded"),
    id: z.uuid(),
    claimToken: z.uuid(),
    /** Sage's prmchg.recnum for the change order the writer added or found. */
    sageRecordId: sageRecordNumber,
    /** True when Sage already had it (same number and amount) and nothing was added. */
    alreadyInSage: z.boolean(),
  }),
  z.strictObject({
    outcome: z.literal("failed"),
    id: z.uuid(),
    claimToken: z.uuid(),
    error: z.string().min(1).max(4000),
  }),
])

/**
 * The writer payload for a plan staff confirmed with `number`, or null when
 * the plan still has a blocker or a line without a Sage record number.
 */
export function sageChangeOrderWritePayload(
  plan: SageChangeOrderPlan,
  input: {
    readonly projectId: string
    readonly number: string
    readonly sageJobNumber: string
    readonly sageJobId: string | null
  }
): SageChangeOrderWritePayload | null {
  if (plan.blockers.length > 0 || !plan.date) return null
  const lines: SageChangeOrderWritePayload["lines"][number][] = []
  for (const line of plan.lines) {
    if (!line.sageCostCodeRecord) return null
    lines.push({
      description: sageDescription(line.description),
      costCodeRecordNumber: line.sageCostCodeRecord.replace(/\.0+$/, ""),
      costTypeNumber: line.costTypeNumber,
      approvedAmount: sageAmount(line.amountCents),
    })
  }
  const parsed = sageChangeOrderWritePayloadSchema.safeParse({
    operationType: "add_prime_change_order",
    compassProjectId: input.projectId,
    compassChangeOrderId: plan.changeOrderId,
    job: { sageJobNumber: input.sageJobNumber.trim(), sageJobId: input.sageJobId },
    changeOrder: {
      number: input.number.trim(),
      date: plan.date,
      approvedDate: plan.date,
      description: plan.description,
      statusNumber: plan.statusNumber,
      totalApprovedAmount: sageAmount(plan.totalCents),
    },
    lines,
  })
  return parsed.success ? parsed.data : null
}

/** Compass's switch for the change order bridge routes (off until the owner turns it on). */
export function sageChangeOrderWritesEnabled(env: unknown): boolean {
  return envFlag(env, "SAGE_CHANGE_ORDER_WRITES_ENABLED")
}
