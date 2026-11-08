import { z } from "zod/v4"

import { sageAmount } from "@/lib/domain/sage-bridge/change-order-rules"
import { sageEstimateWriterLines, sageProposalWriterLines, type SageEstimatePlan } from "@/lib/domain/sage-bridge/estimate-proposal-rules"
import { envFlag } from "@/lib/shared/env"

/*
 * The request Compass hands the Sage writer for an accepted estimate: the
 * job's proposal (ProposalAddRq, one line per estimate line, "Taxable" in
 * UserDefined1 and the tax in Memo) and, when the company sends it, the job
 * budget (BudgetAddRq). Amounts are decimal strings. The operation is
 * "add_job_proposal_lines": a writer built before per-line proposals refuses
 * it (unsupported operation) instead of dropping the Taxable tags.
 */

const decimalAmount = z.string().regex(/^-?\d{1,9}\.\d{2}$/)
const sageRecordNumber = z.string().regex(/^\d{1,12}$/)

const lineSchema = z.strictObject({
  description: z.string().trim().min(1).max(50),
  costCodeRecordNumber: sageRecordNumber,
  otherAmount: decimalAmount,
})

const proposalLineSchema = lineSchema.extend({
  userDefined1: z.string().trim().max(50),
  memo: z.string().trim().max(100),
})

const SAGE_ESTIMATE_OPERATION = "add_job_proposal_lines"

const sageEstimateWritePayloadSchema = z.strictObject({
  operationType: z.literal(SAGE_ESTIMATE_OPERATION),
  compassProjectId: z.string().min(1),
  compassEstimateId: z.string().min(1),
  job: z.strictObject({ sageJobNumber: sageRecordNumber, sageJobId: z.string().min(1).nullable() }),
  proposal: z.strictObject({ lines: z.array(proposalLineSchema).min(1).max(500), totalAmount: decimalAmount }),
  budget: z.strictObject({ lines: z.array(lineSchema).min(1).max(500), totalAmount: decimalAmount }).nullable(),
})

export type SageEstimateWritePayload = z.infer<typeof sageEstimateWritePayloadSchema>

export const sageEstimateWriteResultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("succeeded"),
    id: z.uuid(),
    claimToken: z.uuid(),
    proposalLineCount: z.number().int().nonnegative(),
    proposalTotal: decimalAmount,
    budgetLineCount: z.number().int().nonnegative().nullable(),
  }),
  z.strictObject({
    outcome: z.literal("failed"),
    id: z.uuid(),
    claimToken: z.uuid(),
    error: z.string().min(1).max(4000),
    /** A guard stopped it (Sage already has a proposal or budget): staff must look. */
    needsAttention: z.boolean(),
  }),
])

/** The writer payload for a plan with no blockers, or null. */
export function sageEstimateWritePayload(
  plan: SageEstimatePlan,
  input: { readonly projectId: string; readonly estimateId: string; readonly sageJobNumber: string; readonly sageJobId: string | null }
): SageEstimateWritePayload | null {
  if (plan.blockers.length > 0) return null
  const budget = plan.budgetLines && plan.budgetLines.length > 0
    ? {
        lines: sageEstimateWriterLines(plan.budgetLines),
        totalAmount: sageAmount(plan.budgetLines.reduce((sum, line) => sum + line.amountCents, 0)),
      }
    : null
  const parsed = sageEstimateWritePayloadSchema.safeParse({
    operationType: SAGE_ESTIMATE_OPERATION,
    compassProjectId: input.projectId,
    compassEstimateId: input.estimateId,
    job: { sageJobNumber: input.sageJobNumber.trim(), sageJobId: input.sageJobId },
    proposal: { lines: sageProposalWriterLines(plan.proposalLines), totalAmount: sageAmount(plan.proposalTotalCents) },
    budget,
  })
  return parsed.success ? parsed.data : null
}

/** Compass's switch for the estimate bridge routes and automatic sync (off until the owner turns it on). */
export function sageEstimateWritesEnabled(env: unknown): boolean {
  return envFlag(env, "SAGE_ESTIMATE_WRITES_ENABLED")
}
