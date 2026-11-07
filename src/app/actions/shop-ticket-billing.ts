"use server"

import { revalidatePath } from "next/cache"

import { actionFailure, errorMessage, type ActionDone, type ActionResult } from "@/lib/action-result"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import {
  attachShopTicket,
  detachShopTicket,
  importShopTickets,
  linkShopTicketsByNumber,
  loadPayApplicationShopTicketState,
  setShopTicketAlreadyIncluded,
  type PayApplicationShopTicketState,
  type ShopTicketImportResult,
} from "@/lib/financials/pay-application-shop-tickets"
import { can, requirePermission } from "@/lib/permissions"
import { assertAudiencePreviewWriteAllowed, isAudiencePreviewRequest } from "@/lib/project-audience-request-server"
import { projectContext, type Db } from "@/lib/server/action-context"

const FEATURE = "shop-tickets"

export type PayApplicationShopTickets = PayApplicationShopTicketState & {
  /** Issued tickets' amounts by cost code; drafts and void tickets don't count. */
  readonly issuedTotalCents: number
}

/**
 * Shop tickets billed on a pay application, for its page. Opening a draft
 * links issued tickets that name its pay application number. Null when the
 * person can't see shop tickets.
 */
export async function getPayApplicationShopTickets(projectId: string, applicationId: string): Promise<PayApplicationShopTickets | null> {
  const context = await projectContext(projectId, { scope: "organization", feature: FEATURE, action: "read" })
  if (!context.success) return null
  const { db, user, organizationId } = context.data
  const mayEdit =
    can(user, "project", "update") &&
    !isDemoUser(user.id) &&
    !(organizationId !== null && isDemoOrg(organizationId)) &&
    !(await isAudiencePreviewRequest())
  if (mayEdit) await linkShopTicketsByNumber(db, projectId, applicationId)
  const state = await loadPayApplicationShopTicketState(db, projectId, applicationId)
  return {
    ...state,
    editable: state.editable && mayEdit,
    issuedTotalCents: state.tickets.filter((ticket) => ticket.status === "issued").reduce((sum, ticket) => sum + ticket.totalCents, 0),
  }
}

/** Same access as editing the pay application, and the person can see shop tickets. */
async function editAccess(projectId: string): Promise<{ readonly db: Db; readonly userId: string }> {
  await assertAudiencePreviewWriteAllowed()
  const context = await projectContext(projectId, { scope: "organization", mutation: true, feature: FEATURE, action: "read" })
  if (!context.success) throw new Error(context.error)
  requirePermission(context.data.user, "project", "update")
  return { db: context.data.db, userId: context.data.user.id }
}

function revalidate(projectId: string, applicationId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/financials/pay-applications/${applicationId}`)
  revalidatePath(`/dashboard/projects/${projectId}/shop-tickets`)
}

/** Adds linked, issued tickets' amounts on top of the draft's G703 lines. */
export async function importPayApplicationShopTickets(projectId: string, applicationId: string): Promise<ActionResult<ShopTicketImportResult>> {
  try {
    const { db, userId } = await editAccess(projectId)
    const result = await importShopTickets(db, { projectId, applicationId, userId, now: new Date().toISOString() })
    revalidate(projectId, applicationId)
    return { success: true, data: result }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to import shop tickets."))
  }
}

/** Links an issued ticket that isn't on any pay application to this draft. */
export async function attachPayApplicationShopTicket(projectId: string, applicationId: string, ticketId: string): Promise<ActionDone> {
  try {
    const { db } = await editAccess(projectId)
    await attachShopTicket(db, projectId, applicationId, ticketId)
    revalidate(projectId, applicationId)
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to attach the shop ticket."))
  }
}

/** Unlinks a ticket from this draft and takes off whatever it added. */
export async function detachPayApplicationShopTicket(projectId: string, applicationId: string, ticketId: string): Promise<ActionDone> {
  try {
    const { db } = await editAccess(projectId)
    await detachShopTicket(db, { projectId, applicationId, ticketId, now: new Date().toISOString() })
    revalidate(projectId, applicationId)
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to unlink the shop ticket."))
  }
}

/** Marks (or unmarks) a linked ticket as already included on this pay request by hand. */
export async function setPayApplicationShopTicketAlreadyIncluded(
  projectId: string,
  applicationId: string,
  ticketId: string,
  included: boolean
): Promise<ActionDone> {
  try {
    const { db, userId } = await editAccess(projectId)
    await setShopTicketAlreadyIncluded(db, { projectId, applicationId, ticketId, included, userId, now: new Date().toISOString() })
    revalidate(projectId, applicationId)
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to update the shop ticket."))
  }
}
