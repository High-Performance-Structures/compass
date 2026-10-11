"use server"

import { and, asc, eq } from "drizzle-orm"
import { clearOverdueFollowUpReminders } from "@/lib/notifications/clear-on-read"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { projectContacts, projectInteractions, projectProfileAuditEvents, projects } from "@/db/schema"
import type { TemplateEmailDraft } from "@/lib/email/template-email"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { readDepartmentProfiles } from "@/lib/department-profiles-server"
import { addressLines } from "@/lib/department-profiles"
import { sendCompassEmail } from "@/lib/email/compass-email"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import {
  jobEmailTemplate,
  jobEmailTemplateText,
  renderJobEmail,
  type JobEmailContext,
} from "@/lib/job-workflows/email-templates"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { getProjectAccessRecord } from "@/lib/project-access"
import { projectDepartment } from "@/lib/project-branding"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function jobEmailContext(projectId: string, action: "read" | "update") {
  const user = await requireAuth()
  if (!isInternalStaffRole(user.role)) throw new Error("Job emails are available to office staff.")
  await requireFeaturePermission(user, "project-hub", action)
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const access = await getProjectAccessRecord(db, user, projectId)
  if (!access || access.organizationId !== organizationId) throw new Error("Project not found or access denied.")
  const project = await db
    .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber, address: projects.address, clientName: projects.clientName })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .get()
  if (!project) throw new Error("Project not found.")
  const department = projectDepartment({ projectId: project.id, projectNumber: project.projectNumber })
  const [settings, profiles, client] = await Promise.all([
    readFeatureSettings(db, organizationId, "job-emails"),
    readDepartmentProfiles(db, organizationId),
    db
      .select({ id: projectContacts.id, displayName: projectContacts.displayName, email: projectContacts.email })
      .from(projectContacts)
      .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.contactType, "owner"), eq(projectContacts.active, true)))
      .orderBy(asc(projectContacts.displayName))
      .limit(1)
      .get(),
  ])
  const profile = profiles[department]
  const userName = user.displayName?.trim() || [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email
  // A department mailbox when the company set one; otherwise the person sending.
  const sender = profile.senderAddress
    ? { address: profile.senderAddress, name: profile.senderName || profile.companyName }
    : { address: user.googleEmail ?? user.email, name: userName }
  const clientName = client?.displayName ?? project.clientName ?? ""
  const context: JobEmailContext = {
    clientFirstName: clientName.trim().split(/\s+/)[0] ?? "",
    clientName,
    projectNumber: project.projectNumber ?? "",
    projectName: project.name,
    jobAddress: project.address ?? "",
    senderName: userName,
    senderEmail: user.googleEmail ?? user.email,
    companyName: profile.companyName,
    legalName: profile.legalName,
    companyEmail: profile.email,
    officePhone: profile.telephone,
    officeHours: profile.officeHours,
    website: profile.website,
    mailingAddress: addressLines(profile.mailingAddress).join(", "),
  }
  return { user, organizationId, env, db, department, settings, sender, client: client ?? null, context }
}

/** A template filled in for this job, ready to review in the composer. */
export async function getJobEmailDraft(projectId: string, templateId: string): Promise<Result<TemplateEmailDraft>> {
  try {
    const ctx = await jobEmailContext(projectId, "read")
    const template = jobEmailTemplate(ctx.department, templateId)
    if (!template) return { success: false, error: "Unknown email template." }
    const rendered = renderJobEmail(jobEmailTemplateText(ctx.department, template, ctx.settings.templates), ctx.context)
    const audience = template.audience === "client" ? "the client" : "the recipients you choose"
    return {
      success: true,
      data: {
        templateId: template.id,
        label: template.label,
        description: `To ${audience}, from ${ctx.sender.address}.${template.audience === "client" ? " Sending logs it as a client contact." : ""}`,
        to: template.audience === "client" && ctx.client?.email ? [ctx.client.email] : [],
        cc: [],
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

    const ctx = await jobEmailContext(projectId, "update")
    if (isDemoUser(ctx.user.id) || isDemoOrg(ctx.organizationId)) return { success: false, error: "Demo data cannot be changed." }
    const template = jobEmailTemplate(ctx.department, templateId)
    if (!template) return { success: false, error: "Unknown email template." }

    const files = formData.getAll("attachments").filter((entry): entry is File => entry instanceof File && entry.size > 0)
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENT_BYTES) {
      return { success: false, error: "Attachments are limited to 15 MB in total." }
    }
    const attachments = await Promise.all(
      files.map(async (file) => ({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        content: new Uint8Array(await file.arrayBuffer()),
      })),
    )

    const delivery = await sendCompassEmail({
      env: ctx.env,
      db: ctx.db,
      organizationId: ctx.organizationId,
      to,
      cc,
      subject: subject.trim(),
      text: body,
      attachments,
      sender: { address: ctx.sender.address, name: ctx.sender.name || null },
    })
    if (delivery.status !== "sent") {
      return {
        success: false,
        error: `The email was not sent from ${ctx.sender.address}: ${delivery.error ?? delivery.status}. Check that it is a Google Workspace mailbox Compass may send as (Settings → Company → Departments → Check sending mailbox).`,
      }
    }

    const now = new Date().toISOString()
    const loggedContact = template.audience === "client"
    await ctx.db.batch([
      ctx.db.insert(projectProfileAuditEvents).values({
        id: crypto.randomUUID(),
        organizationId: ctx.organizationId,
        projectId,
        actorUserId: ctx.user.id,
        eventType: "job_email_sent",
        entityType: "project",
        entityId: projectId,
        beforeJson: null,
        afterJson: JSON.stringify({ templateId, from: ctx.sender.address, to, cc, subject: subject.trim(), attachments: files.map((file) => file.name) }),
        createdAt: now,
      }),
      ...(loggedContact
        ? [
            ctx.db.insert(projectInteractions).values({
              id: crypto.randomUUID(),
              organizationId: ctx.organizationId,
              projectId,
              projectContactId: ctx.client?.id ?? null,
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
    ])
    if (loggedContact) {
      // Logged contact ends any overdue follow-up stretch; clear its reminder.
      await clearOverdueFollowUpReminders(ctx.db, [projectId]).catch((error: unknown) => {
        console.error("Unable to clear overdue follow-up reminders", error)
      })
    }
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/information`)
    return { success: true, data: { loggedContact } }
  } catch (error) {
    console.error("Job email failed", error)
    return { success: false, error: error instanceof Error ? error.message : "Unable to send the email." }
  }
}
