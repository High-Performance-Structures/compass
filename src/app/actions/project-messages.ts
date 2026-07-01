"use server"

import { and, eq, sql } from "drizzle-orm"

import { sendMessage } from "@/app/actions/chat-messages"
import { createNotificationEvent } from "@/lib/notifications/events"
import { getDb } from "@/db"
import {
  organizationMembers,
  projectContacts,
  projects,
  users,
} from "@/db/schema"
import {
  channelMembers,
  channelReadState,
  channels,
  type NewChannel,
} from "@/db/schema-conversations"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"

export type ProjectMessageRecipient =
  | { readonly kind: "channel" }
  | { readonly kind: "internal" }
  | { readonly kind: "owners" }
  | { readonly kind: "sub_vendors" }
  | { readonly kind: "contact"; readonly contactId: string }

type ProjectMessagePriority = "normal" | "high"

export type ProjectMessageResult =
  | {
      readonly success: true
      readonly data: {
        readonly messageId: string
        readonly recipientLabel: string
        readonly notifiedUserCount: number
        readonly unmatchedContactCount: number
      }
    }
  | { readonly success: false; readonly error: string }

type ContactRecipient = {
  readonly id: string
  readonly contactType: string
  readonly displayName: string
  readonly companyName: string | null
  readonly email: string | null
}

type UserRecipient = {
  readonly userId: string
  readonly email: string
}

export type ProjectConversationChannelResult =
  | {
      readonly success: true
      readonly data: {
        readonly channelId: string
        readonly created: boolean
      }
    }
  | { readonly success: false; readonly error: string }

function normalizeEmail(value: string | null): string | null {
  const email = value?.trim().toLowerCase()
  return email && email.length > 0 ? email : null
}

function recipientLabel(recipient: ProjectMessageRecipient): string {
  switch (recipient.kind) {
    case "channel":
      return "Project channel"
    case "internal":
      return "Internal team"
    case "owners":
      return "Owner team"
    case "sub_vendors":
      return "Subs/vendors"
    case "contact":
      return "Selected contact"
  }
}

function contactLabel(contact: ContactRecipient): string {
  if (contact.companyName && contact.companyName !== contact.displayName) {
    return `${contact.displayName} at ${contact.companyName}`
  }
  return contact.displayName
}

function channelSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)

  return slug.length > 0 ? slug : "project"
}

function projectChannelName(project: {
  readonly projectNumber: string | null
  readonly name: string
}): string {
  const source = project.projectNumber ?? project.name
  return `${channelSlug(source)}-team`
}

async function ensureProjectChannelMembership(
  db: ReturnType<typeof getDb>,
  channelId: string,
  userId: string
): Promise<void> {
  const existing = await db
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.userId, userId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (existing) return

  const now = new Date().toISOString()
  await db.insert(channelMembers).values({
    id: crypto.randomUUID(),
    channelId,
    userId,
    role: "member",
    notifyLevel: "all",
    joinedAt: now,
  })
  await db.insert(channelReadState).values({
    id: crypto.randomUUID(),
    userId,
    channelId,
    lastReadMessageId: null,
    lastReadAt: now,
    unreadCount: 0,
  })
}

function selectContacts(
  contacts: readonly ContactRecipient[],
  recipient: ProjectMessageRecipient
): readonly ContactRecipient[] {
  switch (recipient.kind) {
    case "channel":
      return []
    case "internal":
      return contacts.filter((contact) => contact.contactType === "internal")
    case "owners":
      return contacts.filter((contact) => contact.contactType === "owner")
    case "sub_vendors":
      return contacts.filter(
        (contact) =>
          contact.contactType === "supplier" ||
          contact.contactType === "subcontractor"
      )
    case "contact":
      return contacts.filter((contact) => contact.id === recipient.contactId)
  }
}

async function matchUsersByContactEmail(
  organizationId: string,
  contacts: readonly ContactRecipient[]
): Promise<readonly UserRecipient[]> {
  const emails = new Set<string>()
  for (const contact of contacts) {
    const email = normalizeEmail(contact.email)
    if (email) emails.add(email)
  }
  if (emails.size === 0) return []

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const orgUsers = await db
    .select({
      userId: users.id,
      email: users.email,
      googleEmail: users.googleEmail,
    })
    .from(users)
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, organizationId))

  const matches = new Map<string, UserRecipient>()
  for (const orgUser of orgUsers) {
    const primaryEmail = normalizeEmail(orgUser.email)
    const googleEmail = normalizeEmail(orgUser.googleEmail)
    const matchedEmail =
      primaryEmail && emails.has(primaryEmail)
        ? primaryEmail
        : googleEmail && emails.has(googleEmail)
          ? googleEmail
          : null
    if (matchedEmail) {
      matches.set(orgUser.userId, {
        userId: orgUser.userId,
        email: matchedEmail,
      })
    }
  }

  return Array.from(matches.values())
}

export async function sendProjectMessage(input: {
  readonly channelId: string
  readonly content: string
  readonly recipient: ProjectMessageRecipient
  readonly priority?: ProjectMessagePriority
  readonly mentions?: readonly {
    readonly mentionType: "user" | "channel" | "here" | "agent"
    readonly targetId: string | null
  }[]
  readonly attachments?: readonly {
    readonly fileName: string
    readonly mimeType: string
    readonly fileSize: number
    readonly driveFileId: string
    readonly driveUrl: string | null
    readonly downloadUrl: string
  }[]
}): Promise<ProjectMessageResult> {
  try {
    const user = await requireAuth()
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const channel = await db
      .select({
        id: channels.id,
        name: channels.name,
        organizationId: channels.organizationId,
        projectId: channels.projectId,
      })
      .from(channels)
      .where(eq(channels.id, input.channelId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!channel || channel.organizationId !== organizationId) {
      return { success: false, error: "Channel not found" }
    }
    if (!channel.projectId) {
      return { success: false, error: "Choose a project channel first" }
    }

    const sent = await sendMessage({
      channelId: input.channelId,
      content: input.content,
      mentions:
        input.mentions && input.mentions.length > 0
          ? Array.from(input.mentions)
          : undefined,
      attachments: input.attachments,
    })

    if (!sent.success) {
      return { success: false, error: sent.error ?? "Failed to send message" }
    }
    if (!sent.data) {
      return { success: false, error: "Message was sent but not returned" }
    }

    const rawContacts = await db
      .select({
        id: projectContacts.id,
        contactType: projectContacts.contactType,
        displayName: projectContacts.displayName,
        companyName: projectContacts.companyName,
        email: projectContacts.email,
      })
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.projectId, channel.projectId),
          eq(projectContacts.active, true)
        )
      )

    const contacts = rawContacts.map((contact) => ({
      id: contact.id,
      contactType: contact.contactType,
      displayName: contact.displayName,
      companyName: contact.companyName,
      email: contact.email,
    }))
    const selectedContacts = selectContacts(contacts, input.recipient)
    const matchedUsers = await matchUsersByContactEmail(
      organizationId,
      selectedContacts
    )

    const project = await db
      .select({
        name: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(projects)
      .where(eq(projects.id, channel.projectId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    const selectedContactNames = selectedContacts.map(contactLabel)
    const label =
      input.recipient.kind === "contact" && selectedContactNames.length === 1
        ? selectedContactNames[0]
        : recipientLabel(input.recipient)
    const projectLabel = project?.projectNumber
      ? `${project.projectNumber} - ${project.name}`
      : project?.name ?? channel.name
    const priority = input.priority === "high" ? "high" : "normal"
    const importantPrefix = priority === "high" ? "Important: " : ""

    await createNotificationEvent({
      organizationId,
      projectId: channel.projectId,
      eventType: "message.project",
      sourceType: "message",
      sourceId: sent.data.id,
      title: `${importantPrefix}New Compass message for ${projectLabel}`,
      body: `${importantPrefix}${user.displayName ?? user.email} sent a project message to ${label}.`,
      href: `/dashboard/conversations/${input.channelId}`,
      priority,
      audience: input.recipient.kind,
      createdBy: user.id,
      recipients: matchedUsers,
    })

    return {
      success: true,
      data: {
        messageId: sent.data.id,
        recipientLabel: label,
        notifiedUserCount: matchedUsers.length,
        unmatchedContactCount: Math.max(
          selectedContacts.length - matchedUsers.length,
          0
        ),
      },
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to send project message",
    }
  }
}

export async function openProjectConversationChannel(
  projectId: string
): Promise<ProjectConversationChannelResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "channels", "read")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await assertProjectAccess(db, user, projectId)

    const project = await db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        organizationId: projects.organizationId,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!project || project.organizationId !== organizationId) {
      return { success: false, error: "Project not found" }
    }

    const existing = await db
      .select({ id: channels.id })
      .from(channels)
      .where(
        and(
          eq(channels.organizationId, organizationId),
          eq(channels.projectId, projectId),
          eq(channels.type, "text"),
          sql`${channels.archivedAt} IS NULL`
        )
      )
      .orderBy(channels.createdAt)
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (existing) {
      await ensureProjectChannelMembership(db, existing.id, user.id)
      return {
        success: true,
        data: { channelId: existing.id, created: false },
      }
    }

    requirePermission(user, "channels", "create")

    const now = new Date().toISOString()
    const channelId = crypto.randomUUID()
    const newChannel: NewChannel = {
      id: channelId,
      name: projectChannelName(project),
      type: "text",
      description: "Project staff conversation",
      organizationId,
      projectId,
      categoryId: null,
      isPrivate: false,
      audience: "staff",
      createdBy: user.id,
      sortOrder: 0,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    await db.insert(channels).values(newChannel)
    await ensureProjectChannelMembership(db, channelId, user.id)

    return {
      success: true,
      data: { channelId, created: true },
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to open project conversation",
    }
  }
}
