import "server-only"

import { emailReplyThreads } from "@/db/schema"
import type { getDb } from "@/db"

const DEFAULT_REPLY_MAILBOX = "jarvis@hps-colorado.com"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function envString(env: unknown, key: string): string | null {
  if (!isRecord(env)) return process.env[key] ?? null
  const value = env[key]
  return typeof value === "string" && value.trim().length > 0
    ? value
    : process.env[key] ?? null
}

function splitEmailAddress(email: string): {
  readonly localPart: string
  readonly domain: string
} | null {
  const trimmed = email.trim()
  const atIndex = trimmed.lastIndexOf("@")
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return null
  return {
    localPart: trimmed.slice(0, atIndex),
    domain: trimmed.slice(atIndex + 1),
  }
}

export function createReplyToken(): string {
  return `cmp-${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`
}

export function replyMailboxEmail(env: unknown): string {
  const mailbox = envString(env, "COMPASS_REPLY_MAILBOX") ?? DEFAULT_REPLY_MAILBOX
  const parts = splitEmailAddress(mailbox) ?? splitEmailAddress(DEFAULT_REPLY_MAILBOX)
  return parts ? `${parts.localPart}@${parts.domain}` : DEFAULT_REPLY_MAILBOX
}

export function trackedReplyAddress(input: {
  readonly env: unknown
  readonly token: string
}): string {
  const parts = splitEmailAddress(replyMailboxEmail(input.env))
  if (!parts) return DEFAULT_REPLY_MAILBOX

  return `Compass <${parts.localPart}+${input.token}@${parts.domain}>`
}

export function appendReplyTokenText(input: {
  readonly body: string
  readonly token: string
}): string {
  return `${input.body}

--
Replying to this email will attach your response to Compass.
Compass reply token: ${input.token}`
}

export function appendReplyTokenHtml(input: {
  readonly html: string
  readonly token: string
}): string {
  return `${input.html}
<p style="margin-top:24px;color:#6b7280;font-size:12px;line-height:1.5;border-top:1px solid #e5e7eb;padding-top:12px;">
  Replying to this email will attach your response to Compass.<br>
  Compass reply token: ${input.token}
</p>`
}

export async function createEmailReplyThread(input: {
  readonly env: unknown
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly projectId: string | null
  readonly channelId?: string | null
  readonly sourceType: string
  readonly sourceId: string
  readonly sourceNumber: string | null
  readonly subject: string
  readonly createdBy: string | null
}): Promise<{
  readonly id: string
  readonly token: string
  readonly replyToAddress: string
}> {
  const id = crypto.randomUUID()
  const token = createReplyToken()
  const replyToAddress = trackedReplyAddress({ env: input.env, token })
  const now = new Date().toISOString()

  await input.db.insert(emailReplyThreads).values({
    id,
    token,
    organizationId: input.organizationId,
    projectId: input.projectId,
    channelId: input.channelId ?? null,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceNumber: input.sourceNumber,
    replyToAddress,
    subject: input.subject,
    status: "active",
    createdBy: input.createdBy,
    lastInboundAt: null,
    createdAt: now,
    updatedAt: now,
  })

  return { id, token, replyToAddress }
}
