import { and, asc, eq } from "drizzle-orm"

import { projectChangeOrderLines, projectChangeOrders, projectContacts, projects, users } from "@/db/schema"
import { activityActorName, recordActivityEvent } from "@/lib/activity-log"
import type { AuthUser } from "@/lib/auth"
import { isChangeOrderKind } from "@/lib/change-orders/kinds"
import {
  changeOrderAcceptanceSummary,
  isPricedChangeOrder,
  manualAcceptanceAvailability,
  validateManualAcceptance,
  type ManualAcceptanceInput,
} from "@/lib/change-orders/manual-acceptance"
import { isChangeOrderStatus } from "@/lib/change-orders/status"
import type { ChangeOrderAcceptanceView, ChangeOrderManualAcceptanceOptions } from "@/lib/change-orders/types"
import { executedDocumentSource } from "@/lib/contracts/executed-document-source"
import { insertChangeOrderHistoryStatement, updateChangeOrdersStatement } from "@/lib/domain/estimates/store"
import { DEFAULT_CHANGE_ORDER_ACCEPTANCE_SETTINGS } from "@/lib/feature-settings/contract-settings"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { rebuildProjectContractBudget } from "@/lib/financials/contract-budget-store"
import type { Db } from "@/lib/server/action-context"
import { canManageUserAccessRole } from "@/lib/user-roles"
import { resolvedContactColumns, withContactDirectory } from "@/lib/domain/contacts/resolved-columns"

/*
 * Recording an owner's acceptance of a change order by written approval or a
 * staff sign-off (rules in src/lib/change-orders/manual-acceptance.ts). It
 * executes the change order the same way a status change to Executed does:
 * the same cost-line check, a history entry, and a contract budget rebuild.
 * Callers check that the user is staff who may approve change orders.
 */

type ChangeOrderRow = typeof projectChangeOrders.$inferSelect

/**
 * Why a change order with cost lines can't be executed yet, or null. Shared
 * with the Executed status change so both paths ask the same thing.
 */
export async function changeOrderExecutionLinesError(
  db: Db,
  projectId: string,
  changeOrderId: string
): Promise<string | null> {
  const lines = await db
    .select({ costCode: projectChangeOrderLines.costCode, amountCents: projectChangeOrderLines.amountCents })
    .from(projectChangeOrderLines)
    .where(and(eq(projectChangeOrderLines.changeOrderId, changeOrderId), eq(projectChangeOrderLines.projectId, projectId)))
  if (lines.length === 0) return "Add at least one cost-coded line before execution."
  if (lines.some((line) => !line.costCode || line.amountCents === null)) {
    return "Every executed change-order line needs a cost code and amount so it can revise the G703."
  }
  return null
}

async function acceptanceSettings(db: Db, organizationId: string | null): Promise<typeof DEFAULT_CHANGE_ORDER_ACCEPTANCE_SETTINGS> {
  return organizationId
    ? readFeatureSettings(db, organizationId, "change-order-acceptance")
    : DEFAULT_CHANGE_ORDER_ACCEPTANCE_SETTINGS
}

async function availabilityFor(input: {
  readonly db: Db
  readonly row: ChangeOrderRow
  readonly user: AuthUser
  readonly internal: boolean
  readonly canApprove: boolean
}): Promise<ReturnType<typeof manualAcceptanceAvailability>> {
  if (!input.internal || !input.canApprove || !isChangeOrderStatus(input.row.status)) return null
  // A variance is approved by staff; the owner is informed, never asked to accept.
  if (input.row.recordType === "variance") return null
  return manualAcceptanceAvailability({
    status: input.row.status,
    kind: isChangeOrderKind(input.row.changeOrderKind) ? input.row.changeOrderKind : null,
    budgetTreatment: input.row.budgetTreatment,
    amountCents: input.row.amountCents,
    internal: input.internal,
    canApprove: input.canApprove,
    isAdmin: canManageUserAccessRole(input.user.role),
    settings: await acceptanceSettings(input.db, input.user.organizationId),
  })
}

/** A change order's recorded acceptance, for the detail view and printed copies; the note is staff only. */
export async function recordedChangeOrderAcceptance(
  db: Db,
  row: Pick<
    ChangeOrderRow,
    "acceptanceMethod" | "acceptedOn" | "acceptedByNameSnapshot" | "acceptanceRecordedBy" | "acceptanceNote"
  >,
  includeNote: boolean
): Promise<ChangeOrderAcceptanceView | null> {
  if (!row.acceptanceMethod || !row.acceptedOn) return null
  const recorder = row.acceptanceRecordedBy
    ? await db
        .select({ id: users.id, displayName: users.displayName, firstName: users.firstName, lastName: users.lastName, email: users.email, role: users.role })
        .from(users)
        .where(eq(users.id, row.acceptanceRecordedBy))
        .get()
    : undefined
  const recorded = {
    method: row.acceptanceMethod,
    acceptedByName: row.acceptedByNameSnapshot ?? "the owner",
    acceptedOn: row.acceptedOn,
    recordedByName: recorder ? activityActorName(recorder) : null,
  }
  return { ...recorded, note: includeNote ? row.acceptanceNote : null, summary: changeOrderAcceptanceSummary(recorded) }
}

/** The recorded acceptance and, for staff who may record one, the dialog's choices. */
export async function changeOrderAcceptanceView(input: {
  readonly db: Db
  readonly row: ChangeOrderRow
  readonly user: AuthUser
  readonly internal: boolean
  readonly canApprove: boolean
}): Promise<{
  readonly acceptance: ChangeOrderAcceptanceView | null
  readonly manualAcceptance: ChangeOrderManualAcceptanceOptions | null
}> {
  const { db, row } = input
  const [acceptance, availability] = await Promise.all([
    recordedChangeOrderAcceptance(db, row, input.internal),
    availabilityFor(input),
  ])
  if (!availability) return { acceptance, manualAcceptance: null }
  const [contacts, project] = await Promise.all([
    withContactDirectory(db
      .select({ id: projectContacts.id, name: resolvedContactColumns.displayName, company: resolvedContactColumns.companyName })
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.projectId, row.projectId),
          eq(projectContacts.contactType, "owner"),
          eq(projectContacts.active, true)
        )
      )
      .orderBy(asc(resolvedContactColumns.displayName)).$dynamic()),
    db.select({ clientName: projects.clientName }).from(projects).where(eq(projects.id, row.projectId)).get(),
  ])
  const kind = isChangeOrderKind(row.changeOrderKind) ? row.changeOrderKind : null
  return {
    acceptance,
    manualAcceptance: {
      ...availability,
      priced: isPricedChangeOrder({ kind, amountCents: row.amountCents }),
      approvers: contacts,
      clientName: project?.clientName ?? null,
    },
  }
}

export type RecordAcceptanceResult =
  | { readonly success: true; readonly budgetNote: string | null }
  | { readonly success: false; readonly error: string }

export async function recordChangeOrderManualAcceptance(input: {
  readonly db: Db
  readonly organizationId: string | null
  readonly projectId: string
  readonly changeOrderId: string
  readonly user: AuthUser
  readonly canApprove: boolean
  readonly acceptance: ManualAcceptanceInput
}): Promise<RecordAcceptanceResult> {
  const { db, projectId, changeOrderId, user } = input
  const row = await db
    .select()
    .from(projectChangeOrders)
    .where(and(eq(projectChangeOrders.id, changeOrderId), eq(projectChangeOrders.projectId, projectId)))
    .get()
  if (!row || !isChangeOrderStatus(row.status)) return { success: false, error: "Change order not found." }
  const fromStatus = row.status
  const availability = await availabilityFor({ db, row, user, internal: true, canApprove: input.canApprove })
  if (!availability) {
    return { success: false, error: "This change order's acceptance can't be recorded here." }
  }
  const now = new Date().toISOString()
  const validated = validateManualAcceptance(input.acceptance, now.slice(0, 10))
  if (!validated.success) return validated
  const accepted = validated.value
  if (accepted.method === "staff_signoff" && !availability.staffSignOff) {
    return { success: false, error: availability.staffSignOffBlocker ?? "Staff sign-off isn't allowed here." }
  }

  let evidence: { readonly url: string; readonly label: string } | null = null
  if (accepted.method === "written_approval") {
    const source = executedDocumentSource(accepted.evidence.url)
    if (!source || source.kind === "foxit") {
      return { success: false, error: "The written approval must be a Google Drive or secure HTTPS document link." }
    }
    evidence = { url: source.kind === "external" ? source.url : accepted.evidence.url, label: accepted.evidence.label }
  }

  let approverName = accepted.acceptedByName
  if (accepted.acceptedByContactId) {
    const contact = await withContactDirectory(db
      .select({ name: resolvedContactColumns.displayName })
      .from(projectContacts)
      .where(and(eq(projectContacts.id, accepted.acceptedByContactId), eq(projectContacts.projectId, projectId))).$dynamic())
      .get()
    if (!contact) return { success: false, error: "Choose an owner contact on this project." }
    approverName = contact.name
  }
  if (!approverName) return { success: false, error: "Choose who approved the change order." }

  // The same check as the Executed status change: lines need cost codes to revise the budget.
  if (row.changeOrderKind !== "description") {
    const linesError = await changeOrderExecutionLinesError(db, projectId, changeOrderId)
    if (linesError) return { success: false, error: linesError }
  }

  const recorderName = activityActorName(user)
  const summary = changeOrderAcceptanceSummary({
    method: accepted.method,
    acceptedByName: approverName,
    acceptedOn: accepted.acceptedOn,
    recordedByName: recorderName,
  })
  await db.batch([
    updateChangeOrdersStatement(
      db,
      // Guarded on the status read above so two people can't execute it twice.
      and(
        eq(projectChangeOrders.id, changeOrderId),
        eq(projectChangeOrders.projectId, projectId),
        eq(projectChangeOrders.status, fromStatus)
      ),
      {
        status: "executed",
        // Noon UTC reads as the approval date in every US time zone.
        executedAt: `${accepted.acceptedOn}T12:00:00.000Z`,
        ...(evidence ? { executedDocumentUrl: evidence.url, executedDocumentLabel: evidence.label } : {}),
        acceptanceMethod: accepted.method,
        acceptedByContactId: accepted.acceptedByContactId,
        acceptedByNameSnapshot: approverName.slice(0, 200),
        acceptedOn: accepted.acceptedOn,
        acceptanceRecordedBy: user.id,
        acceptanceNote: accepted.note,
        updatedAt: now,
      }
    ),
    insertChangeOrderHistoryStatement(db, {
      id: crypto.randomUUID(),
      projectId,
      changeOrderId,
      eventType: "acceptance_recorded",
      fromStatus,
      toStatus: "executed",
      actorUserId: user.id,
      actorName: recorderName.slice(0, 200),
      actorRole: user.role.slice(0, 80),
      note: accepted.note ? `${summary}. ${accepted.note}` : `${summary}.`,
      metadataJson: JSON.stringify({
        acceptanceMethod: accepted.method,
        acceptedByContactId: accepted.acceptedByContactId,
        acceptedOn: accepted.acceptedOn,
        evidenceLabel: evidence?.label ?? null,
      }),
      createdAt: now,
    }),
  ])

  const budget = await rebuildProjectContractBudget({ db, projectId, actorUserId: user.id })
  if (input.organizationId) {
    await recordActivityEvent({
      db,
      organizationId: input.organizationId,
      projectId,
      actor: user,
      category: "financial",
      action: "change_order_acceptance_recorded",
      entityType: "project_change_order",
      entityId: changeOrderId,
      summary: `${row.changeOrderNumber}: ${summary}.`,
      metadata: { acceptanceMethod: accepted.method, acceptedOn: accepted.acceptedOn, amountCents: row.amountCents },
      createdAt: now,
    })
  }
  return { success: true, budgetNote: budget.success ? null : budget.error }
}
