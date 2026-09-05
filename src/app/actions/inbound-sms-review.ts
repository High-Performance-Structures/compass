"use server"

import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { getDb } from "@/db"
import {
  gotoInboundEvents,
  organizationMembers,
  projects,
  users,
} from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import type {
  InboundAttachment,
  InboundCandidate,
} from "@/lib/email/gmail-message-parser"
import {
  projectInboundEmailAddress,
  type ProjectEmailDestination,
} from "@/lib/email/project-address"
import { routeReviewedProjectInboundSms } from "@/lib/email/project-inbound-routing"
import { deleteGotoConversation } from "@/lib/goto/conversations"
import { downloadGotoInboundAttachments } from "@/lib/goto/inbound"
import { normalizeSmsPhoneNumber } from "@/lib/goto/numbers"
import type { GotoInboundMessage } from "@/lib/goto/notification-parser"
import {
  isInboundSmsTodoDestination,
  normalizeInboundSmsTodoDueDate,
} from "@/lib/goto/review-routing"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { canManageProjectRegistry } from "@/lib/permissions"
import { projectTodoHref } from "@/lib/work-calendar"

type StoredGotoAttachment = GotoInboundMessage["attachments"][number]

export type InboundSmsReviewProject = {
  readonly id: string
  readonly projectNumber: string | null
  readonly name: string
}

export type InboundSmsReviewItem = {
  readonly id: string
  readonly senderPhone: string
  readonly ownerTouchpoint: string
  readonly suggestedProjectId: string | null
  readonly messageBody: string | null
  readonly receivedAt: string
  readonly reviewReason: string | null
  readonly recoveryError: string | null
  readonly attachmentCount: number
}

export type InboundSmsReviewQueue = {
  readonly items: readonly InboundSmsReviewItem[]
  readonly projects: readonly InboundSmsReviewProject[]
}

export type InboundSmsTaskAssignee = {
  readonly id: string
  readonly name: string
  readonly email: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function storedGotoAttachments(
  value: string | null
): readonly StoredGotoAttachment[] {
  if (!value) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((item): readonly StoredGotoAttachment[] => {
    if (!isRecord(item)) return []
    const attachmentId = item.attachmentId
    const name = item.name
    const contentType = item.contentType
    const size = item.size
    if (
      typeof attachmentId !== "string" ||
      typeof name !== "string" ||
      typeof contentType !== "string" ||
      (typeof size !== "number" && size !== null)
    ) {
      return []
    }
    return [{ attachmentId, name, contentType, size }]
  })
}

async function reviewContext(): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly env: unknown
  readonly organizationId: string
  readonly user: Awaited<ReturnType<typeof requireAuth>>
}> {
  const user = await requireAuth()
  if (!canManageProjectRegistry(user)) {
    throw new Error("Project administration permission is required")
  }
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  return { db: getDb(env.DB), env, organizationId, user }
}

export async function getInboundSmsReviewQueue(): Promise<InboundSmsReviewQueue> {
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
  const eventRows = await db
    .select()
    .from(gotoInboundEvents)
    .where(
      and(
        eq(gotoInboundEvents.organizationId, organizationId),
        eq(gotoInboundEvents.status, "needs_review")
      )
    )
    .orderBy(desc(gotoInboundEvents.receivedAt))

  return {
    projects: projectRows,
    items: eventRows.map((event) => ({
      id: event.id,
      senderPhone: normalizeSmsPhoneNumber(event.senderPhone),
      ownerTouchpoint: normalizeSmsPhoneNumber(event.ownerTouchpoint),
      suggestedProjectId: event.projectId,
      messageBody: event.messageBody,
      receivedAt: event.receivedAt,
      reviewReason: event.reviewReason,
      recoveryError: event.error,
      attachmentCount: storedGotoAttachments(event.attachmentMetadata).length,
    })),
  }
}

function staffDisplayName(row: {
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string
}): string {
  const displayName = row.displayName?.trim()
  if (displayName) return displayName

  const fullName = [row.firstName, row.lastName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim()
  return fullName || row.email
}

export async function getInboundSmsTaskAssignees(): Promise<
  readonly InboundSmsTaskAssignee[]
> {
  const { db, organizationId } = await reviewContext()
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(users.isActive, true)
      )
    )
    .orderBy(asc(users.displayName), asc(users.email))

  return rows.map((row) => ({
    id: row.id,
    name: staffDisplayName(row),
    email: row.email,
  }))
}

function requiredFormString(formData: FormData, key: string): string {
  const value = formData.get(key)
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required`)
  }
  return value.trim()
}

function requiredDueDate(formData: FormData): string {
  const value = requiredFormString(formData, "dueDate")
  const dueDate = normalizeInboundSmsTodoDueDate(value)
  if (!dueDate) throw new Error("Choose a valid due date")
  return dueDate
}

function reviewedDestination(value: string): ProjectEmailDestination {
  if (
    value === "message" ||
    value === "rfi" ||
    value === "rfq" ||
    value === "change_order" ||
    value === "todo" ||
    value === "delivery" ||
    value === "daily_log" ||
    value === "video"
  ) {
    return value
  }
  throw new Error("A supported destination is required")
}

function destinationFeature(
  destination: ProjectEmailDestination
): "rfis" | "rfqs" | "change-orders" | "tasks" | "daily-logs" | "conversations" {
  if (destination === "message") return "conversations"
  if (destination === "rfi") return "rfis"
  if (destination === "rfq") return "rfqs"
  if (destination === "change_order") return "change-orders"
  if (destination === "daily_log" || destination === "video") {
    return "daily-logs"
  }
  return "tasks"
}

function destinationTag(destination: ProjectEmailDestination): string {
  if (destination === "message") return "[MESSAGE]"
  if (destination === "rfi") return "[RFI]"
  if (destination === "rfq") return "[RFQ]"
  if (destination === "change_order") return "[CHANGE ORDER]"
  if (destination === "todo") return "[TO-DO]"
  if (destination === "delivery") return "[DELIVERY]"
  if (destination === "video") return "[VIDEO]"
  return "[DAILY LOG]"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : "Unknown error"
}

export async function routeInboundSms(formData: FormData): Promise<void> {
  const eventId = requiredFormString(formData, "eventId")
  const projectId = requiredFormString(formData, "projectId")
  const title = requiredFormString(formData, "title")
  const messageBody = requiredFormString(formData, "messageBody")
  const destination = reviewedDestination(
    requiredFormString(formData, "destination")
  )
  const { db, env, organizationId, user } = await reviewContext()
  await requireFeaturePermission(user, destinationFeature(destination), "create")

  const event = await db
    .select()
    .from(gotoInboundEvents)
    .where(
      and(
        eq(gotoInboundEvents.id, eventId),
        eq(gotoInboundEvents.organizationId, organizationId),
        eq(gotoInboundEvents.status, "needs_review")
      )
    )
    .get()
  if (!event) throw new Error("Inbound text is no longer awaiting review")

  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId)
      )
    )
    .get()
  if (!project) throw new Error("Project not found")

  const todoDetails =
    isInboundSmsTodoDestination(destination)
      ? await (async () => {
          const assigneeUserId = requiredFormString(formData, "assigneeUserId")
          const dueDate = requiredDueDate(formData)
          const assignee = await db
            .select({
              id: users.id,
              email: users.email,
              displayName: users.displayName,
              firstName: users.firstName,
              lastName: users.lastName,
            })
            .from(users)
            .innerJoin(
              organizationMembers,
              eq(organizationMembers.userId, users.id)
            )
            .where(
              and(
                eq(users.id, assigneeUserId),
                eq(users.isActive, true),
                eq(organizationMembers.organizationId, organizationId)
              )
            )
            .get()
          if (!assignee) throw new Error("Choose an active staff assignee")
          return {
            assigneeName: staffDisplayName(assignee),
            dueDate,
          }
        })()
      : undefined

  const claimTime = new Date().toISOString()
  const claimed = await db
    .update(gotoInboundEvents)
    .set({ status: "routing", error: null, updatedAt: claimTime })
    .where(
      and(
        eq(gotoInboundEvents.id, event.id),
        eq(gotoInboundEvents.organizationId, organizationId),
        eq(gotoInboundEvents.status, "needs_review")
      )
    )
    .returning({ id: gotoInboundEvents.id })
    .get()
  if (!claimed) throw new Error("Inbound text is already being reviewed")

  let routedEntityId: string | null = null
  try {
    const attachmentMetadata = storedGotoAttachments(event.attachmentMetadata)
    const message: GotoInboundMessage = {
      eventId: event.id,
      accountKey: event.accountKey,
      messageId: event.messageId,
      conversationId: event.conversationId,
      ownerTouchpoint: event.ownerTouchpoint,
      senderPhone: event.senderPhone,
      body: event.messageBody ?? messageBody,
      receivedAt: event.receivedAt,
      attachments: attachmentMetadata,
    }
    const attachments: readonly InboundAttachment[] =
      attachmentMetadata.length > 0
        ? await downloadGotoInboundAttachments({ env, message })
        : []
    const candidate: InboundCandidate = {
      gmailMessageId: event.messageId,
      gmailThreadId: event.conversationId,
      messageIdHeader: null,
      inReplyToHeader: null,
      referencesHeader: null,
      token: null,
      fromAddress: `sms:${event.senderPhone}`,
      fromName: null,
      toAddress: projectInboundEmailAddress(project.id),
      subject: `${destinationTag(destination)} ${title}`,
      textBody: messageBody,
      htmlBody: null,
      snippet: messageBody.slice(0, 240),
      receivedAt: event.receivedAt,
      attachments,
    }
    const result = await routeReviewedProjectInboundSms({
      env,
      db,
      organizationId,
      projectId: project.id,
      candidate,
      todoDetails,
    })
    if (result.kind !== "routed") {
      throw new Error("Compass could not route the reviewed text")
    }
    routedEntityId = result.entityId

    const now = new Date().toISOString()
    await db
      .update(gotoInboundEvents)
      .set({
        projectId: project.id,
        status: "processed",
        error: null,
        reviewReason: null,
        processedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(gotoInboundEvents.id, event.id),
          eq(gotoInboundEvents.status, "routing")
        )
      )
  } catch (error) {
    const failedAt = new Date().toISOString()
    await db
      .update(gotoInboundEvents)
      .set({
        status: "needs_review",
        error: errorMessage(error),
        updatedAt: failedAt,
      })
      .where(
        and(
          eq(gotoInboundEvents.id, event.id),
          eq(gotoInboundEvents.status, "routing")
        )
      )
    throw error
  }

  revalidatePath("/dashboard/office-maintenance/inbound-email")
  revalidatePath("/dashboard/activity")
  revalidatePath(`/dashboard/projects/${project.id}`)
  revalidatePath(`/dashboard/projects/${project.id}/todos`)
  revalidatePath("/dashboard/schedule")
  if (
    routedEntityId &&
    isInboundSmsTodoDestination(destination)
  ) {
    redirect(projectTodoHref(project.id, routedEntityId))
  }
}

export async function dismissInboundSms(formData: FormData): Promise<void> {
  const eventId = requiredFormString(formData, "eventId")
  const { db, organizationId, user } = await reviewContext()
  const now = new Date().toISOString()
  const event = await db
    .update(gotoInboundEvents)
    .set({
      status: "dismissed",
      reviewReason: null,
      processedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(gotoInboundEvents.id, eventId),
        eq(gotoInboundEvents.organizationId, organizationId),
        eq(gotoInboundEvents.status, "needs_review")
      )
    )
    .returning({ id: gotoInboundEvents.id, messageId: gotoInboundEvents.messageId })
    .get()
  if (!event) return

  await recordActivityEvent({
    db,
    organizationId,
    actor: user,
    category: "conversation",
    action: "project_goto_sms.dismissed",
    entityType: "project_goto_sms",
    entityId: event.messageId,
    summary: "Dismissed an inbound text from the Compass message desk.",
    metadata: { reviewedBy: user.id },
    createdAt: now,
  })
  revalidatePath("/dashboard/office-maintenance/inbound-email")
  revalidatePath("/dashboard/activity")
}

export async function trashInboundSms(formData: FormData): Promise<void> {
  const eventId = requiredFormString(formData, "eventId")
  const { db, env, organizationId, user } = await reviewContext()
  const event = await db
    .select()
    .from(gotoInboundEvents)
    .where(
      and(
        eq(gotoInboundEvents.id, eventId),
        eq(gotoInboundEvents.organizationId, organizationId),
        eq(gotoInboundEvents.status, "needs_review")
      )
    )
    .get()
  if (!event) throw new Error("Inbound text is no longer awaiting review")

  const claimedAt = new Date().toISOString()
  const claimed = await db
    .update(gotoInboundEvents)
    .set({ status: "trashing", error: null, updatedAt: claimedAt })
    .where(
      and(
        eq(gotoInboundEvents.id, event.id),
        eq(gotoInboundEvents.status, "needs_review")
      )
    )
    .returning({ id: gotoInboundEvents.id })
    .get()
  if (!claimed) throw new Error("Inbound text is already being reviewed")

  const deleted = await deleteGotoConversation({
    env,
    ownerPhoneNumber: event.ownerTouchpoint,
    contactPhoneNumber: event.senderPhone,
  })
  if (!deleted.success) {
    await db
      .update(gotoInboundEvents)
      .set({
        status: "needs_review",
        error: deleted.error.slice(0, 2_000),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(gotoInboundEvents.id, event.id))
    throw new Error(deleted.error)
  }

  const trashedAt = new Date().toISOString()
  await db
    .update(gotoInboundEvents)
    .set({
      status: "trashed",
      reviewReason: "spam",
      error: null,
      trashedAt,
      trashedBy: user.id,
      providerDeletedAt: trashedAt,
      processedAt: trashedAt,
      updatedAt: trashedAt,
    })
    .where(
      and(
        eq(gotoInboundEvents.organizationId, organizationId),
        eq(gotoInboundEvents.ownerTouchpoint, event.ownerTouchpoint),
        eq(gotoInboundEvents.senderPhone, event.senderPhone),
        inArray(gotoInboundEvents.status, ["needs_review", "trashing"])
      )
    )

  await recordActivityEvent({
    db,
    organizationId,
    actor: user,
    category: "conversation",
    action: "project_goto_sms.trashed",
    entityType: "project_goto_sms",
    entityId: event.messageId,
    summary: `Deleted the GoTo conversation with ${normalizeSmsPhoneNumber(event.senderPhone)} as spam.`,
    metadata: { providerDeleted: true, reviewedBy: user.id },
    createdAt: trashedAt,
  })
  revalidatePath("/dashboard/office-maintenance/inbound-email")
  revalidatePath("/dashboard/activity")
}
