import "server-only"

import { eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectChangeOrders, projects } from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import { esignAnnouncementText, type EsignDocumentKind, type EsignOutcome } from "@/lib/esign/announce-text"
import { notifyProjectStaffOfOutsideEvent } from "@/lib/notifications/events"

type Db = ReturnType<typeof getDb>

/**
 * Tells staff that a client signed, declined or cancelled an e-signature
 * request, and records it in the Activity log. Called by the e-signature
 * webhook only when the status actually changes, so retries stay quiet. The
 * signature itself is already saved; failures here are only logged.
 */
export async function announceEsignOutcome(input: {
  readonly db: Db
  readonly projectId: string
  readonly kind: EsignDocumentKind
  readonly outcome: EsignOutcome
  readonly recordId: string
  readonly number: string
  readonly title: string
  readonly changeOrderId: string | null
  /** Whoever prepared and sent the request. */
  readonly sentBy: string | null
}): Promise<void> {
  try {
    const project = await input.db
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .get()
    const organizationId = project?.organizationId
    if (!organizationId) return
    const changeOrder = input.changeOrderId
      ? await input.db
          .select({ id: projectChangeOrders.id, number: projectChangeOrders.changeOrderNumber })
          .from(projectChangeOrders)
          .where(eq(projectChangeOrders.id, input.changeOrderId))
          .get()
      : undefined
    const text = esignAnnouncementText({
      kind: changeOrder ? "change_order" : input.kind,
      outcome: input.outcome,
      projectId: input.projectId,
      recordId: input.recordId,
      number: changeOrder?.number ?? input.number,
      title: input.title,
      changeOrderId: changeOrder?.id ?? null,
    })

    await recordActivityEvent({
      db: input.db,
      organizationId,
      projectId: input.projectId,
      actor: {
        id: null,
        email: "esign",
        displayName: "E-signature",
        firstName: null,
        lastName: null,
        role: "system",
      },
      category: "financial",
      action: text.action,
      entityType: input.kind === "contract" ? "contract_packet" : "project_estimate",
      entityId: input.recordId,
      summary: text.summary,
    })
    await notifyProjectStaffOfOutsideEvent({
      organizationId,
      projectId: input.projectId,
      eventType: text.eventType,
      sourceType: input.kind === "contract" ? "contract_packet" : "estimate",
      sourceId: input.recordId,
      title: text.title,
      body: text.summary,
      href: text.href,
      priority: input.outcome === "signed" ? "normal" : "high",
      ownerUserId: input.sentBy,
    })
  } catch (error) {
    console.error("[esign] announcement failed", error)
  }
}
