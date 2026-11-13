/**
 * The change order a Selection Phase signature carries for its difference
 * from the allowance (round-signing.ts): the only change order selections
 * write (a replacement gets a to-do; staff write its change order). Priced
 * at owner prices, which already include the builder fee, so no fee lines
 * are added; project liability insurance is
 * added the way change orders from estimates get it (variance rules, fee by
 * contract type: docs and src/lib/domain/estimates/variances.ts).
 */
import { eq } from "drizzle-orm"

import { projects } from "@/db/schema"
import { projectChangeOrderLines, projectChangeOrders } from "@/db/schema-change-orders"
import { changeOrderNumber, changeOrderNumberColumns } from "@/lib/change-orders/numbering"
import {
  insertChangeOrderHistoryStatement,
  insertChangeOrderLineStatement,
  insertChangeOrderStatement,
} from "@/lib/domain/estimates/store"
import { changeOrderInsuranceLines, type VarianceActor } from "@/lib/domain/estimates/variances"
import type { Db } from "@/lib/server/action-context"

export type SelectionChangeOrderActor = VarianceActor & { readonly name: string }

export type SelectionChangeOrderLine = { readonly costCode: string; readonly description: string; readonly amountCents: number }

/** Project liability insurance for the coded, priced lines (change orders get it the way estimates do). */
async function selectionInsuranceLines(db: Db, projectId: string, lines: readonly SelectionChangeOrderLine[]) {
  return changeOrderInsuranceLines({ db, projectId, lines })
}

/**
 * How the change order starts: inside a signature already going out
 * (signature pending, sent with the round document), or as a draft staff
 * complete and send for the owner's signature the usual way.
 */
type Start =
  | { readonly kind: "in_signature" }
  | { readonly kind: "draft" }

export async function createSelectionChangeOrder(
  db: Db,
  input: {
    readonly projectId: string
    readonly start: Start
    readonly sourceType: string
    readonly sourceRecordId: string
    readonly title: string
    readonly scope: string
    readonly reason: string
    readonly lines: readonly SelectionChangeOrderLine[]
    readonly history: { readonly eventType: string; readonly note: string; readonly metadata: Record<string, unknown> }
    readonly actor: SelectionChangeOrderActor
    readonly now: string
  },
): Promise<{ readonly id: string; readonly number: string }> {
  const project = await db.select({ projectNumber: projects.projectNumber }).from(projects).where(eq(projects.id, input.projectId)).get()
  const id = crypto.randomUUID()
  const insurance = await selectionInsuranceLines(db, input.projectId, input.lines)
  const allLines = [
    ...input.lines.map((line) => ({ ...line, derivedFrom: null })),
    ...insurance.map((line) => ({ costCode: line.costCode, description: line.description, amountCents: line.amountCents, derivedFrom: line.derivedFrom })),
  ]
  const amountCents = allLines.reduce((total, line) => total + line.amountCents, 0)
  const status = input.start.kind === "in_signature" ? "signature_pending" : "draft"
  const lineRows = allLines.map((line, index) => ({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    changeOrderId: id,
    lineNumber: index + 1,
    description: line.description,
    phaseCode: line.costCode.slice(0, 2),
    costCode: line.costCode,
    amountCents: line.amountCents,
    derivedFrom: line.derivedFrom,
    createdAt: input.now,
    updatedAt: input.now,
  }))
  // Two change orders made at once can take the same next number; the unique
  // index refuses the second, which reads the numbers again and retries.
  for (let attempt = 1; ; attempt += 1) {
    const existing = await db.select(changeOrderNumberColumns).from(projectChangeOrders).where(eq(projectChangeOrders.projectId, input.projectId))
    const number = changeOrderNumber(project?.projectNumber ?? null, existing)
    try {
      await insertChangeOrderRows(db, { ...input, id, number, status, amountCents, lineRows })
      return { id, number }
    } catch (error) {
      // Only a taken number is retried; any other conflict (one live replacement change order) is final.
      if (attempt >= NUMBER_ATTEMPTS || !(error instanceof Error && /UNIQUE constraint failed.*change_order_number/i.test(error.message))) throw error
    }
  }
}

const NUMBER_ATTEMPTS = 4

async function insertChangeOrderRows(
  db: Db,
  input: Parameters<typeof createSelectionChangeOrder>[1] & {
    readonly id: string
    readonly number: string
    readonly status: "signature_pending" | "draft"
    readonly amountCents: number
    readonly lineRows: readonly (typeof projectChangeOrderLines.$inferInsert)[]
  },
): Promise<void> {
  const { id, number, status, amountCents, lineRows } = input
  await db.batch([
    insertChangeOrderStatement(db, {
      id,
      projectId: input.projectId,
      changeOrderNumber: number,
      recordType: "change_order",
      title: input.title.slice(0, 200),
      scope: input.scope,
      reason: input.reason,
      amountCents,
      status,
      audience: "owner",
      requesterType: "internal",
      requesterUserId: input.actor.id,
      requesterName: input.actor.name.slice(0, 200),
      sourceType: input.sourceType,
      sourceRecordId: input.sourceRecordId,
      budgetTreatment: "additive",
      changeOrderKind: "description",
      foxitStatus: input.start.kind === "in_signature" ? "sent" : "not_started",
      sageStatus: "not_ready",
      createdBy: input.actor.id,
      submittedAt: input.start.kind === "in_signature" ? input.now : null,
      createdAt: input.now,
      updatedAt: input.now,
    }),
    ...(lineRows.length > 0 ? [insertChangeOrderLineStatement(db, lineRows)] : []),
    insertChangeOrderHistoryStatement(db, {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      changeOrderId: id,
      eventType: input.history.eventType,
      fromStatus: null,
      toStatus: status,
      actorUserId: input.actor.id,
      actorName: input.actor.name.slice(0, 200),
      actorRole: input.actor.role.slice(0, 80),
      note: input.history.note,
      metadataJson: JSON.stringify({ ...input.history.metadata, amountCents }),
      createdAt: input.now,
    }),
  ])
}
