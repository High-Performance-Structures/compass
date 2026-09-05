"use server"

import { and, desc, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { sageSquarePaymentOperations } from "@/db/schema-sage"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import {
  hydrateLegacySageSquarePaymentScopes,
  sageSquareOrganizationId,
} from "@/lib/sage/square-payment"

export type SquareReceiptListItem = {
  readonly id: string
  readonly projectId: string
  readonly projectNumber: string | null
  readonly projectName: string
  readonly clientName: string | null
  readonly sageJobShortName: string | null
  readonly sageInvoiceId: string
  readonly sageInvoiceNumber: string
  readonly squarePaymentId: string
  readonly squareInvoiceId: string
  readonly department: string
  readonly amountCents: number
  readonly feeCents: number
  readonly currency: string
  readonly depositAccountNumber: number
  readonly merchantFeeAccountNumber: number
  readonly receiptStatus: string
  readonly feeStatus: string | null
  readonly errorMessage: string | null
  readonly paymentCompletedAt: string
  readonly requestedAt: string
  readonly completedAt: string | null
}

function combinedFeeStatus(statuses: readonly string[]): string | null {
  if (statuses.length === 0) return null
  if (statuses.some((status) => status === "failed" || status === "attention")) {
    return "attention"
  }
  if (statuses.every((status) => status === "succeeded")) return "succeeded"
  if (statuses.some((status) => status === "running")) return "running"
  return "queued"
}

export async function getSageSquareReceipts(
  projectId?: string
): Promise<
  SquareReceiptListItem[]
> {
  const user = await requireAuth()
  requirePermission(user, "finance", "read")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  if (sageSquareOrganizationId(env) === organizationId) {
    await hydrateLegacySageSquarePaymentScopes(env)
  }

  const receipts = await db
    .select({
      id: sageSquarePaymentOperations.id,
      projectId: projects.id,
      projectNumber: projects.projectNumber,
      projectName: projects.name,
      clientName: projects.clientName,
      sageJobShortName: sageSquarePaymentOperations.sageJobShortName,
      sageInvoiceId: sageSquarePaymentOperations.sageInvoiceId,
      sageInvoiceNumber: sageSquarePaymentOperations.sageInvoiceNumber,
      squarePaymentId: sageSquarePaymentOperations.squarePaymentId,
      squareInvoiceId: sageSquarePaymentOperations.squareInvoiceId,
      department: sageSquarePaymentOperations.department,
      amountCents: sageSquarePaymentOperations.amountCents,
      currency: sageSquarePaymentOperations.currency,
      depositAccountNumber: sageSquarePaymentOperations.depositAccountNumber,
      merchantFeeAccountNumber:
        sageSquarePaymentOperations.merchantFeeAccountNumber,
      receiptStatus: sageSquarePaymentOperations.status,
      errorMessage: sageSquarePaymentOperations.errorMessage,
      paymentCompletedAt: sageSquarePaymentOperations.paymentCompletedAt,
      requestedAt: sageSquarePaymentOperations.requestedAt,
      completedAt: sageSquarePaymentOperations.completedAt,
    })
    .from(sageSquarePaymentOperations)
    .innerJoin(
      projects,
      eq(projects.id, sageSquarePaymentOperations.projectId)
    )
    .where(
      and(
        eq(sageSquarePaymentOperations.organizationId, organizationId),
        eq(sageSquarePaymentOperations.operationType, "post_square_receipt"),
        projectId ? eq(projects.id, projectId) : undefined
      )
    )
    .orderBy(desc(sageSquarePaymentOperations.paymentCompletedAt))

  if (receipts.length === 0) return []
  const paymentIds = [...new Set(receipts.map((receipt) => receipt.squarePaymentId))]
  const fees = await db
    .select({
      squarePaymentId: sageSquarePaymentOperations.squarePaymentId,
      amountCents: sageSquarePaymentOperations.amountCents,
      status: sageSquarePaymentOperations.status,
    })
    .from(sageSquarePaymentOperations)
    .where(
      and(
        eq(sageSquarePaymentOperations.organizationId, organizationId),
        eq(
          sageSquarePaymentOperations.operationType,
          "post_square_processing_fee"
        ),
        inArray(sageSquarePaymentOperations.squarePaymentId, paymentIds)
      )
    )
  const feesByPayment = new Map<
    string,
    { amountCents: number; statuses: string[] }
  >()
  for (const fee of fees) {
    const current = feesByPayment.get(fee.squarePaymentId) ?? {
      amountCents: 0,
      statuses: [],
    }
    current.amountCents += fee.amountCents
    current.statuses.push(fee.status)
    feesByPayment.set(fee.squarePaymentId, current)
  }

  return receipts.map((receipt) => {
    const fee = feesByPayment.get(receipt.squarePaymentId)
    return {
      ...receipt,
      feeCents: fee?.amountCents ?? 0,
      feeStatus: combinedFeeStatus(fee?.statuses ?? []),
    }
  })
}
