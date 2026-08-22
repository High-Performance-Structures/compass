import { and, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import {
  organizationMembers,
  projectContacts,
  projectMembers,
  projects,
  users,
} from "@/db/schema"
import { channelMembers, channels } from "@/db/schema-conversations"
import type { AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  createNotificationEvent,
  type NotificationRecipientInput,
} from "@/lib/notifications/create-event"
import { channelMessageNotificationDelivery } from "@/lib/notifications/delivery"
import {
  channelNotificationRecipients,
  type ChannelMessageMention,
} from "@/lib/notifications/audience"
import { isInternalStaffRole } from "@/lib/user-roles"

export {
  createNotificationEvent,
  createStrictSystemNotificationEvent,
  createSystemNotificationEvent,
  isMissingNotificationTableError,
  queueSmsDelivery,
} from "@/lib/notifications/create-event"

type RfiNotificationInput = {
  readonly organizationId: string
  readonly projectId: string
  readonly rfiId: string
  readonly rfiNumber: string
  readonly subject: string
  readonly assignedToName: string | null
  readonly createdBy: AuthUser
}

type RfiUpdatedNotificationInput = {
  readonly organizationId: string
  readonly projectId: string
  readonly rfiId: string
  readonly rfiNumber: string
  readonly subject: string
  readonly status: string
  readonly requesterName: string | null
  readonly assignedToName: string | null
  readonly mentionedUserIds?: readonly string[]
  readonly updatedBy: AuthUser
}

type RfqResponseNotificationInput = {
  readonly organizationId: string
  readonly projectId: string
  readonly rfqId: string
  readonly rfqNumber: string | null
  readonly title: string
  readonly decision: "quote" | "decline"
  readonly amount: number | null
  readonly respondedBy: AuthUser
}

type ProjectAssignmentNotificationInput = {
  readonly organizationId: string
  readonly projectId: string
  readonly itemId: string
  readonly title: string
  readonly assignedToName: string | null
  readonly createdBy: AuthUser
  readonly kind: "task" | "schedule"
}

type ChannelMessageNotificationInput = {
  readonly organizationId: string
  readonly projectId: string | null
  readonly channelId: string
  readonly channelName: string
  readonly href?: string
  readonly messageId: string
  readonly threadId: string | null
  readonly content: string
  readonly sender: AuthUser
  readonly mentions: readonly ChannelMessageMention[]
}

type WarrantyCreatedNotificationInput = {
  readonly organizationId: string
  readonly projectId: string
  readonly claimId: string
  readonly claimNumber: string
  readonly title: string
  readonly priority: string
  readonly createdBy: AuthUser
}

type WarrantyUpdatedNotificationInput = {
  readonly organizationId: string
  readonly projectId: string
  readonly claimId: string
  readonly claimNumber: string
  readonly title: string
  readonly status: string
  readonly claimantUserId: string | null
  readonly updatedBy: AuthUser
}

function normalizeName(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

async function projectAssignmentRecipients(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  projectId: string,
  names: readonly (string | null)[]
): Promise<readonly NotificationRecipientInput[]> {
  const normalizedNames = new Set(
    names.map(normalizeName).filter((name) => name.length > 0)
  )
  if (normalizedNames.size === 0) return []

  const contacts = await db
    .select({
      displayName: projectContacts.displayName,
      companyName: projectContacts.companyName,
      email: projectContacts.email,
    })
    .from(projectContacts)
    .where(eq(projectContacts.projectId, projectId))
  const matchingEmails = new Set(
    contacts
      .filter((contact) => {
        const candidates = [
          contact.displayName,
          contact.companyName,
          contact.companyName
            ? `${contact.displayName} - ${contact.companyName}`
            : null,
        ].map(normalizeName)
        return candidates.some((candidate) =>
          normalizedNames.has(candidate)
        )
      })
      .map((contact) => contact.email?.trim().toLowerCase() ?? "")
      .filter((email) => email.length > 0)
  )

  const orgUsers = await db
    .select({
      id: users.id,
      email: users.email,
      googleEmail: users.googleEmail,
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
        eq(organizationMembers.organizationId, organizationId),
        eq(users.isActive, true)
      )
    )

  const recipients = new Map<string, NotificationRecipientInput>()
  for (const orgUser of orgUsers) {
    const primaryEmail = orgUser.email.trim().toLowerCase()
    const googleEmail =
      orgUser.googleEmail?.trim().toLowerCase() ?? null
    const candidates = [
      orgUser.displayName,
      [orgUser.firstName, orgUser.lastName]
        .filter((part) => part !== null)
        .join(" "),
      primaryEmail.split("@")[0] ?? "",
    ].map(normalizeName)
    const matchesName = candidates.some((candidate) =>
      normalizedNames.has(candidate)
    )
    const matchesEmail =
      matchingEmails.has(primaryEmail) ||
      (googleEmail !== null && matchingEmails.has(googleEmail))
    if (matchesName || matchesEmail) {
      recipients.set(orgUser.id, {
        userId: orgUser.id,
        email: googleEmail ?? primaryEmail,
      })
    }
  }

  return Array.from(recipients.values())
}

function notificationPreview(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim()
  if (compact.length <= 240) return compact
  return `${compact.slice(0, 237)}...`
}

export async function notifyChannelMessage(
  input: ChannelMessageNotificationInput
): Promise<void> {
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const members = await db
    .select({
      userId: channelMembers.userId,
      notifyLevel: channelMembers.notifyLevel,
      email: users.email,
      channelId: channels.id,
      channelAudience: channels.audience,
      channelIsPrivate: channels.isPrivate,
      channelProjectId: channels.projectId,
      channelDescription: channels.description,
    })
    .from(channelMembers)
    .innerJoin(users, eq(users.id, channelMembers.userId))
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(eq(channelMembers.channelId, input.channelId))

  const channel = members[0]
  if (!channel) return

  const recipients = channelNotificationRecipients(
    members,
    input.sender.id,
    input.mentions
  )

  if (recipients.length === 0) return

  const senderName =
    input.sender.displayName ?? input.sender.email
  await createNotificationEvent({
    organizationId: input.organizationId,
    projectId: input.projectId,
    eventType: input.threadId
      ? "message.thread_reply"
      : "message.channel",
    sourceType: "message",
    sourceId: input.messageId,
    title: input.threadId
      ? `${senderName} replied in ${input.channelName}`
      : `${senderName} in ${input.channelName}`,
    body: notificationPreview(input.content),
    href: input.href ?? `/dashboard/conversations/${input.channelId}`,
    priority: "normal",
    audience: "channel",
    createdBy: input.sender.id,
    recipients,
    delivery: channelMessageNotificationDelivery({
      id: channel.channelId,
      audience: channel.channelAudience,
      isPrivate: channel.channelIsPrivate,
      projectId: channel.channelProjectId,
      description: channel.channelDescription,
    }),
  })
}

export async function notifyRfiCreated(
  input: RfiNotificationInput
): Promise<void> {
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const project = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
    })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  const recipients = new Map<string, NotificationRecipientInput>()
  if (isInternalStaffRole(input.createdBy.role)) {
    recipients.set(input.createdBy.id, {
      userId: input.createdBy.id,
      email: input.createdBy.email,
    })
  }

  const assignedRecipients = await projectAssignmentRecipients(
    db,
    input.organizationId,
    input.projectId,
    [input.assignedToName]
  )
  for (const recipient of assignedRecipients) {
    recipients.set(recipient.userId, recipient)
  }

  const projectLabel = project?.projectNumber
    ? `${project.projectNumber} - ${project.name}`
    : project?.name ?? "Project"

  await createNotificationEvent({
    organizationId: input.organizationId,
    projectId: input.projectId,
    eventType: "rfi.created",
    sourceType: "rfi",
    sourceId: input.rfiId,
    title: `${input.rfiNumber}: ${input.subject}`,
    body: `New RFI created for ${projectLabel}${
      input.assignedToName ? ` and assigned to ${input.assignedToName}` : ""
    }.`,
    href: `/dashboard/projects/${input.projectId}/rfis`,
    priority: "normal",
    audience: "internal",
    createdBy: input.createdBy.id,
    recipients: Array.from(recipients.values()),
    delivery: {
      inApp: true,
      email: true,
      push: true,
    },
  })
}

export async function notifyRfiUpdated(
  input: RfiUpdatedNotificationInput
): Promise<void> {
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const assignmentRecipients = await projectAssignmentRecipients(
    db,
    input.organizationId,
    input.projectId,
    [input.requesterName, input.assignedToName]
  )
  const recipients = new Map<string, NotificationRecipientInput>()
  for (const recipient of assignmentRecipients) {
    if (recipient.userId !== input.updatedBy.id) {
      recipients.set(recipient.userId, recipient)
    }
  }
  const mentionedUserIds = Array.from(
    new Set(
      (input.mentionedUserIds ?? []).filter(
        (userId) => userId.length > 0 && userId !== input.updatedBy.id
      )
    )
  )
  if (mentionedUserIds.length > 0) {
    const mentionedUsers = await db
      .select({
        userId: users.id,
        email: users.email,
        googleEmail: users.googleEmail,
      })
      .from(users)
      .innerJoin(
        organizationMembers,
        and(
          eq(organizationMembers.userId, users.id),
          eq(organizationMembers.organizationId, input.organizationId)
        )
      )
      .where(and(inArray(users.id, mentionedUserIds), eq(users.isActive, true)))
    for (const mentionedUser of mentionedUsers) {
      recipients.set(mentionedUser.userId, {
        userId: mentionedUser.userId,
        email: mentionedUser.googleEmail?.trim() || mentionedUser.email,
      })
    }
  }
  if (recipients.size === 0) return

  await createNotificationEvent({
    organizationId: input.organizationId,
    projectId: input.projectId,
    eventType: "rfi.updated",
    sourceType: "rfi",
    sourceId: input.rfiId,
    title: `${input.rfiNumber}: ${input.subject}`,
    body: `${input.updatedBy.displayName ?? input.updatedBy.email} updated this RFI to ${input.status.replace(/_/g, " ")}.`,
    href: `/dashboard/projects/${input.projectId}/rfis?item=${encodeURIComponent(input.rfiId)}#rfi-${encodeURIComponent(input.rfiId)}`,
    priority: "normal",
    audience: "participants",
    createdBy: input.updatedBy.id,
    recipients: Array.from(recipients.values()),
    delivery: {
      inApp: true,
      email: true,
      push: true,
    },
  })
}

export async function notifyRfqResponseReceived(
  input: RfqResponseNotificationInput
): Promise<void> {
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const members = await db
    .select({
      userId: users.id,
      email: users.email,
      googleEmail: users.googleEmail,
      role: users.role,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(
      and(
        eq(projectMembers.projectId, input.projectId),
        eq(users.isActive, true)
      )
    )
  const recipients = members
    .filter(
      (member) =>
        member.userId !== input.respondedBy.id &&
        isInternalStaffRole(member.role)
    )
    .map((member) => ({
      userId: member.userId,
      email: member.googleEmail?.trim() || member.email,
    }))
  if (recipients.length === 0) return

  const responseLabel =
    input.decision === "decline"
      ? "declined the request"
      : `submitted a quote${
          input.amount === null
            ? ""
            : ` for ${new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
              }).format(input.amount)}`
        }`
  const responder = input.respondedBy.displayName ?? input.respondedBy.email
  await createNotificationEvent({
    organizationId: input.organizationId,
    projectId: input.projectId,
    eventType: "rfq.response_received",
    sourceType: "rfq",
    sourceId: input.rfqId,
    title: `${input.rfqNumber ?? "RFQ"}: ${input.title}`,
    body: `${responder} ${responseLabel}.`,
    href:
      `/dashboard/projects/${input.projectId}/rfqs?status=response_received` +
      `#rfq-${encodeURIComponent(input.rfqId)}`,
    priority: "normal",
    audience: "project_team",
    createdBy: input.respondedBy.id,
    recipients,
    delivery: { inApp: true, email: true, push: true },
  })
}

export async function notifyProjectAssignment(
  input: ProjectAssignmentNotificationInput
): Promise<void> {
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const recipients = (
    await projectAssignmentRecipients(
      db,
      input.organizationId,
      input.projectId,
      [input.assignedToName]
    )
  ).filter((recipient) => recipient.userId !== input.createdBy.id)
  if (recipients.length === 0) return

  const isSchedule = input.kind === "schedule"
  await createNotificationEvent({
    organizationId: input.organizationId,
    projectId: input.projectId,
    eventType: isSchedule ? "schedule.assigned" : "task.assigned",
    sourceType: isSchedule ? "schedule_item" : "task",
    sourceId: input.itemId,
    title: isSchedule
      ? `Schedule item assigned: ${input.title}`
      : `To-do assigned: ${input.title}`,
    body: `${input.createdBy.displayName ?? input.createdBy.email} assigned this to you.`,
    href: isSchedule
      ? `/dashboard/projects/${input.projectId}/schedule`
      : `/dashboard/projects/${input.projectId}`,
    priority: "normal",
    audience: "assignee",
    createdBy: input.createdBy.id,
    recipients,
    delivery: {
      inApp: true,
      email: true,
      push: true,
    },
  })
}

export async function notifyWarrantyClaimCreated(
  input: WarrantyCreatedNotificationInput
): Promise<void> {
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const members = await db
    .select({
      userId: users.id,
      email: users.email,
      googleEmail: users.googleEmail,
      role: users.role,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(
      and(
        eq(projectMembers.projectId, input.projectId),
        eq(users.isActive, true)
      )
    )
  const recipients = members
    .filter(
      (member) =>
        member.userId !== input.createdBy.id &&
        isInternalStaffRole(member.role)
    )
    .map((member) => ({
      userId: member.userId,
      email: member.googleEmail?.trim() || member.email,
    }))
  if (recipients.length === 0) return

  await createNotificationEvent({
    organizationId: input.organizationId,
    projectId: input.projectId,
    eventType: "warranty.created",
    sourceType: "warranty_claim",
    sourceId: input.claimId,
    title: `${input.claimNumber}: ${input.title}`,
    body: `${input.createdBy.displayName ?? input.createdBy.email} submitted a ${input.priority} priority warranty claim.`,
    href:
      `/dashboard/projects/${input.projectId}/warranty` +
      `#warranty-${encodeURIComponent(input.claimId)}`,
    priority: input.priority === "urgent" ? "high" : "normal",
    audience: "project_team",
    createdBy: input.createdBy.id,
    recipients,
    delivery: { inApp: true, email: true, push: true },
  })
}

export async function notifyWarrantyClaimUpdated(
  input: WarrantyUpdatedNotificationInput
): Promise<void> {
  if (!input.claimantUserId || input.claimantUserId === input.updatedBy.id) return
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const claimant = await db
    .select({
      userId: users.id,
      email: users.email,
      googleEmail: users.googleEmail,
    })
    .from(users)
    .where(and(eq(users.id, input.claimantUserId), eq(users.isActive, true)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!claimant) return

  await createNotificationEvent({
    organizationId: input.organizationId,
    projectId: input.projectId,
    eventType: "warranty.updated",
    sourceType: "warranty_claim",
    sourceId: input.claimId,
    title: `${input.claimNumber}: ${input.title}`,
    body: `Your warranty claim is now ${input.status.replace(/_/g, " ")}.`,
    href:
      `/preview/projects/${input.projectId}/owner/warranty` +
      `#warranty-${encodeURIComponent(input.claimId)}`,
    priority: "normal",
    audience: "claimant",
    createdBy: input.updatedBy.id,
    recipients: [
      {
        userId: claimant.userId,
        email: claimant.googleEmail?.trim() || claimant.email,
      },
    ],
    delivery: { inApp: true, email: true, push: true },
  })
}
