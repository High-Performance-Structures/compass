"use server"

import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { gotoInboundEvents, projects } from "@/db/schema"
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
import { downloadGotoInboundAttachments } from "@/lib/goto/inbound"
import type { GotoInboundMessage } from "@/lib/goto/notification-parser"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { canManageProjectRegistry } from "@/lib/permissions"

type StoredGotoAttachment = GotoInboundMessage["attachments"][number]

export type InboundSmsReviewProject = {
  readonly id: string
  readonly projectNumber: string | null
  readonly name: string
}

export type InboundSmsReviewItem = {
  readonly id: string
  readonly senderLabel: string
  readonly messageBody: string | null
  readonly receivedAt: string
  readonly reviewReason: string | null
  readonly attachmentCount: number
}

export type InboundSmsReviewQueue = {
  readonly items: readonly InboundSmsReviewItem[]
  readonly projects: readonly InboundSmsReviewProject[]
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

function maskedPhone(value: string): string {
  const digits = value.replace(/\D/g, "")
  return `Text sender ending ${digits.slice(-4) || "unknown"}`
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
      senderLabel: maskedPhone(event.senderPhone),
      messageBody: event.messageBody,
      receivedAt: event.receivedAt,
      reviewReason: event.reviewReason,
      attachmentCount: storedGotoAttachments(event.attachmentMetadata).length,
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

function reviewedDestination(value: string): ProjectEmailDestination {
  if (
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
): "rfis" | "rfqs" | "change-orders" | "tasks" | "daily-logs" {
  if (destination === "rfi") return "rfis"
  if (destination === "rfq") return "rfqs"
  if (destination === "change_order") return "change-orders"
  if (destination === "daily_log" || destination === "video") {
    return "daily-logs"
  }
  return "tasks"
}

function destinationTag(destination: ProjectEmailDestination): string {
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
  const { db, organizationId, user } = await reviewContext()
  await requireFeaturePermission(user, destinationFeature(destination), "create")

  const [event] = await db
    .select()
    .from(gotoInboundEvents)
    .where(
      and(
        eq(gotoInboundEvents.id, eventId),
        eq(gotoInboundEvents.organizationId, organizationId),
        eq(gotoInboundEvents.status, "needs_review")
      )
    )
    .limit(1)
  if (!event) throw new Error("Inbound text is no longer awaiting review")

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!project) throw new Error("Project not found")

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
    const { env } = await getCloudflareContext()
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
    })
    if (result.kind !== "routed") {
      throw new Error("Compass could not route the reviewed text")
    }

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
    summary: "Dismissed an inbound text after administrative review.",
    metadata: { reviewedBy: user.id },
    createdAt: now,
  })
  revalidatePath("/dashboard/office-maintenance/inbound-email")
  revalidatePath("/dashboard/activity")
}
