/**
 * Keeping a replacement's draft change order priced for its pick
 * (replacement.ts). When staff change the replacement's pick, or the pick's
 * owner price changes (staff, or a supplier's RFQ price), the draft's pick
 * line is updated in place on the SAME change order (number and other staff
 * lines kept), project insurance is recomputed and the total updated. Only
 * staff (with change-order permission) or the RFQ fill-back re-price; an
 * owner's pick only records their preference and leaves the draft for staff
 * ("pick changed — update the change order"). Once the change order has left
 * draft the pick is fixed (choices-store), so nothing is re-priced.
 */
import { and, eq, sql } from "drizzle-orm"

import { projectChangeOrderLines, projectChangeOrders, projectFinishSelections, projects } from "@/db/schema"
import { projectSelectionChoices } from "@/db/schema-selection-choices"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import {
  deleteChangeOrderLinesStatement,
  insertChangeOrderHistoryWhenStatement,
  insertChangeOrderLineWhenStatement,
  updateChangeOrderLinesStatement,
  updateChangeOrdersStatement,
} from "@/lib/domain/estimates/store"
import type { Db } from "@/lib/server/action-context"

import { replacementChangeOrderFor } from "./lock-read"
import { REPLACEMENT_REASON_LABELS, replacementLineAmount, replacementLineDescription, replacementPricingStaleState, type ReplacementPricingState } from "./locks"
import { selectionInsuranceLines } from "./selection-change-orders"
import { repriceReplacementStatement } from "./store"

export type RepriceResult =
  | { readonly kind: "repriced"; readonly changeOrderNumber: string }
  | { readonly kind: "unchanged" }
  | { readonly kind: "skipped"; readonly reason: string }

/** Who re-prices: a staff member allowed to change change orders, or the system (an RFQ price). */
type Repricer = { readonly kind: "staff"; readonly actor: ActivityActor; readonly canUpdateChangeOrders: boolean } | { readonly kind: "system" }

const SYSTEM_ACTOR: ActivityActor = { id: null, email: "rfq", displayName: "Supplier price", firstName: null, lastName: null, role: "system" }

/** Everything re-pricing reads, and the pick line as it is and as it should be. */
async function loadPricing(db: Db, projectId: string, selectionId: string) {
  const selection = await db
    .select({
      name: projectFinishSelections.name,
      reason: projectFinishSelections.replacementReason,
      replacesSelectionId: projectFinishSelections.replacesSelectionId,
      costCode: projectFinishSelections.costCode,
      pricedChoiceId: projectFinishSelections.replacementPricedChoiceId,
      pricedLineId: projectFinishSelections.replacementPricedLineId,
    })
    .from(projectFinishSelections)
    .where(and(eq(projectFinishSelections.id, selectionId), eq(projectFinishSelections.projectId, projectId)))
    .get()
  if (!selection?.replacesSelectionId || !selection.reason) return null
  const order = await replacementChangeOrderFor(db, projectId, selectionId)
  if (!order) return null
  const [replaced, pick, lines] = await Promise.all([
    db.select({ settled: projectFinishSelections.settledOwnerPriceCents }).from(projectFinishSelections).where(eq(projectFinishSelections.id, selection.replacesSelectionId)).get(),
    db
      .select({ id: projectSelectionChoices.id, title: projectSelectionChoices.title, ownerPriceCents: projectSelectionChoices.ownerPriceCents })
      .from(projectSelectionChoices)
      .where(and(eq(projectSelectionChoices.selectionId, selectionId), eq(projectSelectionChoices.chosen, true)))
      .get(),
    db
      .select({
        id: projectChangeOrderLines.id,
        lineNumber: projectChangeOrderLines.lineNumber,
        costCode: projectChangeOrderLines.costCode,
        description: projectChangeOrderLines.description,
        amountCents: projectChangeOrderLines.amountCents,
        derivedFrom: projectChangeOrderLines.derivedFrom,
      })
      .from(projectChangeOrderLines)
      .where(eq(projectChangeOrderLines.changeOrderId, order.id)),
  ])
  const amountCents = replacementLineAmount(selection.reason, pick?.ownerPriceCents ?? null, replaced?.settled ?? null)
  const existing = lines.find((line) => line.id === selection.pricedLineId) ?? null
  const state: ReplacementPricingState = {
    status: order.status,
    pickId: pick?.id ?? null,
    pricedId: selection.pricedChoiceId,
    line: existing,
    expected: {
      amountCents,
      description: replacementLineDescription(selection.name, pick?.title ?? null, REPLACEMENT_REASON_LABELS[selection.reason], amountCents === null),
      costCode: selection.costCode?.trim() || null,
    },
  }
  return { selection, order, pick: pick ?? null, lines, existing, state }
}

/** Whether the replacement's draft change order no longer prices its current pick (staff should update it). */
export async function replacementPricingStale(db: Db, projectId: string, selectionId: string): Promise<boolean> {
  const pricing = await loadPricing(db, projectId, selectionId)
  return pricing !== null && pricing.state.status === "draft" && replacementPricingStaleState(pricing.state)
}

/**
 * Why a replacement's change order can't go to the owner yet, or null: no
 * pick, the pick line doesn't price the current pick, or an amount staff
 * must enter is still $0.
 */
export async function replacementPricingBlocker(db: Db, projectId: string, selectionId: string): Promise<string | null> {
  const pricing = await loadPricing(db, projectId, selectionId)
  if (!pricing) return null
  if (!pricing.state.pickId) return "Pick the replacement product on the selection first: this change order prices it."
  if (replacementPricingStaleState(pricing.state)) {
    return "The replacement's pick or price changed after this change order was priced. Use Update change order on the selection."
  }
  if (pricing.state.expected.amountCents === null && (pricing.existing?.amountCents ?? 0) === 0) {
    return "Enter the amount on this change order: no price was recorded for the order the supplier couldn't fill."
  }
  return null
}

export async function repriceReplacementChangeOrder(
  db: Db,
  input: { readonly projectId: string; readonly selectionId: string; readonly by: Repricer },
): Promise<RepriceResult> {
  if (input.by.kind === "staff" && !input.by.canUpdateChangeOrders) return { kind: "skipped", reason: "You don't have permission to change change orders." }
  const pricing = await loadPricing(db, input.projectId, input.selectionId)
  if (!pricing) return { kind: "skipped", reason: "Not a replacement with a change order." }
  const { selection, order, pick, lines, existing, state } = pricing
  if (order.status !== "draft") return { kind: "skipped", reason: "The change order has left draft; its pick is fixed." }
  // Only a change order Compass builds from a description is re-priced here.
  if (order.kind !== "description") return { kind: "skipped", reason: "This change order is priced from an estimate; update it there." }
  if (!replacementPricingStaleState(state)) return { kind: "unchanged" }
  const { description, costCode } = state.expected
  // A staff-entered amount (no recorded price to work from) stays theirs.
  const amountCents = state.expected.amountCents ?? existing?.amountCents ?? 0

  const lineId = existing?.id ?? crypto.randomUUID()
  const token = new Date().toISOString()
  // Every write below lands only with the selection's re-price (same token).
  const repriced = sql`EXISTS (SELECT 1 FROM project_finish_selections WHERE id = ${input.selectionId} AND updated_at = ${token} AND replacement_priced_line_id = ${lineId})`
  const staffLines = lines.filter((line) => line.derivedFrom === null && line.id !== lineId)
  const priced = [...staffLines.map((line) => ({ costCode: line.costCode, description: line.description, amountCents: line.amountCents ?? 0 })), { costCode, description, amountCents }]
  const insurance = await selectionInsuranceLines(db, input.projectId, priced)
  const total = priced.reduce((sum, line) => sum + line.amountCents, 0) + insurance.reduce((sum, line) => sum + line.amountCents, 0)
  const nextNumber = Math.max(0, ...lines.map((line) => line.lineNumber)) + 1
  const actor = input.by.kind === "staff" ? input.by.actor : SYSTEM_ACTOR
  const [selectionWrite] = await db.batch([
    repriceReplacementStatement(db, { projectId: input.projectId, selectionId: input.selectionId, changeOrderId: order.id, expectedChoiceId: selection.pricedChoiceId, choiceId: pick?.id ?? null, lineId, token }),
    existing
      ? updateChangeOrderLinesStatement(db, and(eq(projectChangeOrderLines.id, lineId), repriced), {
          description,
          costCode,
          phaseCode: costCode ? costCode.slice(0, 2) : null,
          amountCents,
          updatedAt: token,
        })
      : insertChangeOrderLineWhenStatement(
          db,
          { id: lineId, projectId: input.projectId, changeOrderId: order.id, lineNumber: nextNumber, description, costCode, phaseCode: costCode ? costCode.slice(0, 2) : null, amountCents, createdAt: token, updatedAt: token },
          repriced,
        ),
    deleteChangeOrderLinesStatement(db, and(eq(projectChangeOrderLines.changeOrderId, order.id), eq(projectChangeOrderLines.derivedFrom, "insurance"), repriced)),
    ...insurance.map((line, index) =>
      insertChangeOrderLineWhenStatement(
        db,
        {
          id: crypto.randomUUID(),
          projectId: input.projectId,
          changeOrderId: order.id,
          lineNumber: nextNumber + 1 + index,
          description: line.description,
          costCode: line.costCode,
          phaseCode: line.costCode.slice(0, 2),
          amountCents: line.amountCents,
          derivedFrom: line.derivedFrom,
          createdAt: token,
          updatedAt: token,
        },
        repriced,
      ),
    ),
    updateChangeOrdersStatement(db, and(eq(projectChangeOrders.id, order.id), eq(projectChangeOrders.status, "draft"), repriced), { amountCents: total, updatedAt: token }),
    insertChangeOrderHistoryWhenStatement(
      db,
      {
        id: crypto.randomUUID(),
        projectId: input.projectId,
        changeOrderId: order.id,
        eventType: "repriced_for_selection_pick",
        fromStatus: "draft",
        toStatus: "draft",
        actorUserId: actor.id,
        actorName: (actor.displayName ?? actor.email).slice(0, 200),
        actorRole: actor.role.slice(0, 80),
        note: `Re-priced for ${pick?.title ?? "no pick yet"}.`,
        metadataJson: JSON.stringify({ selectionId: input.selectionId, choiceId: pick?.id ?? null, previousChoiceId: selection.pricedChoiceId, amountCents, total }),
        createdAt: token,
      },
      repriced,
    ),
  ])
  if (selectionWrite.meta.changes === 0) return { kind: "skipped", reason: "The replacement was re-priced meanwhile. Refresh." }
  const organization = await db.select({ id: projects.organizationId }).from(projects).where(eq(projects.id, input.projectId)).get()
  if (organization?.id) {
    await recordActivityEvent({
      db,
      organizationId: organization.id,
      projectId: input.projectId,
      actor,
      category: "financial",
      action: "selection_replacement_repriced",
      entityType: "project_change_order",
      entityId: order.id,
      summary: `Change order ${order.number} re-priced for ${selection.name}: ${pick?.title ?? "no pick yet"}.`,
      metadata: { selectionId: input.selectionId, choiceId: pick?.id ?? null, amountCents, total },
      createdAt: token,
    })
  }
  return { kind: "repriced", changeOrderNumber: order.number }
}
