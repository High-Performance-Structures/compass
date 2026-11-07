"use server"

import { desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projects } from "@/db/schema"
import { sagePayApplicationSyncRuns } from "@/db/schema-sage"
import { actionFailure, errorMessage, type ActionDone, type ActionResult } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import type { PayRequestOrigin } from "@/lib/feature-settings/contract-settings"
import { loadPayRequestSageState, type PayRequestSageState } from "@/lib/financials/sage-pay-request-state"
import { applySageAmounts, latestSageSnapshot, payRequestOrigin, syncPayRequestFromSageSnapshot } from "@/lib/financials/sage-pay-request-sync"
import { setShopTicketEnteredInSage } from "@/lib/financials/sage-pay-request-tickets"
import { assertAudiencePreviewWriteAllowed } from "@/lib/project-audience-request-server"
import { queueSagePayApplicationRead, sageBridgeConfigured, sageBridgeOnline } from "@/lib/sage/pay-application-read-queue"
import { projectContext, type ProjectContext } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * Pay requests built in Sage: "Sync with Sage" from the pay request area,
 * the comparison and "Use Sage amounts" for a pay application built in
 * Compass, and the shop ticket checklist. Any office staff with financial
 * access may use them; each is recorded in Activity with who did it.
 */

const FEATURE = "financials"

/** Office staff with financial access to the project (read or update). */
async function staffContext(projectId: string, mutation: boolean): Promise<ProjectContext & { readonly organizationId: string }> {
  if (mutation) await assertAudiencePreviewWriteAllowed()
  const context = await projectContext(projectId, { scope: "organization", feature: FEATURE, action: mutation ? "update" : "read", mutation })
  if (!context.success) throw new Error(context.error)
  const { organizationId } = context.data
  if (!isInternalStaffRole(context.data.user.role) || organizationId === null) throw new Error("Project not found")
  return { ...context.data, organizationId }
}

function revalidate(projectId: string, applicationId: string | null): void {
  revalidatePath(`/dashboard/projects/${projectId}/financials`)
  if (applicationId) revalidatePath(`/dashboard/projects/${projectId}/financials/pay-applications/${applicationId}`)
  revalidatePath(`/dashboard/projects/${projectId}/budget`)
  revalidatePath(`/dashboard/projects/${projectId}/shop-tickets`)
}

type SageReadRun = {
  readonly status: string
  readonly requestedAt: string
  readonly completedAt: string | null
  readonly errorMessage: string | null
}

export type SagePayRequestPanel = {
  readonly origin: PayRequestOrigin
  /** Server flag: this person may sync (bridge set up, project mapped to a Sage job). */
  readonly canSync: boolean
  /** Why syncing isn't possible right now; null when it is. */
  readonly unavailableReason: string | null
  readonly latestRun: SageReadRun | null
}

async function latestRun(context: ProjectContext, projectId: string): Promise<SageReadRun | null> {
  const run = await context.db
    .select({
      status: sagePayApplicationSyncRuns.status,
      requestedAt: sagePayApplicationSyncRuns.requestedAt,
      completedAt: sagePayApplicationSyncRuns.completedAt,
      errorMessage: sagePayApplicationSyncRuns.errorMessage,
    })
    .from(sagePayApplicationSyncRuns)
    .where(eq(sagePayApplicationSyncRuns.projectId, projectId))
    .orderBy(desc(sagePayApplicationSyncRuns.requestedAt))
    .limit(1)
    .get()
  return run ?? null
}

/** The "Sync with Sage" panel for the pay request area; null for people without financial access. */
export async function getSagePayRequestPanel(projectId: string): Promise<SagePayRequestPanel | null> {
  try {
    const context = await staffContext(projectId, false)
    const [origin, run, project, online] = await Promise.all([
      payRequestOrigin(context.db, context.organizationId),
      latestRun(context, projectId),
      context.db.select({ sageJobId: projects.sageJobId, sageJobNumber: projects.sageJobNumber }).from(projects).where(eq(projects.id, projectId)).get(),
      sageBridgeOnline(context.env),
    ])
    const unavailableReason = !sageBridgeConfigured(context.env)
      ? "The read-only Sage bridge is not configured."
      : !project?.sageJobId && !project?.sageJobNumber
        ? "Link this project to its Sage job on the Information page before syncing."
        : !online
          ? "The Sage connection is offline right now. Try again in a few minutes."
          : null
    return { origin, canSync: unavailableReason === null, unavailableReason, latestRun: run }
  } catch {
    return null
  }
}

/** The latest Sage read's status, for the panel to follow until it finishes. */
export async function getSagePayRequestSyncStatus(projectId: string): Promise<ActionResult<SageReadRun | null>> {
  try {
    const context = await staffContext(projectId, false)
    return { success: true, data: await latestRun(context, projectId) }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to read the Sage sync status."))
  }
}

/**
 * Sync with Sage: asks the Sage bridge to read the job's latest progress
 * billing (it lands within a minute or two), and brings in the latest read
 * Compass already holds right away.
 */
export async function requestSagePayRequestSync(
  projectId: string
): Promise<ActionResult<{ readonly applicationId: string | null; readonly note: string | null }>> {
  try {
    const context = await staffContext(projectId, true)
    const { db, user, organizationId } = context
    if ((await payRequestOrigin(db, organizationId)) !== "sage") {
      throw new Error("Pay requests are created in Compass. Change this in Settings › Workflows › Sage export.")
    }
    const queued = await queueSagePayApplicationRead(context.env, { organizationId, projectId, userId: user.id })
    if (!queued.success) throw new Error(queued.error)
    const held = await latestSageSnapshot(db, projectId)
    const outcome = held
      ? await syncPayRequestFromSageSnapshot(db, { organizationId, projectId, snapshotId: held.id, actor: user, now: new Date().toISOString() })
      : null
    const applicationId = outcome && outcome.kind !== "skipped" ? outcome.applicationId : null
    revalidate(projectId, applicationId)
    return { success: true, data: { applicationId, note: outcome?.kind === "skipped" ? outcome.reason : null } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to sync with Sage."))
  }
}

/** What the pay application page shows about Sage; null for people without financial access. */
export async function getPayRequestSageState(projectId: string, applicationId: string): Promise<PayRequestSageState | null> {
  try {
    const context = await staffContext(projectId, false)
    return await loadPayRequestSageState(context.db, { organizationId: context.organizationId, projectId, applicationId })
  } catch {
    return null
  }
}

/** "Use Sage amounts": replaces a linked pay application's amounts with Sage's, kept as a new revision. */
export async function applySageAmountsToPayRequest(projectId: string, applicationId: string): Promise<ActionDone> {
  try {
    const { db, user, organizationId } = await staffContext(projectId, true)
    await applySageAmounts(db, { organizationId, projectId, applicationId, actor: user, now: new Date().toISOString() })
    revalidate(projectId, applicationId)
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to use Sage's amounts."))
  }
}

/** Ticks (or unticks) a shop ticket as entered in Sage on this pay application. */
export async function setPayRequestShopTicketEnteredInSage(
  projectId: string,
  applicationId: string,
  ticketId: string,
  entered: boolean
): Promise<ActionDone> {
  try {
    const { db, user, organizationId } = await staffContext(projectId, true)
    const { ticketNumber } = await setShopTicketEnteredInSage(db, { projectId, applicationId, ticketId, entered, userId: user.id, now: new Date().toISOString() })
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "financial",
      action: entered ? "shop_ticket_entered_in_sage" : "shop_ticket_entered_in_sage_undone",
      entityType: "shop_ticket",
      entityId: ticketId,
      summary: entered
        ? `Ticked shop ticket ${ticketNumber} as entered in Sage on this pay request.`
        : `Unticked shop ticket ${ticketNumber}; it is waiting to be entered in Sage again.`,
      metadata: { applicationId },
    })
    revalidate(projectId, applicationId)
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to update the shop ticket."))
  }
}
