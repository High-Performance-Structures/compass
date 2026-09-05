"use server"

import { and, eq, isNull, notExists, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"
import {
  projectFinishSelections,
  projectChangeOrders,
  projectOperations,
} from "@/db/schema"
import {
  projectSelectionDecisions as decisions,
  projectSelectionDecisionEvents as events,
  projectSelectionRequests as requests,
  projectSelectionProcurementLinks as links,
} from "@/db/schema-selection-decisions"
import { selectionAccess } from "@/lib/selections/access"
import {
  approvalBlocker,
  moneyCents,
  specificationJson,
} from "@/lib/selections/decisions"

type Result =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
const publishSchema = z.object({
  selectionId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  selectionUpdatedAt: z.string(),
  published: z.boolean(),
  decisionDueDate: z.string().max(10),
  allowance: z.string(),
  price: z.string(),
  scheduleImpact: z.string().max(2000),
  ownerNote: z.string().max(4000),
  requiresChangeOrder: z.boolean(),
  changeOrderId: z.string(),
})
export type PublishSelectionInput = z.infer<typeof publishSchema>
function failure(error: unknown): Result {
  return {
    success: false,
    error:
      error instanceof Error ? error.message : "Unable to save this selection.",
  }
}
function revalidate(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/selections`)
  for (const audience of ["owner", "sub-vendor"]) {
    revalidatePath(`/preview/projects/${projectId}/${audience}`)
    revalidatePath(`/preview/projects/${projectId}/${audience}/selections`)
  }
}

export async function publishSelectionDecision(
  projectId: string,
  raw: PublishSelectionInput
): Promise<Result> {
  try {
    const input = publishSchema.parse(raw)
    const { db, user, actorName } = await selectionAccess(
      projectId,
      "staff",
      true
    )
    const row = await db
      .select()
      .from(projectFinishSelections)
      .where(
        and(
          eq(projectFinishSelections.id, input.selectionId),
          eq(projectFinishSelections.projectId, projectId)
        )
      )
      .get()
    if (!row || row.updatedAt !== input.selectionUpdatedAt)
      throw new Error(
        "The selection changed. Refresh and review it before publishing."
      )
    if (
      input.decisionDueDate &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(input.decisionDueDate) ||
        new Date(`${input.decisionDueDate}T00:00:00Z`)
          .toISOString()
          .slice(0, 10) !== input.decisionDueDate)
    )
      throw new Error("Enter a valid decision deadline.")
    const changeOrderId = input.changeOrderId || null
    if (changeOrderId) {
      const change = await db
        .select({ id: projectChangeOrders.id })
        .from(projectChangeOrders)
        .where(
          and(
            eq(projectChangeOrders.id, changeOrderId),
            eq(projectChangeOrders.projectId, projectId),
            eq(projectChangeOrders.audience, "owner")
          )
        )
        .get()
      if (!change)
        throw new Error(
          "Choose an owner-visible change order from this project."
        )
    }
    const existing = await db
      .select()
      .from(decisions)
      .where(eq(decisions.selectionId, row.id))
      .get()
    if ((existing?.revision ?? 0) !== input.expectedRevision)
      throw new Error(
        "Another person updated this decision. Refresh before saving."
      )
    const now = new Date().toISOString(),
      token = crypto.randomUUID()
    const terms = {
      revision: input.expectedRevision + 1,
      published: input.published,
      specificationJson: specificationJson(row),
      decisionDueDate: input.decisionDueDate || null,
      allowanceCents: moneyCents(input.allowance),
      quotedCents: moneyCents(input.price),
      scheduleImpact: input.scheduleImpact.trim() || null,
      ownerNote: input.ownerNote.trim() || null,
      changeOrderId,
      requiresChangeOrder: input.requiresChangeOrder,
      approvedBy: null,
      approvedByName: null,
      approvedAt: null,
      lastMutationId: token,
      updatedAt: now,
    }
    // Both the draft timestamp and decision revision are checked by the write;
    // audit/visibility writes run only if that exact mutation won the race.
    const mutation = db
      .insert(decisions)
      .select(
        db
          .select({
            selectionId: projectFinishSelections.id,
            projectId: projectFinishSelections.projectId,
            revision: sql<number>`${terms.revision}`.as("revision"),
            published: sql<boolean>`${Number(terms.published)}`.as("published"),
            specificationJson: sql<string>`${terms.specificationJson}`.as(
              "specificationJson"
            ),
            decisionDueDate: sql<string | null>`${terms.decisionDueDate}`.as(
              "decisionDueDate"
            ),
            allowanceCents: sql<number | null>`${terms.allowanceCents}`.as(
              "allowanceCents"
            ),
            quotedCents: sql<number | null>`${terms.quotedCents}`.as(
              "quotedCents"
            ),
            scheduleImpact: sql<string | null>`${terms.scheduleImpact}`.as(
              "scheduleImpact"
            ),
            ownerNote: sql<string | null>`${terms.ownerNote}`.as("ownerNote"),
            changeOrderId: sql<string | null>`${changeOrderId}`.as(
              "changeOrderId"
            ),
            requiresChangeOrder:
              sql<boolean>`${Number(terms.requiresChangeOrder)}`.as(
                "requiresChangeOrder"
              ),
            approvedBy: sql<null>`NULL`.as("approvedBy"),
            approvedByName: sql<null>`NULL`.as("approvedByName"),
            approvedAt: sql<null>`NULL`.as("approvedAt"),
            lastMutationId: sql<string>`${token}`.as("lastMutationId"),
            updatedAt: sql<string>`${now}`.as("updatedAt"),
          })
          .from(projectFinishSelections)
          .where(
            and(
              eq(projectFinishSelections.id, row.id),
              eq(projectFinishSelections.projectId, projectId),
              eq(projectFinishSelections.updatedAt, row.updatedAt)
            )
          )
      )
      .onConflictDoUpdate({
        target: decisions.selectionId,
        set: terms,
        where: eq(decisions.revision, input.expectedRevision),
      })
    const audit = db.insert(events).select(
      db
        .select({
          id: sql<string>`${token}`.as("id"),
          projectId: decisions.projectId,
          selectionId: decisions.selectionId,
          revision: decisions.revision,
          actorId: sql<string>`${user.id}`.as("actorId"),
          actorName: sql<string>`${actorName}`.as("actorName"),
          kind: sql<string>`${input.published ? "published" : "unpublished"}`.as(
            "kind"
          ),
          snapshotJson: sql<string>`${JSON.stringify(terms)}`.as(
            "snapshotJson"
          ),
          createdAt: sql<string>`${now}`.as("createdAt"),
        })
        .from(decisions)
        .where(eq(decisions.lastMutationId, token))
    )
    const result = await db.batch([
      mutation,
      audit,
      db
        .update(projectFinishSelections)
        .set({
          ownerVisible: input.published,
          ownerApproved: false,
          approvedBy: null,
          approvedAt: null,
        })
        .where(
          and(
            eq(projectFinishSelections.id, row.id),
            sql`EXISTS (SELECT 1 FROM ${decisions} WHERE ${decisions.selectionId} = ${row.id} AND ${decisions.lastMutationId} = ${token})`
          )
        ),
    ])
    if (result[0].meta.changes !== 1)
      throw new Error(
        "The selection changed while saving. Refresh and try again."
      )
    revalidate(projectId)
    return { success: true }
  } catch (error) {
    return failure(error)
  }
}

export async function approveSelectionDecision(
  projectId: string,
  selectionId: string,
  expectedRevision: number
): Promise<Result> {
  try {
    const { db, user, actorName } = await selectionAccess(
      projectId,
      "owner",
      true
    )
    const row = await db
      .select()
      .from(projectFinishSelections)
      .where(
        and(
          eq(projectFinishSelections.id, selectionId),
          eq(projectFinishSelections.projectId, projectId)
        )
      )
      .get()
    const decision = await db
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.selectionId, selectionId),
          eq(decisions.projectId, projectId)
        )
      )
      .get()
    if (!row || !decision || decision.revision !== expectedRevision)
      throw new Error(
        "This decision changed. Refresh and review the current revision."
      )
    const change = decision.changeOrderId
      ? await db
          .select({ status: projectChangeOrders.status })
          .from(projectChangeOrders)
          .where(
            and(
              eq(projectChangeOrders.id, decision.changeOrderId),
              eq(projectChangeOrders.projectId, projectId),
              eq(projectChangeOrders.audience, "owner")
            )
          )
          .get()
      : null
    const open = await db
      .select({ id: requests.id })
      .from(requests)
      .where(
        and(eq(requests.selectionId, selectionId), eq(requests.status, "open"))
      )
      .limit(1)
    const blocker = approvalBlocker({
      ...decision,
      current: decision.specificationJson === specificationJson(row),
      changeOrderStatus: change?.status ?? null,
      openRequests: open.length,
    })
    if (blocker) throw new Error(blocker)
    const now = new Date().toISOString(),
      token = crypto.randomUUID()
    const needsChange =
      decision.requiresChangeOrder ||
      decision.quotedCents !== decision.allowanceCents
    const mutation = db
      .update(decisions)
      .set({
        approvedBy: user.id,
        approvedByName: actorName,
        approvedAt: now,
        lastMutationId: token,
        updatedAt: now,
      })
      .where(
        and(
          eq(decisions.selectionId, selectionId),
          eq(decisions.projectId, projectId),
          eq(decisions.revision, expectedRevision),
          eq(decisions.published, true),
          isNull(decisions.approvedAt),
          sql`EXISTS (SELECT 1 FROM ${projectFinishSelections} WHERE ${projectFinishSelections.id} = ${selectionId} AND ${projectFinishSelections.updatedAt} = ${row.updatedAt})`,
          notExists(
            db
              .select({ id: requests.id })
              .from(requests)
              .where(
                and(
                  eq(requests.selectionId, selectionId),
                  eq(requests.status, "open")
                )
              )
          ),
          needsChange
            ? sql`EXISTS (SELECT 1 FROM ${projectChangeOrders} WHERE ${projectChangeOrders.id} = ${decision.changeOrderId} AND ${projectChangeOrders.projectId} = ${projectId} AND ${projectChangeOrders.audience} = 'owner' AND ${projectChangeOrders.status} IN ('executed','sage_pending','synced','closed'))`
            : undefined
        )
      )
    const result = await db.batch([
      mutation,
      db.insert(events).select(
        db
          .select({
            id: sql<string>`${token}`.as("id"),
            projectId: decisions.projectId,
            selectionId: decisions.selectionId,
            revision: decisions.revision,
            actorId: sql<string>`${user.id}`.as("actorId"),
            actorName: sql<string>`${actorName}`.as("actorName"),
            kind: sql<string>`'owner_approved'`.as("kind"),
            snapshotJson:
              sql<string>`${JSON.stringify({ ...decision, approvedBy: user.id, approvedByName: actorName, approvedAt: now })}`.as(
                "snapshotJson"
              ),
            createdAt: sql<string>`${now}`.as("createdAt"),
          })
          .from(decisions)
          .where(eq(decisions.lastMutationId, token))
      ),
      db
        .update(projectFinishSelections)
        .set({
          ownerApproved: true,
          approvedBy: user.id,
          approvedAt: now,
          // Signature collection must not rewind procurement or installation progress.
          status: sql`CASE WHEN ${projectFinishSelections.status} IN ('needed', 'proposed', 'owner_review') THEN 'approved' ELSE ${projectFinishSelections.status} END`,
          updatedAt: now,
        })
        .where(
          and(
            eq(projectFinishSelections.id, selectionId),
            sql`EXISTS (SELECT 1 FROM ${decisions} WHERE ${decisions.selectionId} = ${selectionId} AND ${decisions.lastMutationId} = ${token})`
          )
        ),
    ])
    if (result[0].meta.changes !== 1)
      throw new Error(
        "The selection or its approval conditions changed. Refresh before approving."
      )
    revalidate(projectId)
    return { success: true }
  } catch (error) {
    return failure(error)
  }
}

export async function linkSelectionPurchaseOrder(
  projectId: string,
  selectionId: string,
  operationId: string
): Promise<Result> {
  try {
    const { db, user, actorName } = await selectionAccess(
      projectId,
      "staff",
      true
    )
    const row = await db
      .select()
      .from(projectFinishSelections)
      .where(
        and(
          eq(projectFinishSelections.id, selectionId),
          eq(projectFinishSelections.projectId, projectId)
        )
      )
      .get()
    const operation = await db
      .select({ id: projectOperations.id })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.id, operationId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "purchase_order")
        )
      )
      .get()
    if (!row || !operation)
      throw new Error("Choose a purchase order from this project.")
    const token = crypto.randomUUID(),
      now = new Date().toISOString()
    const link = {
      id: token,
      projectId,
      selectionId,
      operationId,
      specificationJson: specificationJson(row),
      createdAt: now,
    }
    await db.batch([
      db.insert(links).values(link).onConflictDoNothing(),
      db.insert(events).select(
        db
          .select({
            id: sql<string>`${token}`.as("id"),
            projectId: links.projectId,
            selectionId: links.selectionId,
            revision: sql<number>`0`.as("revision"),
            actorId: sql<string>`${user.id}`.as("actorId"),
            actorName: sql<string>`${actorName}`.as("actorName"),
            kind: sql<string>`'procurement_linked'`.as("kind"),
            snapshotJson: sql<string>`${JSON.stringify(link)}`.as(
              "snapshotJson"
            ),
            createdAt: links.createdAt,
          })
          .from(links)
          .where(eq(links.id, token))
      ),
    ])
    revalidate(projectId)
    return { success: true }
  } catch (error) {
    return failure(error)
  }
}

export async function unlinkSelectionProcurement(
  projectId: string,
  selectionId: string,
  linkId: string
): Promise<Result> {
  try {
    const { db, user, actorName } = await selectionAccess(
      projectId,
      "staff",
      true
    )
    const link = await db
      .select()
      .from(links)
      .where(
        and(
          eq(links.id, linkId),
          eq(links.projectId, projectId),
          eq(links.selectionId, selectionId)
        )
      )
      .get()
    if (!link) throw new Error("Link not found")
    await db.batch([
      db.insert(events).values({
        id: crypto.randomUUID(),
        projectId,
        selectionId,
        revision: 0,
        actorId: user.id,
        actorName,
        kind: "procurement_unlinked",
        snapshotJson: JSON.stringify(link),
        createdAt: new Date().toISOString(),
      }),
      db.delete(links).where(eq(links.id, linkId)),
    ])
    revalidate(projectId)
    return { success: true }
  } catch (error) {
    return failure(error)
  }
}
