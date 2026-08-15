import "server-only"

import { eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { projects } from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import type {
  InboundAttachment,
  InboundCandidate,
} from "@/lib/email/gmail-message-parser"
import { projectInboundEmailAddress } from "@/lib/email/project-address"
import { routeProjectInboundSms } from "@/lib/email/project-inbound-routing"
import { gotoAttachmentMimeType } from "@/lib/goto/mime-type"
import type { GotoInboundMessage } from "@/lib/goto/notification-parser"
import { getGotoAccessToken } from "@/lib/notifications/create-event"
import {
  MAX_PHOTO_UPLOAD_BATCH_BYTES,
  MAX_PHOTO_UPLOAD_FILE_BYTES,
} from "@/lib/photos/upload-limits"

type Db = ReturnType<typeof getDb>

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function projectForMessage(input: {
  readonly db: Db
  readonly organizationId: string
  readonly body: string
}): Promise<
  | { readonly kind: "found"; readonly id: string; readonly projectNumber: string }
  | { readonly kind: "missing" | "ambiguous" }
> {
  const rows = await input.db
    .select({ id: projects.id, projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.organizationId, input.organizationId))
  const matches = rows.flatMap((project) => {
    const projectNumber = project.projectNumber?.trim()
    if (!projectNumber) return []
    const pattern = new RegExp(
      `(^|[^a-z0-9])${regexEscape(projectNumber)}(?=$|[^a-z0-9])`,
      "i"
    )
    return pattern.test(input.body) ? [{ id: project.id, projectNumber }] : []
  })
  if (matches.length === 0) return { kind: "missing" }
  if (matches.length > 1) return { kind: "ambiguous" }
  const match = matches[0]
  return match ? { kind: "found", ...match } : { kind: "missing" }
}

export async function downloadGotoInboundAttachments(input: {
  readonly env: unknown
  readonly message: GotoInboundMessage
}): Promise<readonly InboundAttachment[]> {
  const declaredBytes = input.message.attachments.reduce(
    (total, attachment) => total + (attachment.size ?? 0),
    0
  )
  if (declaredBytes > MAX_PHOTO_UPLOAD_BATCH_BYTES) {
    throw new Error("Text attachments exceed the 90 MB batch limit.")
  }
  const oversized = input.message.attachments.find(
    (attachment) =>
      attachment.size !== null && attachment.size > MAX_PHOTO_UPLOAD_FILE_BYTES
  )
  if (oversized) throw new Error(`${oversized.name} exceeds the 50 MB file limit.`)

  const token = await getGotoAccessToken(input.env)
  if (!token.success) throw new Error(token.error)
  const attachments: InboundAttachment[] = []
  let actualBytes = 0
  for (const attachment of input.message.attachments) {
    const response = await fetch(
      `https://api.goto.com/messaging/v2/accounts/${encodeURIComponent(input.message.accountKey)}/attachments/${encodeURIComponent(attachment.attachmentId)}`,
      {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        redirect: "follow",
      }
    )
    if (!response.ok) {
      throw new Error(`GoTo attachment download failed (${response.status}).`)
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0")
    if (contentLength > MAX_PHOTO_UPLOAD_FILE_BYTES) {
      throw new Error(`${attachment.name} exceeds the 50 MB file limit.`)
    }
    const data = new Uint8Array(await response.arrayBuffer())
    if (data.byteLength > MAX_PHOTO_UPLOAD_FILE_BYTES) {
      throw new Error(`${attachment.name} exceeds the 50 MB file limit.`)
    }
    actualBytes += data.byteLength
    if (actualBytes > MAX_PHOTO_UPLOAD_BATCH_BYTES) {
      throw new Error("Text attachments exceed the 90 MB batch limit.")
    }
    const mimeType = gotoAttachmentMimeType({
      declaredType: attachment.contentType,
      responseType: response.headers.get("content-type"),
      fileName: attachment.name,
      data,
    })
    attachments.push({
      attachmentId: attachment.attachmentId,
      fileName: attachment.name,
      mimeType,
      size: data.byteLength,
      data,
    })
  }
  return attachments
}

export async function processGotoInboundMessage(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly message: GotoInboundMessage
}): Promise<{
  readonly projectId: string | null
  readonly status: "processed" | "needs_review"
  readonly reviewReason:
    | "missing_project"
    | "ambiguous_project"
    | "routing_review"
    | null
}> {
  const project = await projectForMessage({
    db: input.db,
    organizationId: input.organizationId,
    body: input.message.body,
  })
  if (project.kind !== "found") {
    console.warn("[goto-inbound] SMS needs review", {
      messageId: input.message.messageId,
      reason: project.kind,
    })
    const senderDigits = input.message.senderPhone.replace(/\D/g, "")
    const senderSuffix = senderDigits.slice(-4) || "unknown"
    await recordActivityEvent({
      db: input.db,
      id: `project-sms-review-${input.message.messageId}`,
      organizationId: input.organizationId,
      projectId: null,
      actor: {
        id: null,
        email: `sms:${input.message.senderPhone}`,
        displayName: `Text sender ending ${senderSuffix}`,
        firstName: null,
        lastName: null,
        role: "project_sms",
      },
      category: "conversation",
      action: "project_goto_sms.needs_review",
      entityType: "project_goto_sms",
      entityId: input.message.messageId,
      summary: "Incoming text message is awaiting project and destination review.",
      metadata: {
        reason: project.kind === "missing" ? "missing_project" : "ambiguous_project",
        bodyRetained: true,
        attachmentCount: input.message.attachments.length,
      },
      createdAt: input.message.receivedAt,
    })
    return {
      projectId: null,
      status: "needs_review",
      reviewReason:
        project.kind === "missing" ? "missing_project" : "ambiguous_project",
    }
  }
  const attachments = await downloadGotoInboundAttachments({
    env: input.env,
    message: input.message,
  })
  const firstLine = input.message.body.split(/\r?\n/, 1)[0]?.trim() ?? ""
  const subject = firstLine
    .replace(
      new RegExp(`(^|\\s)${regexEscape(project.projectNumber)}(?=\\s|$)`, "i"),
      " "
    )
    .replace(/\s{2,}/g, " ")
    .trim()
  const candidate: InboundCandidate = {
    gmailMessageId: input.message.messageId,
    gmailThreadId: input.message.conversationId,
    messageIdHeader: null,
    inReplyToHeader: null,
    referencesHeader: null,
    token: null,
    fromAddress: `sms:${input.message.senderPhone}`,
    fromName: null,
    toAddress: projectInboundEmailAddress(project.id),
    subject,
    textBody: input.message.body,
    htmlBody: null,
    snippet: input.message.body.slice(0, 240),
    receivedAt: input.message.receivedAt,
    attachments,
  }
  const result = await routeProjectInboundSms({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
    projectId: project.id,
    senderPhone: input.message.senderPhone,
    candidate,
  })
  return {
    projectId: project.id,
    status: result.kind === "needs_review" ? "needs_review" : "processed",
    reviewReason: result.kind === "needs_review" ? "routing_review" : null,
  }
}
