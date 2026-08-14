"use server"

import { and, desc, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { inboundEmails, projectRfis, projects } from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { stripHtml } from "@/lib/email/gmail-message-parser"
import {
  inboundRecordKind,
  inboundRecordSubject,
  matchInboundProject,
} from "@/lib/email/inbound-routing"
import { notifyRfiCreated } from "@/lib/notifications/events"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { canManageProjectRegistry } from "@/lib/permissions"

export type InboundEmailReviewProject = {
  readonly id: string
  readonly projectNumber: string | null
  readonly name: string
}

export type InboundEmailReviewItem = {
  readonly id: string
  readonly fromAddress: string
  readonly fromName: string | null
  readonly toAddress: string | null
  readonly subject: string
  readonly bodyPreview: string
  readonly receivedAt: string
  readonly kind: "rfi" | null
  readonly suggestedProjectId: string | null
}

export type InboundEmailReviewQueue = {
  readonly items: readonly InboundEmailReviewItem[]
  readonly projects: readonly InboundEmailReviewProject[]
}

function bodyText(input: {
  readonly textBody: string | null
  readonly htmlBody: string | null
  readonly snippet: string | null
}): string {
  return (
    input.textBody ??
    (input.htmlBody ? stripHtml(input.htmlBody) : null) ??
    input.snippet ??
    "(No message body.)"
  ).trim()
}

function rfiNumberFor(
  projectNumber: string | null,
  existingCount: number,
  id: string
): string {
  const sequence = String(existingCount + 1).padStart(3, "0")
  const prefix = projectNumber?.trim() ?? ""
  return prefix.length > 0
    ? `${prefix}-RFI-${sequence}`
    : `RFI-${sequence}-${id.slice(0, 6).toUpperCase()}`
}

async function reviewContext(): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly user: Awaited<ReturnType<typeof requireAuth>>
}> {
  const user = await requireAuth()
  if (!canManageProjectRegistry(user)) {
    throw new Error("Project administration permission is required")
  }
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  return { db: getDb(env.DB), organizationId, user }
}

export async function getInboundEmailReviewQueue(): Promise<InboundEmailReviewQueue> {
  const { db, organizationId } = await reviewContext()
  const projectRows = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      name: projects.name,
    })
    .from(projects)
    .where(eq(projects.organizationId, organizationId))
    .orderBy(projects.projectNumber, projects.name)
  const emailRows = await db
    .select()
    .from(inboundEmails)
    .where(
      and(
        eq(inboundEmails.organizationId, organizationId),
        eq(inboundEmails.matchedStatus, "needs_review")
      )
    )
    .orderBy(desc(inboundEmails.receivedAt))

  return {
    projects: projectRows,
    items: emailRows.map((email) => ({
      id: email.id,
      fromAddress: email.fromAddress,
      fromName: email.fromName,
      toAddress: email.toAddress,
      subject: email.subject,
      bodyPreview: bodyText(email).slice(0, 800),
      receivedAt: email.receivedAt,
      kind: inboundRecordKind(email.subject),
      suggestedProjectId:
        matchInboundProject(email, projectRows)?.id ?? email.projectId,
    })),
  }
}

function requiredFormString(formData: FormData, key: string): string {
  const value = formData.get(key)
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required`)
  }
  return value.trim()
}

export async function routeInboundEmailToRfi(formData: FormData): Promise<void> {
  const emailId = requiredFormString(formData, "emailId")
  const projectId = requiredFormString(formData, "projectId")
  const { db, organizationId, user } = await reviewContext()
  await requireFeaturePermission(user, "rfis", "create")

  const [email] = await db
    .select()
    .from(inboundEmails)
    .where(
      and(
        eq(inboundEmails.id, emailId),
        eq(inboundEmails.organizationId, organizationId),
        eq(inboundEmails.matchedStatus, "needs_review")
      )
    )
    .limit(1)
  if (!email) throw new Error("Inbound email is no longer awaiting review")
  if (inboundRecordKind(email.subject) !== "rfi") {
    throw new Error("This email does not have an RFI subject tag")
  }

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!project) throw new Error("Project not found")

  const [existing] = await db
    .select({ id: projectRfis.id, rfiNumber: projectRfis.rfiNumber })
    .from(projectRfis)
    .where(
      and(
        eq(projectRfis.sourceSystem, "email"),
        eq(projectRfis.sourceRecordId, email.gmailMessageId)
      )
    )
    .limit(1)

  let rfi = existing
  if (!rfi) {
    const count = await db
      .select({ count: sql<number>`count(*)` })
      .from(projectRfis)
      .where(eq(projectRfis.projectId, project.id))
      .then((rows) => rows[0]?.count ?? 0)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const rfiNumber = rfiNumberFor(project.projectNumber, count, id)
    await db.insert(projectRfis).values({
      id,
      projectId: project.id,
      sourceSystem: "email",
      sourceRecordId: email.gmailMessageId,
      rfiNumber,
      subject: inboundRecordSubject(email.subject),
      question: bodyText(email),
      answer: null,
      status: "new",
      priority: "normal",
      audience: "internal",
      requesterName: email.fromName ?? email.fromAddress,
      assignedToName: null,
      companyName: null,
      dueDate: null,
      submittedAt: email.receivedAt,
      answeredAt: null,
      createdAt: now,
      updatedAt: now,
    })
    rfi = { id, rfiNumber }

    await recordActivityEvent({
      db,
      id: `project-email-routed-${email.gmailMessageId}`,
      organizationId,
      projectId: project.id,
      actor: {
        id: null,
        email: email.fromAddress,
        displayName: email.fromName,
        firstName: null,
        lastName: null,
        role: "project_email",
      },
      category: "email",
      action: "project_email.routed",
      entityType: "rfi",
      entityId: id,
      summary: `Routed project email from ${email.fromName ?? email.fromAddress} to RFI: “${inboundRecordSubject(email.subject)}”.`,
      metadata: {
        destination: "rfi",
        manualReview: true,
        routedBy: user.id,
      },
      createdAt: email.receivedAt,
    })

    try {
      await notifyRfiCreated({
        organizationId,
        projectId: project.id,
        rfiId: id,
        rfiNumber,
        subject: inboundRecordSubject(email.subject),
        assignedToName: null,
        createdBy: user,
      })
    } catch (error) {
      console.error("[inbound-email-review] notification error", error)
    }
  }

  await db
    .update(inboundEmails)
    .set({
      projectId: project.id,
      matchedStatus: "posted",
      postedMessageId: rfi.id,
    })
    .where(eq(inboundEmails.id, email.id))

  revalidatePath("/dashboard/office-maintenance/inbound-email")
  revalidatePath(`/dashboard/projects/${project.id}/rfis`)
  revalidatePath("/dashboard/rfis")
}

export async function dismissInboundEmail(formData: FormData): Promise<void> {
  const emailId = requiredFormString(formData, "emailId")
  const { db, organizationId } = await reviewContext()
  await db
    .update(inboundEmails)
    .set({ matchedStatus: "dismissed" })
    .where(
      and(
        eq(inboundEmails.id, emailId),
        eq(inboundEmails.organizationId, organizationId),
        eq(inboundEmails.matchedStatus, "needs_review")
      )
    )
  revalidatePath("/dashboard/office-maintenance/inbound-email")
}
