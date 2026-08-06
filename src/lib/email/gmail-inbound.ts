import "server-only"

import { and, eq, inArray, sql } from "drizzle-orm"

import { getDb } from "@/db"
import {
  emailReplyThreads,
  inboundEmails,
  organizationMembers,
  projectRfis,
  projects,
  users,
} from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import {
  channelMembers,
  channelReadState,
  channels,
  messages,
} from "@/db/schema-conversations"
import {
  COMPASS_GMAIL_READONLY_SCOPE,
  getCompassGmailAccessToken,
} from "@/lib/email/compass-email"
import {
  candidateFromMessage,
  escapeHtml,
  isGmailMessage,
  stripHtml,
  type InboundCandidate,
} from "@/lib/email/gmail-message-parser"
import { replyMailboxEmail } from "@/lib/email/reply-tracking"
import { isReplyMessage } from "@/lib/email/reply-detection"
import { canonicalRfiStatus } from "@/lib/rfis/status"

type Db = ReturnType<typeof getDb>

export type GmailInboundSyncSummary = {
  readonly scanned: number
  readonly imported: number
  readonly ignoredOutbound: number
  readonly posted: number
  readonly skippedDuplicates: number
  readonly skippedOtherOrganization: number
  readonly needsReview: number
  readonly errors: readonly string[]
}

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

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function isGmailListResponse(value: unknown): value is {
  readonly messages?: readonly { readonly id?: string }[]
  readonly nextPageToken?: string
} {
  if (!isRecord(value)) return false
  const messagesValue = value.messages
  const nextPageToken = value.nextPageToken
  return (
    (messagesValue === undefined || Array.isArray(messagesValue)) &&
    (nextPageToken === undefined || typeof nextPageToken === "string")
  )
}

function projectChannelName(project: {
  readonly projectNumber: string | null
  readonly name: string
}): string {
  const source = project.projectNumber ?? project.name
  const slug = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return `${slug.length > 0 ? slug : "project"}-team`
}

async function findSystemUser(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
}): Promise<string | null> {
  const preferredEmails = [
    envString(input.env, "COMPASS_INBOUND_USER_EMAIL"),
    "compass@hps-colorado.com",
    "jarvis@hps-colorado.com",
  ].filter((email): email is string => email !== null)

  if (preferredEmails.length > 0) {
    const [preferred] = await input.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(
        organizationMembers,
        eq(organizationMembers.userId, users.id)
      )
      .where(
        and(
          eq(organizationMembers.organizationId, input.organizationId),
          inArray(users.email, preferredEmails),
          eq(users.isActive, true)
        )
      )
      .limit(1)
    if (preferred) return preferred.id
  }

  const [fallback] = await input.db
    .select({ id: users.id })
    .from(users)
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .where(
      and(
        eq(organizationMembers.organizationId, input.organizationId),
        inArray(organizationMembers.role, ["admin", "owner", "office"]),
        eq(users.isActive, true)
      )
    )
    .limit(1)

  return fallback?.id ?? null
}

async function ensureProjectChannel(input: {
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly systemUserId: string
}): Promise<string | null> {
  const [project] = await input.db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1)
  if (!project || project.organizationId !== input.organizationId) return null

  const [existing] = await input.db
    .select({ id: channels.id })
    .from(channels)
    .where(
      and(
        eq(channels.organizationId, input.organizationId),
        eq(channels.projectId, input.projectId),
        eq(channels.type, "text"),
        eq(channels.isPrivate, false),
        eq(channels.audience, "staff"),
        sql`${channels.archivedAt} IS NULL`
      )
    )
    .orderBy(channels.createdAt)
    .limit(1)
  if (existing) return existing.id

  const now = new Date().toISOString()
  const channelId = crypto.randomUUID()
  await input.db.insert(channels).values({
    id: channelId,
    name: projectChannelName(project),
    type: "text",
    description: "Project staff conversation",
    organizationId: input.organizationId,
    projectId: input.projectId,
    categoryId: null,
    isPrivate: false,
    audience: "staff",
    createdBy: input.systemUserId,
    sortOrder: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  return channelId
}

async function ensureSystemMembership(input: {
  readonly db: Db
  readonly channelId: string
  readonly systemUserId: string
}): Promise<void> {
  const [existing] = await input.db
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, input.channelId),
        eq(channelMembers.userId, input.systemUserId)
      )
    )
    .limit(1)
  if (existing) return

  const now = new Date().toISOString()
  await input.db.insert(channelMembers).values({
    id: crypto.randomUUID(),
    channelId: input.channelId,
    userId: input.systemUserId,
    role: "member",
    notifyLevel: "mentions",
    joinedAt: now,
  })
  await input.db.insert(channelReadState).values({
    id: crypto.randomUUID(),
    userId: input.systemUserId,
    channelId: input.channelId,
    lastReadMessageId: null,
    lastReadAt: now,
    unreadCount: 0,
  })
}

function messageContent(candidate: InboundCandidate): string {
  const body =
    candidate.textBody ??
    (candidate.htmlBody ? stripHtml(candidate.htmlBody) : null) ??
    candidate.snippet ??
    "(No message body.)"

  return [
    `Email reply from ${candidate.fromName ?? candidate.fromAddress}`,
    `Subject: ${candidate.subject}`,
    "",
    body.trim(),
  ].join("\n")
}

function messageHtml(candidate: InboundCandidate): string {
  const body =
    candidate.textBody ??
    (candidate.htmlBody ? stripHtml(candidate.htmlBody) : null) ??
    candidate.snippet ??
    "(No message body.)"

  return `<div class="compass-email-reply">
  <p><strong>Email reply from ${escapeHtml(candidate.fromName ?? candidate.fromAddress)}</strong></p>
  <p><span style="color:#6b7280;">Subject:</span> ${escapeHtml(candidate.subject)}</p>
  <div style="white-space:pre-wrap;">${escapeHtml(body.trim())}</div>
</div>`
}

async function insertInboundAudit(input: {
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string | null
  readonly replyThreadId: string | null
  readonly candidate: InboundCandidate
  readonly matchedStatus: string
  readonly postedMessageId: string | null
  readonly importedAt: string
}): Promise<void> {
  await input.db
    .insert(inboundEmails)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      replyThreadId: input.replyThreadId,
      token: input.candidate.token,
      gmailMessageId: input.candidate.gmailMessageId,
      gmailThreadId: input.candidate.gmailThreadId,
      messageIdHeader: input.candidate.messageIdHeader,
      inReplyToHeader: input.candidate.inReplyToHeader,
      referencesHeader: input.candidate.referencesHeader,
      fromAddress: input.candidate.fromAddress,
      fromName: input.candidate.fromName,
      toAddress: input.candidate.toAddress,
      subject: input.candidate.subject,
      textBody: input.candidate.textBody,
      htmlBody: input.candidate.htmlBody,
      snippet: input.candidate.snippet,
      matchedStatus: input.matchedStatus,
      postedMessageId: input.postedMessageId,
      receivedAt: input.candidate.receivedAt,
      importedAt: input.importedAt,
    })
    .onConflictDoUpdate({
      target: inboundEmails.gmailMessageId,
      set: {
        projectId: input.projectId,
        replyThreadId: input.replyThreadId,
        matchedStatus: input.matchedStatus,
        postedMessageId: input.postedMessageId,
        importedAt: input.importedAt,
      },
    })
}

async function importCandidate(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly candidate: InboundCandidate
}): Promise<
  "duplicate" | "ignored_outbound" | "needs_review" | "other_org" | "posted"
> {
  const [duplicate] = await input.db
    .select({
      id: inboundEmails.id,
      matchedStatus: inboundEmails.matchedStatus,
    })
    .from(inboundEmails)
    .where(eq(inboundEmails.gmailMessageId, input.candidate.gmailMessageId))
    .limit(1)
  const retryMisclassifiedReply =
    duplicate?.matchedStatus === "ignored_outbound" &&
    isReplyMessage(input.candidate)
  if (duplicate && !retryMisclassifiedReply) return "duplicate"

  const replyThread = input.candidate.token
    ? await input.db
        .select()
        .from(emailReplyThreads)
        .where(eq(emailReplyThreads.token, input.candidate.token))
        .limit(1)
        .then((rows) => rows[0] ?? null)
    : null
  const now = new Date().toISOString()

  if (replyThread && replyThread.organizationId !== input.organizationId) {
    return "other_org"
  }

  // The generated mailto CCs Compass, so the original message also lands in
  // this mailbox with the tracking token. Only replies should enter Compass.
  if (replyThread && !isReplyMessage(input.candidate)) {
    await insertInboundAudit({
      db: input.db,
      organizationId: input.organizationId,
      projectId: replyThread.projectId,
      replyThreadId: replyThread.id,
      candidate: input.candidate,
      matchedStatus: "ignored_outbound",
      postedMessageId: null,
      importedAt: now,
    })
    return "ignored_outbound"
  }

  if (
    !replyThread ||
    !replyThread.projectId
  ) {
    await insertInboundAudit({
      db: input.db,
      organizationId: input.organizationId,
      projectId: replyThread?.projectId ?? null,
      replyThreadId: replyThread?.id ?? null,
      candidate: input.candidate,
      matchedStatus: "needs_review",
      postedMessageId: null,
      importedAt: now,
    })
    return "needs_review"
  }

  const systemUserId = await findSystemUser({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
  })
  if (!systemUserId) {
    await insertInboundAudit({
      db: input.db,
      organizationId: input.organizationId,
      projectId: replyThread.projectId,
      replyThreadId: replyThread.id,
      candidate: input.candidate,
      matchedStatus: "needs_review",
      postedMessageId: null,
      importedAt: now,
    })
    return "needs_review"
  }

  const channelId =
    replyThread.channelId ??
    (await ensureProjectChannel({
      db: input.db,
      organizationId: input.organizationId,
      projectId: replyThread.projectId,
      systemUserId,
    }))

  if (!channelId) {
    await insertInboundAudit({
      db: input.db,
      organizationId: input.organizationId,
      projectId: replyThread.projectId,
      replyThreadId: replyThread.id,
      candidate: input.candidate,
      matchedStatus: "needs_review",
      postedMessageId: null,
      importedAt: now,
    })
    return "needs_review"
  }
  await ensureSystemMembership({
    db: input.db,
    channelId,
    systemUserId,
  })

  const messageId = `email-${input.candidate.gmailMessageId}`
  const insertedMessages = await input.db
    .insert(messages)
    .values({
      id: messageId,
      channelId,
      threadId: null,
      userId: systemUserId,
      content: messageContent(input.candidate),
      contentHtml: messageHtml(input.candidate),
      editedAt: null,
      deletedAt: null,
      deletedBy: null,
      isPinned: false,
      replyCount: 0,
      lastReplyAt: null,
      createdAt: input.candidate.receivedAt,
    })
    .onConflictDoNothing({ target: messages.id })
    .returning({ id: messages.id })
  if (insertedMessages.length === 0) {
    await insertInboundAudit({
      db: input.db,
      organizationId: input.organizationId,
      projectId: replyThread.projectId,
      replyThreadId: replyThread.id,
      candidate: input.candidate,
      matchedStatus: "posted",
      postedMessageId: messageId,
      importedAt: now,
    })
    return "duplicate"
  }
  await input.db
    .update(channelReadState)
    .set({
      unreadCount: sql`${channelReadState.unreadCount} + 1`,
    })
    .where(
      and(
        eq(channelReadState.channelId, channelId),
        sql`${channelReadState.userId} != ${systemUserId}`
      )
    )
  await input.db
    .update(emailReplyThreads)
    .set({
      channelId,
      lastInboundAt: input.candidate.receivedAt,
      updatedAt: now,
    })
    .where(eq(emailReplyThreads.id, replyThread.id))
  if (replyThread.sourceType === "rfi") {
    const rfi = await input.db
      .select({ status: projectRfis.status })
      .from(projectRfis)
      .where(
        and(
          eq(projectRfis.id, replyThread.sourceId),
          eq(projectRfis.projectId, replyThread.projectId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (rfi && canonicalRfiStatus(rfi.status) === "new") {
      await input.db
        .update(projectRfis)
        .set({ status: "in_progress", updatedAt: now })
        .where(
          and(
            eq(projectRfis.id, replyThread.sourceId),
            eq(projectRfis.projectId, replyThread.projectId)
          )
        )
    }
  }
  await insertInboundAudit({
    db: input.db,
    organizationId: input.organizationId,
    projectId: replyThread.projectId,
    replyThreadId: replyThread.id,
    candidate: input.candidate,
    matchedStatus: "posted",
    postedMessageId: messageId,
    importedAt: now,
  })

  return "posted"
}

async function fetchJson(input: {
  readonly url: string
  readonly accessToken: string
}): Promise<unknown> {
  const response = await fetch(input.url, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
    },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Gmail request failed (${response.status}): ${text}`)
  }
  if (text.length === 0) return null
  return JSON.parse(text)
}

export async function syncGmailInboundReplies(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
}): Promise<GmailInboundSyncSummary> {
  const access = await getCompassGmailAccessToken({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
    scopes: [COMPASS_GMAIL_READONLY_SCOPE],
    sender: replyMailboxEmail(input.env),
  })
  if (!access.success) {
    return {
      scanned: 0,
      imported: 0,
      ignoredOutbound: 0,
      posted: 0,
      skippedDuplicates: 0,
      skippedOtherOrganization: 0,
      needsReview: 0,
      errors: [access.error],
    }
  }

  const query =
    envString(input.env, "COMPASS_GMAIL_INBOUND_QUERY") ?? "newer_than:30d cmp-"
  const maxResults = parsePositiveInt(
    envString(input.env, "COMPASS_GMAIL_INBOUND_MAX_RESULTS"),
    25
  )
  const maxPages = parsePositiveInt(
    envString(input.env, "COMPASS_GMAIL_INBOUND_MAX_PAGES"),
    20
  )

  const errors: string[] = []
  let scanned = 0
  let imported = 0
  let ignoredOutbound = 0
  let posted = 0
  let skippedDuplicates = 0
  let skippedOtherOrganization = 0
  let needsReview = 0

  try {
    const messageIds = new Set<string>()
    let pageToken: string | null = null
    for (let page = 0; page < maxPages; page += 1) {
      const listUrl = new URL(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages"
      )
      listUrl.searchParams.set("q", query)
      listUrl.searchParams.set("maxResults", String(maxResults))
      if (pageToken) listUrl.searchParams.set("pageToken", pageToken)
      const listResponse = await fetchJson({
        url: listUrl.toString(),
        accessToken: access.accessToken,
      })
      if (!isGmailListResponse(listResponse)) {
        throw new Error("Gmail returned an unexpected message list.")
      }
      for (const message of listResponse.messages ?? []) {
        if (message.id) messageIds.add(message.id)
      }
      pageToken = listResponse.nextPageToken ?? null
      if (!pageToken) break
    }

    scanned = messageIds.size

    for (const id of messageIds) {
      try {
        const messageUrl = new URL(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`
        )
        messageUrl.searchParams.set("format", "full")
        const messageResponse = await fetchJson({
          url: messageUrl.toString(),
          accessToken: access.accessToken,
        })
        if (!isGmailMessage(messageResponse)) {
          throw new Error(`Gmail returned an unexpected message for ${id}.`)
        }

        const result = await importCandidate({
          env: input.env,
          db: input.db,
          organizationId: input.organizationId,
          candidate: candidateFromMessage(messageResponse),
        })

        if (result === "duplicate") {
          skippedDuplicates += 1
        } else if (result === "ignored_outbound") {
          ignoredOutbound += 1
        } else if (result === "other_org") {
          skippedOtherOrganization += 1
        } else {
          imported += 1
          if (result === "posted") posted += 1
          if (result === "needs_review") needsReview += 1
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Failed ${id}`)
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Gmail sync failed")
  }

  return {
    scanned,
    imported,
    ignoredOutbound,
    posted,
    skippedDuplicates,
    skippedOtherOrganization,
    needsReview,
    errors,
  }
}

export async function listGoogleAuthOrganizationIds(input: {
  readonly db: Db
}): Promise<readonly string[]> {
  const rows = await input.db
    .select({ organizationId: googleAuth.organizationId })
    .from(googleAuth)
  return rows.map((row) => row.organizationId)
}
