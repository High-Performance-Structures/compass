"use server"

import { and, eq } from "drizzle-orm"
import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { invoices } from "@/db/schema-netsuite"
import { googleAuth } from "@/db/schema-google"
import { actionFailure, errorMessage, type ActionResult } from "@/lib/action-result"
import { activityActorName, recordActivityEvent } from "@/lib/activity-log"
import { simpleInvoiceContext } from "@/lib/domain/financials/access"
import {
  claimSimpleInvoiceEmail,
  clearSimpleInvoiceEmailUnconfirmed,
  completeSimpleInvoiceEmail,
  emailDefinitelyNotSent,
  releaseSimpleInvoiceEmail,
  renewSimpleInvoiceEmail,
  type InvoiceEmailRefusal,
} from "@/lib/domain/financials/invoice-guards"
import { invoiceEmailBlockMessage } from "@/lib/domain/financials/invoice-email-fence"
import { squareEligibility } from "@/lib/domain/financials/simple-invoice-rules"
import {
  cancelSquareInvoiceLink,
  failSquareInvoiceLink,
  publishSquareInvoiceLink,
  simpleInvoiceUpdateStatement,
  startSquareInvoiceLink,
} from "@/lib/domain/financials/store"
import { COMPASS_GMAIL_SEND_SCOPE, getCompassGmailAccessToken } from "@/lib/email/compass-email"
import { isValidRecipientEmail, normalizeRecipientEmail } from "@/lib/email/recipient-options"
import { sendTrackedEmail } from "@/lib/email/tracked-send"
import { createNotificationEvent } from "@/lib/notifications/create-event"
import { projectInternalRecipients } from "@/lib/notifications/events"
import { loadSimpleInvoiceExport } from "@/lib/financials/simple-invoice-sage"
import { loadSimpleInvoice, loadSimpleInvoiceProject, readSimpleInvoiceSettings } from "@/lib/financials/simple-invoices-server"
import { formatCents, formatDate } from "@/lib/format"
import { PRINT_READY_SELECTOR, printSourcePath } from "@/lib/print/print-documents"
import { renderPrintPagePdf } from "@/lib/print/render-pdf"
import { cancelSquareInvoice, createAndPublishSquareInvoice, squareInvoiceAccessToken } from "@/lib/sage/square-invoice-create"
import { orgContext, type Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * Emails a final simple invoice with its PDF (the invoice's Print Preview),
 * from the company's invoice mailbox (Settings › Workflows › Simple
 * invoices), through sendTrackedEmail so replies come back to the invoice.
 *
 * With "Create Square invoice" checked, Compass first creates and publishes
 * the invoice in Square (Square sends nothing), then sends this email with
 * Square's payment link in the same step. The Square invoice is tied to the
 * invoice's Sage AR record, so the invoice must be in Sage first: that is how
 * the existing Square webhook posts the processing fee to Sage.
 */

const MAX_CC = 5
const EMAIL_UNCONFIRMED_PREFIX = "Compass couldn't confirm the email went out"
const EMAIL_UNCONFIRMED = "An email of this invoice may have gone out (Compass couldn't confirm it). Check the sent mail, then choose \"It didn't go out\" on the invoice before sending it again."
/** Why the send claim was refused, in staff words. */
function claimRefusedMessage(reason: InvoiceEmailRefusal): string {
  if (reason.kind === "draft") return "Finalize the invoice before emailing it."
  if (reason.kind === "void") return "This invoice is void."
  if (reason.kind === "missing") return "Invoice not found."
  if (reason.kind === "unconfirmed") return EMAIL_UNCONFIRMED
  return invoiceEmailBlockMessage(reason)
}

type InvoiceSender = { readonly address: string; readonly name: string | null }

/** Plain-language reason Google refused to let Compass send as a mailbox. */
function mailboxProblem(message: string, address: string): string {
  if (/Invalid email or User ID/i.test(message)) return `Google doesn't know ${address} as a mailbox in your Workspace. Use a user mailbox (not an alias or group).`
  if (/unauthorized_client/i.test(message)) return "Compass's Google connection isn't allowed to send email (Gmail send scope missing from domain-wide delegation)."
  return `Google refused to send as ${address}: ${message}`
}

/** The invoice mailbox when set, checked: in the company's Workspace domain and Compass may send as it. */
async function invoiceSender(db: Db, env: unknown, organizationId: string): Promise<{ readonly success: true; readonly sender: InvoiceSender | null } | { readonly success: false; readonly error: string }> {
  const settings = await readSimpleInvoiceSettings(db, organizationId)
  const address = normalizeRecipientEmail(settings.senderAddress)
  if (!address) return { success: true, sender: null }
  const workspace = await db.select({ domain: googleAuth.workspaceDomain }).from(googleAuth).where(eq(googleAuth.organizationId, organizationId)).get()
  const domain = workspace?.domain.trim().toLowerCase()
  if (!domain || address.split("@")[1] !== domain) {
    return { success: false, error: `The invoice mailbox ${address} isn't in the company's Google Workspace${domain ? ` (${domain})` : ""}. Change it in Settings › Workflows › Simple invoices.` }
  }
  try {
    const access = await getCompassGmailAccessToken({ env, db, organizationId, scopes: [COMPASS_GMAIL_SEND_SCOPE], sender: address })
    if (!access.success) return { success: false, error: mailboxProblem(access.error, address) }
  } catch (error) {
    return { success: false, error: mailboxProblem(errorMessage(error, "unknown error"), address) }
  }
  return { success: true, sender: { address, name: settings.senderName.trim() || null } }
}

/** Settings check: Compass may send as the saved invoice mailbox. Nothing is sent. */
export async function checkInvoiceSenderMailbox(): Promise<ActionResult<{ readonly address: string }>> {
  const context = await orgContext()
  if (!context.success) return context
  const { db, env, user, organizationId } = context.data
  if (!isInternalStaffRole(user.role)) return actionFailure("Available to office staff.")
  const checked = await invoiceSender(db, env, organizationId)
  if (!checked.success) return checked
  if (!checked.sender) return actionFailure("Enter and save the invoice mailbox first.")
  return { success: true, data: { address: checked.sender.address } }
}

export type EmailProjectInvoiceInput = {
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly subject: string
  readonly message: string
}

function invoiceText(input: {
  readonly message: string
  readonly invoiceNumber: string
  readonly projectName: string
  readonly totalCents: number
  readonly dueDate: string | null
  readonly squareUrl: string | null
  readonly creditMemo: boolean
}): string {
  return [
    input.message.trim(),
    "",
    input.creditMemo
      ? `Credit memo ${input.invoiceNumber} for ${input.projectName}: ${formatCents(input.totalCents)} credited. The credit memo is attached.`
      : `Invoice ${input.invoiceNumber} for ${input.projectName}: ${formatCents(input.totalCents)}${input.dueDate ? `, due ${formatDate(input.dueDate)}` : ""}. The invoice is attached.`,
    ...(input.squareUrl ? ["", `Pay online (card or bank transfer): ${input.squareUrl}`] : []),
  ].join("\n")
}

/** The invoice PDF from its Print Preview page, rendered with the sender's session. */
async function invoicePdf(projectId: string, invoiceId: string): Promise<{ readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly error: string }> {
  const cookieHeader = (await cookies())
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ")
  const rendered = await renderPrintPagePdf({
    request: new Request("https://compass.invalid/", { headers: { Cookie: cookieHeader } }),
    path: printSourcePath(projectId, "invoice"),
    searchParams: { invoiceId },
    waitForSelector: PRINT_READY_SELECTOR,
  })
  if (!rendered.ok) return { ok: false, error: `The invoice PDF couldn't be made (${rendered.error}).` }
  return { ok: true, bytes: new Uint8Array(await rendered.bytes()) }
}

/**
 * Emails the invoice. With Square requested, creates and publishes the
 * Square invoice first and puts its payment link in the email.
 */
export async function emailProjectInvoice(projectId: string, invoiceId: string, input: EmailProjectInvoiceInput): Promise<ActionResult<{ readonly squareUrl: string | null }>> {
  try {
    const context = await simpleInvoiceContext(projectId, "update")
    if (!context.success) return context
    const { db, env, user, organizationId } = context.data
    const to = [...new Set(input.to.map(normalizeRecipientEmail))]
    const cc = [...new Set(input.cc.map(normalizeRecipientEmail))].filter((email) => !to.includes(email))
    if (to.length === 0 || to.length > 5 || to.some((email) => !isValidRecipientEmail(email))) return actionFailure("Choose who the invoice goes to.")
    if (cc.length > MAX_CC || cc.some((email) => !isValidRecipientEmail(email))) return actionFailure(`Enter up to ${MAX_CC} valid Cc addresses.`)
    const subject = input.subject.trim()
    if (!subject || subject.length > 300 || input.message.length > 10_000) return actionFailure("Enter a subject and a short message.")
    const [invoice, project, settings] = await Promise.all([
      loadSimpleInvoice(db, organizationId, projectId, invoiceId),
      loadSimpleInvoiceProject(db, organizationId, projectId),
      readSimpleInvoiceSettings(db, organizationId),
    ])
    if (!invoice || !project) return actionFailure("Invoice not found.")
    if (invoice.status === "draft") return actionFailure("Finalize the invoice before emailing it.")
    if (invoice.status === "void") return actionFailure("This invoice is void.")
    if (!invoice.invoiceNumber) return actionFailure("The invoice has no number yet.")
    const sender = await invoiceSender(db, env, organizationId)
    if (!sender.success) return sender

    /** The read-only checks before creating a Square invoice. */
    async function squareReadiness(): Promise<{ readonly ok: true; readonly token: string; readonly exported: { readonly sageRecordId: string }; readonly projectNumber: string; readonly customerName: string; readonly firstTo: string } | { readonly ok: false; readonly error: string }> {
      if (!invoice || !project) return { ok: false, error: "Invoice not found." }
      const eligibility = squareEligibility({ isDeposit: invoice.isDeposit, department: project.department, blockedDepositDepartments: settings.squareBlockedDepositDepartments })
      if (!eligibility.allowed) return { ok: false, error: eligibility.reason }
      const token = squareInvoiceAccessToken(env)
      if (!token) return { ok: false, error: "Square not connected for invoices: Compass has no Square access token. Uncheck Create Square invoice, or connect Square." }
      const exported = await loadSimpleInvoiceExport(db, organizationId, invoiceId)
      if (!exported || exported.status !== "succeeded" || !exported.sageRecordId) {
        return { ok: false, error: "Send the invoice to Sage first and wait until it shows In Sage: the Square invoice is tied to Sage's invoice so its card fee posts to Sage." }
      }
      if (!project.projectNumber) return { ok: false, error: "The project has no number for Square." }
      if (!invoice.customerName) return { ok: false, error: "Choose who the invoice is billed to." }
      const firstTo = to[0]
      if (!firstTo) return { ok: false, error: "Choose who the invoice goes to." }
      return { ok: true, token, exported: { sageRecordId: exported.sageRecordId }, projectNumber: project.projectNumber, customerName: invoice.customerName, firstTo }
    }

    // Read-only Square checks first, so a refusal never takes the send claim.
    let squareUrl = invoice.squarePublicUrl
    const squareJob = invoice.squareRequested && !squareUrl ? await squareReadiness() : null
    if (squareJob && !squareJob.ok) return actionFailure(squareJob.error)

    // Claim the send before anything is made or sent: of a double click or two
    // staff sending at once, exactly one request goes on. The hand-off marks
    // the invoice "may have gone out"; only a definite failure clears that mark
    // (finally below), and delivery replaces it with emailed_at.
    const claimKey = { invoiceId, organizationId, projectId }
    const claimed = await claimSimpleInvoiceEmail(db, { ...claimKey, actorId: user.id, now: new Date().toISOString(), windowMs: settings.emailResendWindowMinutes * 60_000 })
    if (!claimed.ok) return actionFailure(claimRefusedMessage(claimed.reason))
    let claim = claimed.claim
    // not_started / not_sent free the claim and this send's mark; unknown frees the claim but keeps the mark.
    let outcome: "not_started" | "not_sent" | "unknown" | "sent" = "not_started"
    const fence = and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId))
    const from = sender.sender
    try {
      // Square first: the email waits for Square's payment link.
      if (squareJob?.ok) {
        const { token, exported, projectNumber, customerName, firstTo } = squareJob
        // Only one request creates the Square invoice: a double click or a second
        // person sending at the same moment would otherwise make two payment links.
        const key = { invoiceId, organizationId, projectId }
        if (!(await startSquareInvoiceLink(db, { ...key, now: new Date().toISOString() }))) {
          return actionFailure("The Square invoice is already being created (or the invoice changed). Wait a moment, refresh and send again.")
        }
        try {
          const created = await createAndPublishSquareInvoice({
            token,
            invoiceId,
            invoiceNumber: invoice.invoiceNumber,
            sageJobShortName: projectNumber,
            sageRecordId: exported.sageRecordId,
            invoiceDate: invoice.issueDate.slice(0, 10),
            dueDate: (invoice.dueDate ?? invoice.issueDate).slice(0, 10),
            today: new Date().toISOString().slice(0, 10),
            customer: { email: firstTo, name: customerName, compassCustomerId: invoice.customerId },
            lines: invoice.lines.map((line) => ({
              name: line.description,
              amountCents: line.amountCents,
              note: line.quantity !== 1 ? `${line.quantity} ${line.unit} @ ${formatCents(line.unitPriceCents)}` : null,
            })),
            subtotalCents: invoice.subtotalCents,
            taxCents: invoice.taxCents,
            totalCents: invoice.totalCents,
            acceptBankTransfer: settings.squareAcceptBankTransfer,
            existing: { orderId: invoice.squareOrderId, squareInvoiceId: invoice.squareInvoiceId },
            saveProgress: async (progress) => {
              await simpleInvoiceUpdateStatement(db, fence, {
                ...(progress.orderId ? { squareOrderId: progress.orderId } : {}),
                ...(progress.squareInvoiceId ? { squareInvoiceId: progress.squareInvoiceId } : {}),
                ...(progress.customerId ? { squareCustomerId: progress.customerId } : {}),
                updatedAt: new Date().toISOString(),
              })
            },
          })
          squareUrl = created.publicUrl
          const now = new Date().toISOString()
          if (!(await publishSquareInvoiceLink(db, { ...key, publicUrl: created.publicUrl, now }))) {
            revalidatePath(`/dashboard/projects/${projectId}/financials/invoices/${invoiceId}`)
            // Only a void takes the payment link back down; any other change (another
            // request took over the same Square invoice, say) leaves Square alone.
            if ((await loadSimpleInvoice(db, organizationId, projectId, invoiceId))?.status !== "void") {
              return actionFailure("The invoice changed while Square was creating it. Refresh and send again; the same Square invoice is reused.")
            }
            const cancelled = await cancelSquareInvoice(token, created.squareInvoiceId).then(() => true, () => false)
            if (cancelled) await cancelSquareInvoiceLink(db, { ...key, now })
            return actionFailure(`This invoice was voided while Square was creating it. ${cancelled ? "The Square invoice was cancelled." : "Cancel the Square invoice in Square."} The email was not sent.`)
          }
          await recordActivityEvent({
            db,
            organizationId,
            projectId,
            actor: user,
            category: "financial",
            action: "invoice_square_published",
            entityType: "invoice",
            entityId: invoiceId,
            summary: `Invoice ${invoice.invoiceNumber}: Square invoice created and published (${formatCents(invoice.totalCents)}); Square sends nothing, Compass emails the link.`,
            createdAt: now,
          })
        } catch (error) {
          const message = errorMessage(error, "Square didn't create the invoice.")
          await failSquareInvoiceLink(db, { ...key, error: message.slice(0, 1000), now: new Date().toISOString() })
          revalidatePath(`/dashboard/projects/${projectId}/financials/invoices/${invoiceId}`)
          return actionFailure(`Square: ${message} The email was not sent.`)
        }
      }

      const pdf = await invoicePdf(projectId, invoiceId)
      if (!pdf.ok) return actionFailure(`${pdf.error}${squareUrl ? " The Square invoice is created; send the email again." : ""}`)
      // Read again right before sending: never email an invoice voided (or reopened) while the link or PDF was made.
      const latestStatus = (await loadSimpleInvoice(db, organizationId, projectId, invoiceId))?.status
      if (latestStatus === "void") return actionFailure("This invoice was voided. The email was not sent.")
      if (!latestStatus || latestStatus === "draft") return actionFailure("This invoice was reopened as a draft. The email was not sent.")
      // The hand-off, in one write: still this request's claim and still final,
      // the lease restarts, and the invoice is marked "may have gone out" before
      // the provider has it (an evicted Worker leaves it unconfirmed, never "not emailed").
      const renewed = await renewSimpleInvoiceEmail(db, { ...claimKey, claim, now: new Date().toISOString() })
      if (!renewed) return actionFailure("The invoice changed while this email was being prepared (voided, reopened, or another send took over). This email was not sent; refresh and check before sending again.")
      claim = renewed
      outcome = "unknown"
      const delivery = await sendTrackedEmail({
        env,
        db,
        organizationId,
        projectId,
        kind: "invoice",
        recordId: invoiceId,
        recordLabel: invoice.invoiceNumber,
        createdBy: user.id,
        to,
        cc,
        subject,
        text: invoiceText({
          message: input.message,
          invoiceNumber: invoice.invoiceNumber,
          projectName: project.name,
          totalCents: invoice.totalCents,
          dueDate: invoice.dueDate,
          squareUrl,
          creditMemo: invoice.invoiceKind === "credit_memo",
        }),
        attachments: [{ filename: `${invoice.invoiceKind === "credit_memo" ? "Credit memo" : "Invoice"} ${invoice.invoiceNumber}.pdf`.replace(/[^\w .-]/g, "-"), contentType: "application/pdf", content: pdf.bytes }],
        sender: from ?? undefined,
        replyName: `${from?.name ?? activityActorName(user)} - Invoice ${invoice.invoiceNumber}`,
        alsoReplyTo: [from?.address ?? user.email],
      })
      if (delivery.status === "sent") {
        outcome = "sent"
      } else if (emailDefinitelyNotSent(delivery.status)) {
        outcome = "not_sent"
        return actionFailure(`The email was not sent${from ? ` from ${from.address}` : ""}: ${delivery.error ?? delivery.status}.${squareUrl ? " The Square invoice is created; send the email again." : ""}`)
      } else {
        // Maybe delivered (timeout, provider 5xx, accepted without an id): never invite an immediate second send.
        return actionFailure(`${EMAIL_UNCONFIRMED_PREFIX}${from ? ` from ${from.address}` : ""} (${delivery.error ?? delivery.status}). Check that mailbox's sent mail. If it didn't go out, choose "It didn't go out" on this invoice, then send again.`)
      }
    } finally {
      const after = { ...claimKey, claim, now: new Date().toISOString() }
      if (outcome !== "sent") {
        await releaseSimpleInvoiceEmail(db, { ...after, outcome: outcome === "unknown" ? "unknown" : "not_sent" })
          .catch((error: unknown) => console.error("Invoice email claim release failed", error))
      }
    }
    // The email went out: record it (one retry). If that fails, the "may have gone out" mark stays, so nobody sends it again.
    const now = new Date().toISOString()
    const complete = (): Promise<boolean> => completeSimpleInvoiceEmail(db, { ...claimKey, claim, now }).then(() => true, () => false)
    if (!(await complete()) && !(await complete())) {
      return actionFailure("The email was sent, but Compass couldn't record it. Don't send it again.")
    }
    const recipientList = [...to, ...cc].join(", ")
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "email",
      action: "invoice_emailed",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Invoice ${invoice.invoiceNumber} emailed to ${recipientList}${from ? ` from ${from.address}` : ""}${squareUrl ? " with the Square payment link" : ""}.`,
      metadata: { to, cc, from: from?.address ?? null, square: Boolean(squareUrl) },
      createdAt: now,
    })
    // The project's staff hear that the invoice went out (not the sender).
    try {
      const recipients = await projectInternalRecipients(db, organizationId, projectId, user.id)
      if (recipients.length > 0) {
        await createNotificationEvent({
          organizationId,
          projectId,
          eventType: "invoice.emailed",
          sourceType: "invoice",
          sourceId: invoiceId,
          title: `Invoice ${invoice.invoiceNumber} sent`,
          body: `${activityActorName(user)} emailed invoice ${invoice.invoiceNumber} (${formatCents(invoice.totalCents)}) to ${recipientList}.`,
          href: `/dashboard/projects/${projectId}/financials/invoices/${invoiceId}`,
          priority: "normal",
          audience: "project_team",
          createdBy: user.id,
          recipients,
          delivery: { inApp: true, email: false, push: false },
        })
      }
    } catch (error) {
      console.error("Invoice email notification failed", error)
    }
    revalidatePath(`/dashboard/projects/${projectId}/financials`)
    revalidatePath(`/dashboard/projects/${projectId}/financials/invoices/${invoiceId}`)
    return { success: true, data: { squareUrl } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to email the invoice."))
  }
}

/**
 * Staff checked the sent mail after an email whose outcome Compass couldn't
 * confirm, and it didn't go out: clears the mark (and the claim), so the
 * invoice can be sent again, reopened or deleted. Logged to Activity.
 */
export async function confirmInvoiceEmailNotSent(projectId: string, invoiceId: string): Promise<ActionResult<null>> {
  try {
    const context = await simpleInvoiceContext(projectId, "update")
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    const invoice = await loadSimpleInvoice(db, organizationId, projectId, invoiceId)
    if (!invoice) return actionFailure("Invoice not found.")
    const cleared = await clearSimpleInvoiceEmailUnconfirmed(db, { invoiceId, organizationId, projectId, now: new Date().toISOString() })
    if (cleared === "sending") return actionFailure("This invoice is being emailed right now. Wait for that send to finish, then check again.")
    if (cleared === "none") return actionFailure("No unconfirmed email on this invoice.")
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "email",
      action: "invoice_email_confirmed_not_sent",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Invoice ${invoice.invoiceNumber ?? ""}: ${activityActorName(user)} checked the sent mail; the unconfirmed email didn't go out.`.replace("  ", " "),
      createdAt: new Date().toISOString(),
    })
    revalidatePath(`/dashboard/projects/${projectId}/financials/invoices/${invoiceId}`)
    return { success: true, data: null }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to update the invoice."))
  }
}
