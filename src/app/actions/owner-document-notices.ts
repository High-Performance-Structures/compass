"use server"

import { and, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import { notificationPreferences, organizationMembers, projectBudgetApplications, projectContacts, projectMembers, projects, users } from "@/db/schema"
import { activityActorName, recordActivityEvent } from "@/lib/activity-log"
import { requireAuth, type AuthUser } from "@/lib/auth"
import {
  isOwnerDocumentKind,
  ownerDocumentEmail,
  ownerDocumentNotification,
  type OwnerDocumentFacts,
  type OwnerDocumentKind,
  type ProjectEmailPrefill,
} from "@/lib/billing/owner-document-notices"
import { getCloudflareContext } from "@/lib/db"
import { depositRequestDocument } from "@/lib/deposits/deposit-requests"
import { sendCompassEmail } from "@/lib/email/compass-email"
import { isValidRecipientEmail, normalizeRecipientEmail } from "@/lib/email/recipient-options"
import { createNotificationEvent } from "@/lib/notifications/create-event"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import { printPdfHref } from "@/lib/print/print-documents"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * After a pay application is approved for billing or a deposit is requested,
 * staff can start a project email to the owner (with the PDF attached in the
 * composer) or send the owner's portal users a notification.
 */

type NoticeContext = {
  readonly db: ReturnType<typeof getDb>
  readonly env: unknown
  readonly user: AuthUser
  readonly organizationId: string
  readonly project: { readonly id: string; readonly name: string; readonly projectNumber: string | null }
}

type OwnerDocument = {
  readonly facts: OwnerDocumentFacts
  readonly pdfPath: string
  readonly fileName: string
}

export type OwnerNoticeRecipient = { readonly name: string; readonly email: string }

function compassAppUrl(env: unknown): string {
  const value = typeof env === "object" && env !== null ? Reflect.get(env, "COMPASS_APP_URL") : null
  return typeof value === "string" && value.trim() ? value.trim().replace(/\/$/, "") : "https://compass.openrangeconstruction.ltd"
}

function ownerPortalPath(projectId: string): string {
  return `/preview/projects/${encodeURIComponent(projectId)}/owner/budget`
}

async function noticeAccess(projectId: string): Promise<NoticeContext> {
  const user = await requireAuth()
  requirePermission(user, "project", "update")
  if (!isInternalStaffRole(user.role)) throw new Error("Only staff can notify the owner.")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await db
    .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .get()
  if (!project) throw new Error("Project not found")
  return { db, env, user, organizationId, project }
}

async function ownerDocument(ctx: NoticeContext, kind: OwnerDocumentKind, documentId: string): Promise<OwnerDocument> {
  const base = {
    kind,
    projectName: ctx.project.name,
    projectNumber: ctx.project.projectNumber,
    portalUrl: `${compassAppUrl(ctx.env)}${ownerPortalPath(ctx.project.id)}`,
    senderName: ctx.user.displayName ?? ctx.user.email,
  }
  if (kind === "pay-application") {
    const application = await ctx.db
      .select()
      .from(projectBudgetApplications)
      .where(and(
        eq(projectBudgetApplications.id, documentId),
        eq(projectBudgetApplications.projectId, ctx.project.id),
        eq(projectBudgetApplications.sourceSystem, "compass_contract_budget"),
      ))
      .get()
    if (!application || application.status !== "billed" || !application.ownerVisible) {
      throw new Error("Approve the pay application for billing before telling the owner about it.")
    }
    return {
      facts: { ...base, documentNumber: application.applicationNumber, amountCents: Math.round(application.currentPaymentDue * 100), dueDate: null },
      pdfPath: `/api/projects/${encodeURIComponent(ctx.project.id)}/pay-applications/${encodeURIComponent(application.id)}/pdf`,
      fileName: `${ctx.project.projectNumber ?? "Project"}-PayApp-${application.applicationNumber.padStart(2, "0")}.pdf`,
    }
  }
  const request = await depositRequestDocument(ctx.db, ctx.project.id, documentId)
  if (!request || request.status !== "requested") throw new Error("This deposit request is no longer open.")
  return {
    facts: { ...base, documentNumber: request.number, amountCents: request.amountCents, dueDate: request.dueDate },
    pdfPath: printPdfHref({ projectId: ctx.project.id, document: "deposit-request", params: { depositId: request.id }, number: request.number }),
    fileName: `${request.number}.pdf`,
  }
}

/** Active users with owner or client access to this project. */
async function ownerPortalUsers(ctx: NoticeContext): Promise<readonly { readonly userId: string; readonly name: string; readonly email: string }[]> {
  const rows = await ctx.db
    .select({ userId: users.id, name: users.displayName, email: users.email })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .innerJoin(organizationMembers, and(eq(organizationMembers.userId, users.id), eq(organizationMembers.organizationId, ctx.organizationId)))
    .where(and(eq(projectMembers.projectId, ctx.project.id), inArray(projectMembers.role, ["owner", "client"]), eq(users.isActive, true)))
  const seen = new Set<string>()
  return rows.flatMap((row) => {
    const email = normalizeRecipientEmail(row.email)
    if (seen.has(row.userId) || !isValidRecipientEmail(email)) return []
    seen.add(row.userId)
    return [{ userId: row.userId, name: row.name ?? email, email }]
  })
}

/** Owner contacts on the project, then owner portal users, without repeats. */
async function ownerEmailAddresses(ctx: NoticeContext): Promise<readonly string[]> {
  const contacts = await ctx.db
    .select({ email: projectContacts.email })
    .from(projectContacts)
    .where(and(eq(projectContacts.projectId, ctx.project.id), eq(projectContacts.contactType, "owner"), eq(projectContacts.active, true)))
  const portal = await ownerPortalUsers(ctx)
  const addresses = [...contacts.map((row) => row.email ?? ""), ...portal.map((person) => person.email)].map(normalizeRecipientEmail)
  return [...new Set(addresses.filter(isValidRecipientEmail))].slice(0, 20)
}

function failure(error: unknown, fallback: string): { readonly success: false; readonly error: string } {
  return { success: false, error: error instanceof Error ? error.message : fallback }
}

/** The project email to start from: owner addresses, wording, and the PDF to attach. */
export async function getOwnerDocumentEmailDraft(
  projectId: string,
  kind: string,
  documentId: string
): Promise<{ readonly success: true; readonly data: ProjectEmailPrefill } | { readonly success: false; readonly error: string }> {
  try {
    if (!isOwnerDocumentKind(kind)) throw new Error("Choose a pay application or deposit request.")
    const ctx = await noticeAccess(projectId)
    const document = await ownerDocument(ctx, kind, documentId)
    const email = ownerDocumentEmail(document.facts)
    return {
      success: true,
      data: { to: await ownerEmailAddresses(ctx), subject: email.subject, body: email.body, attachment: { url: document.pdfPath, fileName: document.fileName } },
    }
  } catch (error) {
    return failure(error, "The owner email could not be prepared.")
  }
}

/** Who a notification would reach, for the confirmation. */
export async function getOwnerDocumentNotificationRecipients(
  projectId: string,
  kind: string,
  documentId: string
): Promise<{ readonly success: true; readonly data: readonly OwnerNoticeRecipient[] } | { readonly success: false; readonly error: string }> {
  try {
    if (!isOwnerDocumentKind(kind)) throw new Error("Choose a pay application or deposit request.")
    const ctx = await noticeAccess(projectId)
    await ownerDocument(ctx, kind, documentId)
    return { success: true, data: (await ownerPortalUsers(ctx)).map(({ name, email }) => ({ name, email })) }
  } catch (error) {
    return failure(error, "The owner's Compass users could not be loaded.")
  }
}

/**
 * Notifies the owner's portal users in Compass (and on their phones) and
 * emails each of them separately, unless they turned email notifications off.
 */
export async function sendOwnerDocumentNotification(
  projectId: string,
  kind: string,
  documentId: string
): Promise<{ readonly success: true; readonly notified: number; readonly emailed: number } | { readonly success: false; readonly error: string }> {
  try {
    if (!isOwnerDocumentKind(kind)) throw new Error("Choose a pay application or deposit request.")
    const ctx = await noticeAccess(projectId)
    const document = await ownerDocument(ctx, kind, documentId)
    const recipients = await ownerPortalUsers(ctx)
    if (recipients.length === 0) {
      throw new Error("No one on the owner's side has Compass access to this project yet. Use Create email instead.")
    }
    const notice = ownerDocumentNotification(document.facts)
    const href = ownerPortalPath(ctx.project.id)
    await createNotificationEvent({
      organizationId: ctx.organizationId,
      projectId: ctx.project.id,
      eventType: kind === "pay-application" ? "billing.pay_application" : "billing.deposit_request",
      sourceType: kind === "pay-application" ? "project_budget_application" : "project_contract_deposit",
      sourceId: documentId,
      title: notice.title,
      body: notice.body,
      href,
      priority: "normal",
      audience: "owner",
      createdBy: ctx.user.id,
      recipients: recipients.map(({ userId, email }) => ({ userId, email })),
      // Email goes out below through the project email sender.
      delivery: { inApp: true, email: false, push: true },
    })
    const preferences = await ctx.db
      .select({ userId: notificationPreferences.userId, emailEnabled: notificationPreferences.emailEnabled })
      .from(notificationPreferences)
      .where(inArray(notificationPreferences.userId, recipients.map((person) => person.userId)))
    const emailOff = new Set(preferences.filter((row) => !row.emailEnabled).map((row) => row.userId))
    let emailed = 0
    for (const person of recipients) {
      if (emailOff.has(person.userId)) continue
      try {
        const delivery = await sendCompassEmail({
          env: ctx.env,
          db: ctx.db,
          organizationId: ctx.organizationId,
          to: [person.email],
          subject: notice.title,
          text: `${notice.body}\n\nOpen in Compass: ${document.facts.portalUrl}`,
        })
        if (delivery.status === "sent") emailed += 1
      } catch {
        // The in-app notification still reached them.
      }
    }
    await recordActivityEvent({
      db: ctx.db,
      organizationId: ctx.organizationId,
      projectId: ctx.project.id,
      actor: ctx.user,
      category: "financial",
      action: kind === "pay-application" ? "pay_application_owner_notified" : "deposit_request_owner_notified",
      entityType: kind === "pay-application" ? "project_budget_application" : "project_contract_deposit",
      entityId: documentId,
      summary: `Notified ${recipients.map((person) => person.name).join(", ")} about ${notice.title}.`.slice(0, 500),
      metadata: { notified: recipients.length, emailed, notifiedBy: activityActorName(ctx.user) },
    })
    return { success: true, notified: recipients.length, emailed }
  } catch (error) {
    return failure(error, "The owner could not be notified.")
  }
}
