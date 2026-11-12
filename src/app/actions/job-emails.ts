"use server"

import { and, asc, desc, eq } from "drizzle-orm"
import { clearOverdueFollowUpReminders } from "@/lib/notifications/clear-on-read"
import { revalidatePath } from "next/cache"
import { projectContacts, projects } from "@/db/schema"
import { recordProjectAudit } from "@/lib/domain/project-audit/store"
import { insertProjectInteractionStatement } from "@/lib/domain/crm/store"
import type { TemplateEmailDraft } from "@/lib/email/template-email"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { readDepartmentProfiles } from "@/lib/department-profiles-server"
import { addressLines } from "@/lib/department-profiles"
import { activityActorName, recordActivityEvent } from "@/lib/activity-log"
import { normalizeRecipientEmail, type EmailRecipientOption } from "@/lib/email/recipient-options"
import { projectEmailRecipientOptions } from "@/lib/email/project-recipient-options"
import { sendTrackedEmail } from "@/lib/email/tracked-send"
import { resolveStaffEmailSender } from "@/lib/email/staff-sender"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { REQUEST_COI_TEMPLATE, SEND_W9_TEMPLATE } from "@/lib/job-workflows/email-delivery"
import { readJobEmailDeliverySettings, readJobEmailW9 } from "@/lib/domain/job-workflows/store"
import { createNotificationEvent, projectInternalRecipients } from "@/lib/notifications/events"
import {
  jobEmailTemplate,
  jobEmailTemplateText,
  renderJobEmail,
  type JobEmailContext,
} from "@/lib/job-workflows/email-templates"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { getProjectAccessRecord } from "@/lib/domain/project/access"
import { projectDepartment } from "@/lib/project-branding"
import { isInternalStaffRole } from "@/lib/user-roles"
import { requireUserContext } from "@/lib/server/action-context"
import { resolvedContactColumns, withContactDirectory } from "@/lib/domain/contacts/resolved-columns"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function jobEmailContext(projectId: string, templateId: string, action: "read" | "update") {
  const { user, db, env } = await requireUserContext()
  if (!user.isActive || !isInternalStaffRole(user.role)) throw new Error("Job emails are available to office staff.")
  await requireFeaturePermission(user, "project-hub", action)
  const organizationId = requireOrg(user)
  const access = await getProjectAccessRecord(db, user, projectId)
  if (!access || access.organizationId !== organizationId) throw new Error("Project not found or access denied.")
  const project = await db
    .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber, address: projects.address, clientName: projects.clientName })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .get()
  if (!project) throw new Error("Project not found.")
  const department = projectDepartment({ projectId: project.id, projectNumber: project.projectNumber })
  const clientOrder = templateId === REQUEST_COI_TEMPLATE || templateId === SEND_W9_TEMPLATE
    ? [desc(projectContacts.primaryContact), asc(projectContacts.sortOrder), asc(resolvedContactColumns.displayName)]
    : [asc(resolvedContactColumns.displayName)]
  const [settings, profiles, client] = await Promise.all([
    readFeatureSettings(db, organizationId, "job-emails"),
    readDepartmentProfiles(db, organizationId),
    withContactDirectory(db
      .select({ id: projectContacts.id, displayName: resolvedContactColumns.displayName, email: resolvedContactColumns.email })
      .from(projectContacts)
      .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.contactType, "owner"), eq(projectContacts.active, true)))
      .orderBy(...clientOrder)
      .limit(1).$dynamic(), organizationId)
      .get(),
  ])
  const profile = profiles[department]
  const userName = user.displayName?.trim() || [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email
  // A department mailbox when the company set one; otherwise the person sending.
  const departmentSender = profile.senderAddress ? { address: profile.senderAddress, name: profile.senderName || profile.companyName } : undefined
  const resolved = await resolveStaffEmailSender({ db, env, organizationId, userId: user.id, departmentSender })
  if (!resolved.success && action === "update") throw new Error(resolved.error)
  const sender = resolved.success ? resolved.sender : { address: "", name: userName }
  const clientName = client?.displayName ?? project.clientName ?? ""
  const context: JobEmailContext = {
    clientFirstName: clientName.trim().split(/\s+/)[0] ?? "",
    clientName,
    clientEmail: client?.email ?? "",
    projectNumber: project.projectNumber ?? "",
    projectName: project.name,
    jobAddress: project.address ?? "",
    senderName: userName,
    senderEmail: sender.address,
    companyName: profile.companyName,
    legalName: profile.legalName,
    companyEmail: profile.email,
    officePhone: profile.telephone,
    officeHours: profile.officeHours,
    website: profile.website,
    mailingAddress: addressLines(profile.mailingAddress).join(", "),
  }
  return { user, organizationId, env, db, department, settings, sender, departmentSender, senderDelivery: resolved.success ? resolved.delivery : "system", client: client ?? null, context }
}

async function jobDocumentRecipients(
  db: Awaited<ReturnType<typeof jobEmailContext>>["db"],
  projectId: string,
  sendsW9: boolean,
  recommended?: string | null,
): Promise<{ readonly clients: readonly EmailRecipientOption[]; readonly cc: readonly EmailRecipientOption[] }> {
  // Filter before deduplicating so a supplier or staff entry sharing a client's email cannot hide the client.
  const [clients, staff] = await Promise.all([
    sendsW9 ? projectEmailRecipientOptions(db, projectId, [recommended], ["owner"]) : [],
    projectEmailRecipientOptions(db, projectId, [], ["internal"]),
  ])
  const clientEmails = new Set(clients.map((option) => option.email))
  return { clients, cc: [...clients, ...staff.filter((option) => !clientEmails.has(option.email))] }
}

/** A template filled in for this job, ready to review in the composer. */
export async function getJobEmailDraft(projectId: string, templateId: string): Promise<Result<TemplateEmailDraft>> {
  try {
    const ctx = await jobEmailContext(projectId, templateId, "read")
    const template = jobEmailTemplate(ctx.department, templateId)
    if (!template) return { success: false, error: "Unknown email template." }
    const rendered = renderJobEmail(jobEmailTemplateText(ctx.department, template, ctx.settings.templates), ctx.context)
    const requestsCoi = template.id === REQUEST_COI_TEMPLATE
    const sendsW9 = template.id === SEND_W9_TEMPLATE
    const deliverySettings = requestsCoi || sendsW9 ? await readJobEmailDeliverySettings(ctx.db, ctx.organizationId) : null
    const agent = deliverySettings?.insuranceAgentEmail
    const w9 = deliverySettings?.w9Version && deliverySettings.w9Filename
      ? { filename: deliverySettings.w9Filename, version: deliverySettings.w9Version }
      : null
    if (requestsCoi && !agent) {
      return { success: false, error: "Add the insurance agent email in Settings → Workflows → Job emails." }
    }
    if (sendsW9 && !w9) {
      return { success: false, error: "Upload the company W-9 in Settings → Workflows → Job emails." }
    }

    const documentRecipients = requestsCoi || sendsW9
      ? await jobDocumentRecipients(ctx.db, projectId, sendsW9, ctx.client?.email)
      : null
    const clientOptions = documentRecipients?.clients ?? []
    if (sendsW9 && clientOptions.length === 0) {
      return { success: false, error: "Add an active client contact with an email address to this job before sending the W-9." }
    }
    const recipientOptions: readonly EmailRecipientOption[] = requestsCoi && agent
      ? [{ id: "insurance-agent", email: agent, displayName: "Insurance agent", companyName: null, category: "vendor", recommended: true }]
      : sendsW9 ? clientOptions : await projectEmailRecipientOptions(ctx.db, projectId, [ctx.client?.email])
    const defaultClientEmail = sendsW9
      ? clientOptions.find((option) => option.email === normalizeRecipientEmail(ctx.client?.email ?? ""))?.email ?? ""
      : ctx.client?.email
    const to = requestsCoi && agent ? [agent] : template.audience === "client" && defaultClientEmail ? [defaultClientEmail] : []
    const audience = requestsCoi ? "the insurance agent" : template.audience === "client" ? "the client" : "the recipients you choose"
    return {
      success: true,
      data: {
        templateId: template.id,
        label: template.label,
        description: `To ${audience}, from ${ctx.sender.address || "your company mailbox after verification"}.${requestsCoi
          ? " Confirm the client’s details and add any certificate holder or coverage instructions."
          : template.audience === "client" ? " Sending logs it as a client contact." : ""}`,
        to,
        cc: [],
        recipientOptions,
        ...(documentRecipients ? { contactRecipientsOnly: true, ccOptions: documentRecipients.cc } : {}),
        ...(sendsW9 && w9 ? { requiredAttachment: w9 } : {}),
        subject: rendered.subject,
        body: rendered.body,
        missing: rendered.missing,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to prepare the email." }
  }
}

function addressList(value: FormDataEntryValue | null): string[] {
  return typeof value === "string"
    ? value
        .split(/[,;\s]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    : []
}

/**
 * Send a reviewed job email from the department mailbox, or the sender's own
 * Workspace mailbox when the department has none. Client emails are logged
 * as client contacts, so they reset follow-up aging.
 */
export async function sendJobEmail(formData: FormData): Promise<Result<{ readonly loggedContact: boolean }>> {
  try {
    const projectId = formData.get("projectId")
    const templateId = formData.get("templateId")
    const subject = formData.get("subject")
    const body = formData.get("body")
    if (typeof projectId !== "string" || typeof templateId !== "string") return { success: false, error: "Missing job or template." }
    if (typeof subject !== "string" || subject.trim() === "" || typeof body !== "string" || body.trim() === "") {
      return { success: false, error: "Enter a subject and message." }
    }
    const to = addressList(formData.get("to"))
    const cc = addressList(formData.get("cc"))
    if (to.length === 0) return { success: false, error: "Add at least one recipient." }
    const invalid = [...to, ...cc].find((address) => !EMAIL_PATTERN.test(address))
    if (invalid) return { success: false, error: `"${invalid}" is not an email address.` }

    const ctx = await jobEmailContext(projectId, templateId, "update")
    if (isDemoUser(ctx.user.id) || isDemoOrg(ctx.organizationId)) return { success: false, error: "Demo data cannot be changed." }
    const template = jobEmailTemplate(ctx.department, templateId)
    if (!template) return { success: false, error: "Unknown email template." }

    const requestsCoi = template.id === REQUEST_COI_TEMPLATE
    const sendsW9 = template.id === SEND_W9_TEMPLATE
    let clientContactId = ctx.client?.id ?? null
    if (requestsCoi || sendsW9) {
      const documentRecipients = await jobDocumentRecipients(ctx.db, projectId, sendsW9)
      const allowedCc = new Set(documentRecipients.cc.map((option) => option.email))
      if (cc.some((address) => !allowedCc.has(normalizeRecipientEmail(address)))) {
        return { success: false, error: "Choose Cc recipients from the contacts offered for this email." }
      }
      if (requestsCoi) {
        const { insuranceAgentEmail } = await readJobEmailDeliverySettings(ctx.db, ctx.organizationId)
        if (!insuranceAgentEmail || to.length !== 1 || normalizeRecipientEmail(to[0] ?? "") !== insuranceAgentEmail) {
          return { success: false, error: "Use the configured insurance agent as the only To recipient. Reopen the draft if the address changed." }
        }
      } else {
        const clients = new Map(documentRecipients.clients.map((option) => [option.email, option.id]))
        if (to.some((address) => !clients.has(normalizeRecipientEmail(address)))) {
          return { success: false, error: "Send the W-9 to active client contacts on this job." }
        }
        clientContactId = clients.get(normalizeRecipientEmail(to[0] ?? "")) ?? null
      }
    }

    let w9Attachment = null
    if (sendsW9) {
      const version = formData.get("w9Version")
      if (typeof version !== "string" || !version) return { success: false, error: "Reopen the email to attach the company W-9." }
      const w9 = await readJobEmailW9(ctx.db, ctx.organizationId, version)
      if (!w9) {
        return { success: false, error: "The company W-9 changed or was removed. Reopen the email to check the attachment." }
      }
      w9Attachment = { filename: w9.filename, contentType: "application/pdf", content: new Uint8Array(w9.pdf) }
    }

    const files = formData.getAll("attachments").filter((entry): entry is File => entry instanceof File && entry.size > 0)
    if (files.reduce((sum, file) => sum + file.size, w9Attachment?.content.byteLength ?? 0) > MAX_ATTACHMENT_BYTES) {
      return { success: false, error: "Attachments are limited to 15 MB in total." }
    }
    const attachments = await Promise.all(
      files.map(async (file) => ({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        content: new Uint8Array(await file.arrayBuffer()),
      })),
    )

    if (w9Attachment) attachments.push(w9Attachment)

    // Replies come back to this job in Compass and still reach the sending mailbox.
    const delivery = await sendTrackedEmail({
      env: ctx.env,
      db: ctx.db,
      organizationId: ctx.organizationId,
      projectId,
      kind: "job_email",
      recordId: projectId,
      recordLabel: template.label,
      createdBy: ctx.user.id,
      to,
      cc,
      subject: subject.trim(),
      text: body,
      attachments,
      sender: ctx.departmentSender,
      replyName: `${ctx.sender.name || ctx.sender.address} - ${template.label}`,
      alsoReplyTo: ctx.senderDelivery === "gmail" ? [ctx.sender.address] : [],
    })
    if (delivery.status !== "sent") {
      return {
        success: false,
        error: `The email was not sent from ${ctx.sender.address}: ${delivery.error ?? delivery.status}. Check that it is a Google Workspace mailbox Compass may send as (Settings → Company → Departments → Check sending mailbox).`,
      }
    }

    const now = new Date().toISOString()
    const loggedContact = template.audience === "client"
    const recorded = await ctx.db.batch([
      recordProjectAudit(ctx.db, {
        organizationId: ctx.organizationId,
        projectId,
        actorUserId: ctx.user.id,
        eventType: "job_email_sent",
        entityType: "project",
        entityId: projectId,
        beforeJson: null,
        afterJson: JSON.stringify({ templateId, from: ctx.sender.address, to, cc, subject: subject.trim(), attachments: attachments.map((attachment) => attachment.filename) }),
        createdAt: now,
      }),
      ...(loggedContact
        ? [
            insertProjectInteractionStatement(ctx.db, {
              id: crypto.randomUUID(),
              organizationId: ctx.organizationId,
              projectId,
              projectContactId: clientContactId,
              interactionType: "email",
              direction: "outbound",
              summary: `${template.label}: ${subject.trim()}`,
              source: "job_email",
              qualifiesForClientTouch: true,
              occurredAt: now,
              createdBy: ctx.user.id,
              updatedBy: ctx.user.id,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
              deletedBy: null,
            }),
          ]
        : []),
    ]).then(() => true).catch((error: unknown) => {
      console.error("Job email was sent but its audit or client contact could not be recorded", error)
      return false
    })
    if (loggedContact && recorded) {
      // Logged contact ends any overdue follow-up stretch; clear its reminder.
      await clearOverdueFollowUpReminders(ctx.db, [projectId]).catch((error: unknown) => {
        console.error("Unable to clear overdue follow-up reminders", error)
      })
    }
    await recordActivityEvent({
      db: ctx.db,
      organizationId: ctx.organizationId,
      projectId,
      actor: ctx.user,
      category: "email",
      action: "job_email_sent",
      entityType: "project",
      entityId: projectId,
      summary: `Emailed "${subject.trim()}" (${template.label}) to ${[...to, ...cc].join(", ")}.`.slice(0, 500),
      metadata: { templateId, attachments: attachments.length, from: ctx.sender.address, sentBy: activityActorName(ctx.user) },
    })
    if (requestsCoi || sendsW9) {
      try {
        const recipients = await projectInternalRecipients(ctx.db, ctx.organizationId, projectId, ctx.user.id)
        if (recipients.length > 0) {
          await createNotificationEvent({
            organizationId: ctx.organizationId,
            projectId,
            eventType: requestsCoi ? "job_email.coi_requested" : "job_email.w9_sent",
            sourceType: "job_email",
            sourceId: projectId,
            title: requestsCoi ? "Certificate of insurance requested" : "W-9 emailed to client",
            body: `${activityActorName(ctx.user)} sent the email for ${ctx.context.projectName}.`,
            href: `/dashboard/projects/${projectId}/information`,
            priority: "normal",
            audience: "project_team",
            createdBy: ctx.user.id,
            recipients,
            delivery: { inApp: true, email: true, push: true },
          })
        }
      } catch (error) {
        console.error("Unable to notify project staff about the sent job email", error)
      }
    }
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/information`)
    return { success: true, data: { loggedContact: loggedContact && recorded } }
  } catch (error) {
    console.error("Job email failed", error)
    return { success: false, error: error instanceof Error ? error.message : "Unable to send the email." }
  }
}
