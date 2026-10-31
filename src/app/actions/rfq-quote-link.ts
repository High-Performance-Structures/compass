"use server"

import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projectOperations } from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import { updateOperations, updateRfqQuoteLinkById } from "@/lib/domain/operations/store"
import { getCloudflareContext } from "@/lib/db"
import { notifyRfqResponseReceivedByLink } from "@/lib/notifications/events"
import { parsePortalRfqPayload, withPortalRfqVendorResponse } from "@/lib/rfqs/portal-response"
import { resolveQuoteLink } from "@/lib/rfqs/quote-link-server"
import { checkRfqVendorAnswer, type RfqVendorAnswerInput } from "@/lib/rfqs/vendor-response"

export type SubmitQuoteByLinkInput = RfqVendorAnswerInput & {
  readonly responderName: string
  readonly responderCompany: string | null
}

type Result = { readonly success: true } | { readonly success: false; readonly error: string }

const UNAVAILABLE = "This price link is no longer available. Reply to the RFQ email instead."

/**
 * A vendor's quote or decline from the no-login price link. The token is the
 * only credential: it's checked again here, the RFQ must still be open, and
 * the answer goes through the same checks as the vendor portal.
 */
export async function submitRfqQuoteByLink(token: string, input: SubmitQuoteByLinkInput): Promise<Result> {
  try {
    const { env } = await getCloudflareContext()
    const context = await resolveQuoteLink(env, token, new Date())
    if (!context) return { success: false, error: UNAVAILABLE }
    if (!context.accepting) return { success: false, error: "This RFQ isn't taking prices anymore." }
    if (!context.project.organizationId) return { success: false, error: UNAVAILABLE }
    const responderName = input.responderName.trim()
    if (!responderName || responderName.length > 120) return { success: false, error: "Enter your name." }
    const responderCompany = input.responderCompany?.trim().slice(0, 160) || context.rfq.companyName
    if (!Array.isArray(input.lines) || input.lines.length > 200) return { success: false, error: "Enter a price for each scope line." }

    const payload = parsePortalRfqPayload(context.rfq.sagePayloadJson)
    const answer = checkRfqVendorAnswer(payload, input)
    if (!answer.ok) return { success: false, error: answer.error }

    const { db, rfq, link } = context
    const now = new Date().toISOString()
    const status = input.decision === "decline" ? "declined" : "response_received"
    // Only write while the RFQ is still open and unchanged since we read it.
    await updateOperations(
      db,
      and(
        eq(projectOperations.id, rfq.id),
        eq(projectOperations.updatedAt, rfq.updatedAt),
        inArray(projectOperations.status, ["sent", "response_received"]),
      ),
      {
        status,
        amount: answer.amount,
        sagePayloadJson: withPortalRfqVendorResponse(rfq.sagePayloadJson, {
          ...answer.response,
          // Not a Compass user: record which link answered.
          responderUserId: `quote-link:${link.id}`,
          responderName: `${responderName} (${link.recipientEmail})`,
          responderCompany: responderCompany ?? null,
          submittedAt: now,
        }),
        updatedAt: now,
      },
    )
    const [saved] = await db.select({ status: projectOperations.status, updatedAt: projectOperations.updatedAt }).from(projectOperations).where(eq(projectOperations.id, rfq.id)).limit(1)
    if (saved?.updatedAt !== now) return { success: false, error: "This RFQ just changed. Reload the page and try again." }
    await updateRfqQuoteLinkById(db, link.id, { submittedAt: now })

    const who = responderCompany ? `${responderName} at ${responderCompany}` : responderName
    await recordActivityEvent({
      db,
      organizationId: context.project.organizationId,
      projectId: link.projectId,
      actor: { id: null, email: link.recipientEmail, displayName: who, firstName: null, lastName: null, role: "vendor" },
      category: "email",
      action: input.decision === "quote" ? "rfq_quote_received" : "rfq_declined",
      entityType: "project_operation",
      entityId: rfq.id,
      summary:
        input.decision === "quote"
          ? `${who} submitted a quote on ${rfq.sourceRecordNumber ?? "an RFQ"} through the price link.`
          : `${who} declined ${rfq.sourceRecordNumber ?? "an RFQ"} through the price link.`,
      metadata: { linkId: link.id, recipientEmail: link.recipientEmail },
    })
    try {
      await notifyRfqResponseReceivedByLink({
        organizationId: context.project.organizationId,
        projectId: link.projectId,
        rfqId: rfq.id,
        rfqNumber: rfq.sourceRecordNumber,
        title: rfq.title,
        decision: input.decision,
        amount: answer.amount,
        responderLabel: who,
      })
    } catch (notificationError) {
      console.error("[rfq-quote-link] notification error", notificationError)
    }
    revalidatePath(`/dashboard/projects/${link.projectId}/rfqs`)
    revalidatePath(`/dashboard/projects/${link.projectId}/estimate`)
    return { success: true }
  } catch (error) {
    console.error("[rfq-quote-link] submit failed", error)
    return { success: false, error: "Your prices didn't save. Try again, or reply to the RFQ email." }
  }
}
