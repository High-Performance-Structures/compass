"use server"

import { and, eq, exists, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"
import {
  projectSelectionDecisions as decisions,
  projectSelectionRequests as requests,
  projectSelectionDecisionEvents as events,
} from "@/db/schema-selection-decisions"
import { selectionAccess } from "@/lib/selections/access"
import { safeSelectionUrl } from "@/lib/selections/decisions"

type Result =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
const schema = z.object({
  selectionId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  requestId: z.string().nullable(),
  expectedUpdatedAt: z.string().nullable(),
  kind: z.enum(["pricing", "alternative"]),
  note: z
    .string()
    .trim()
    .min(1, "Describe what you would like priced or changed.")
    .max(4000),
  productUrl: z.string().max(2000),
})
export type SelectionRequestInput = z.infer<typeof schema>
function refresh(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/selections`)
  revalidatePath(`/preview/projects/${projectId}/owner`)
  revalidatePath(`/preview/projects/${projectId}/owner/selections`)
}
function failure(error: unknown): Result {
  return {
    success: false,
    error: error instanceof Error ? error.message : "Unable to save request.",
  }
}

export async function saveSelectionRequest(
  projectId: string,
  raw: SelectionRequestInput
): Promise<Result> {
  try {
    const input = schema.parse(raw)
    const { db, user, actorName } = await selectionAccess(
      projectId,
      "owner",
      true
    )
    const id = input.requestId ?? crypto.randomUUID(),
      now = new Date().toISOString()
    const token = crypto.randomUUID()
    const values = {
      lastMutationId: token,
      kind: input.kind,
      note: input.note,
      productUrl: safeSelectionUrl(input.productUrl),
      updatedAt: now,
    }
    const decisionGuard = and(
      eq(decisions.projectId, projectId),
      eq(decisions.selectionId, input.selectionId),
      eq(decisions.published, true),
      eq(decisions.revision, input.revision)
    )
    const mutation = input.requestId
      ? db
          .update(requests)
          .set(values)
          .where(
            and(
              eq(requests.id, id),
              eq(requests.projectId, projectId),
              eq(requests.selectionId, input.selectionId),
              eq(requests.requesterId, user.id),
              eq(requests.status, "open"),
              eq(requests.updatedAt, input.expectedUpdatedAt ?? ""),
              exists(
                db
                  .select({ id: decisions.selectionId })
                  .from(decisions)
                  .where(decisionGuard)
              )
            )
          )
      : db.insert(requests).select(
          db
            .select({
              id: sql<string>`${id}`.as("id"),
              projectId: decisions.projectId,
              selectionId: decisions.selectionId,
              requesterId: sql<string>`${user.id}`.as("requesterId"),
              requesterName: sql<string>`${actorName}`.as("requesterName"),
              kind: sql<"pricing" | "alternative">`${input.kind}`.as("kind"),
              note: sql<string>`${values.note}`.as("note"),
              productUrl: sql<string | null>`${values.productUrl}`.as(
                "productUrl"
              ),
              status: sql<"open">`'open'`.as("status"),
              response: sql<null>`NULL`.as("response"),
              lastMutationId: sql<string>`${token}`.as("lastMutationId"),
              createdAt: sql<string>`${now}`.as("createdAt"),
              updatedAt: sql<string>`${now}`.as("updatedAt"),
            })
            .from(decisions)
            .where(decisionGuard)
        )
    const result = await db.batch([
      mutation,
      db.insert(events).select(
        db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as("id"),
            projectId: requests.projectId,
            selectionId: requests.selectionId,
            revision: sql<number>`${input.revision}`.as("revision"),
            actorId: sql<string>`${user.id}`.as("actorId"),
            actorName: sql<string>`${actorName}`.as("actorName"),
            kind: sql<string>`${input.requestId ? "request_edited" : "request_created"}`.as(
              "kind"
            ),
            snapshotJson:
              sql<string>`${JSON.stringify({ requestId: id, ...values })}`.as(
                "snapshotJson"
              ),
            createdAt: sql<string>`${now}`.as("createdAt"),
          })
          .from(requests)
          .where(
            and(
              eq(requests.id, id),
              eq(requests.lastMutationId, token),
              eq(requests.requesterId, user.id)
            )
          )
      ),
    ])
    if (result[0].meta.changes !== 1)
      throw new Error("The decision or request changed. Refresh before saving.")
    refresh(projectId)
    return { success: true }
  } catch (error) {
    return failure(error)
  }
}

export async function closeSelectionRequest(
  projectId: string,
  requestId: string,
  expectedUpdatedAt: string,
  mode: "withdraw" | "resolve",
  response: string
): Promise<Result> {
  try {
    if (mode !== "withdraw" && mode !== "resolve")
      throw new Error("Invalid request action")
    const { db, user, actorName } = await selectionAccess(
      projectId,
      mode === "resolve" ? "staff" : "owner",
      true
    )
    if (mode === "resolve" && (!response.trim() || response.length > 4000))
      throw new Error(
        "Explain how the pricing or alternative request was addressed."
      )
    const row = await db
      .select()
      .from(requests)
      .where(and(eq(requests.id, requestId), eq(requests.projectId, projectId)))
      .get()
    if (!row) throw new Error("Request not found")
    if (mode === "withdraw" && row.requesterId !== user.id)
      throw new Error("You can only withdraw your own requests.")
    const now = new Date().toISOString()
    const token = crypto.randomUUID()
    const result = await db.batch([
      db
        .update(requests)
        .set({
          lastMutationId: token,
          status: mode === "withdraw" ? "withdrawn" : "resolved",
          response: mode === "resolve" ? response.trim() : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(requests.id, requestId),
            eq(requests.projectId, projectId),
            eq(requests.status, "open"),
            eq(requests.updatedAt, expectedUpdatedAt)
          )
        ),
      db.insert(events).select(
        db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as("id"),
            projectId: requests.projectId,
            selectionId: requests.selectionId,
            revision: sql<number>`0`.as("revision"),
            actorId: sql<string>`${user.id}`.as("actorId"),
            actorName: sql<string>`${actorName}`.as("actorName"),
            kind: sql<string>`${mode === "resolve" ? "request_resolved" : "request_withdrawn"}`.as(
              "kind"
            ),
            snapshotJson:
              sql<string>`${JSON.stringify({ before: row, response: mode === "resolve" ? response.trim() : null })}`.as(
                "snapshotJson"
              ),
            createdAt: sql<string>`${now}`.as("createdAt"),
          })
          .from(requests)
          .where(
            and(eq(requests.id, requestId), eq(requests.lastMutationId, token))
          )
      ),
    ])
    if (result[0].meta.changes !== 1)
      throw new Error(
        "This request has already changed. Refresh and try again."
      )
    refresh(projectId)
    return { success: true }
  } catch (error) {
    return failure(error)
  }
}
