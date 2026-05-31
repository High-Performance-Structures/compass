import { and, eq, inArray, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  notificationDeliveries,
  notificationEvents,
  notificationPreferences,
  notificationRecipients,
  organizationMembers,
  projectContacts,
  projects,
  users,
} from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"

type NotificationPreferenceState = {
  readonly inAppEnabled: boolean
  readonly emailEnabled: boolean
  readonly pushEnabled: boolean
  readonly weeklyDigestEnabled: boolean
  readonly rfiEnabled: boolean
  readonly ownerUpdateEnabled: boolean
  readonly scheduleEnabled: boolean
  readonly poEnabled: boolean
}

type NotificationRecipientInput = {
  readonly userId: string
  readonly email: string
}

type CreateNotificationInput = {
  readonly organizationId: string
  readonly projectId: string | null
  readonly eventType: string
  readonly sourceType: string
  readonly sourceId: string | null
  readonly title: string
  readonly body: string
  readonly href: string
  readonly priority: string
  readonly audience: string
  readonly createdBy: string | null
  readonly recipients: readonly NotificationRecipientInput[]
}

type RfiNotificationInput = {
  readonly organizationId: string
  readonly projectId: string
  readonly rfiId: string
  readonly rfiNumber: string
  readonly subject: string
  readonly assignedToName: string | null
  readonly createdBy: AuthUser
}

const DEFAULT_PREFERENCES: NotificationPreferenceState = {
  inAppEnabled: true,
  emailEnabled: true,
  pushEnabled: true,
  weeklyDigestEnabled: false,
  rfiEnabled: true,
  ownerUpdateEnabled: true,
  scheduleEnabled: true,
  poEnabled: true,
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

export function isMissingNotificationTableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes("notification_") &&
    (message.includes("no such table") || message.includes("failed query"))
  )
}

function preferenceFromRow(
  row: typeof notificationPreferences.$inferSelect | null
): NotificationPreferenceState {
  if (!row) return DEFAULT_PREFERENCES
  return {
    inAppEnabled: row.inAppEnabled,
    emailEnabled: row.emailEnabled,
    pushEnabled: row.pushEnabled,
    weeklyDigestEnabled: row.weeklyDigestEnabled,
    rfiEnabled: row.rfiEnabled,
    ownerUpdateEnabled: row.ownerUpdateEnabled,
    scheduleEnabled: row.scheduleEnabled,
    poEnabled: row.poEnabled,
  }
}

function notificationCategoryEnabled(
  preferences: NotificationPreferenceState,
  eventType: string
): boolean {
  if (eventType.startsWith("rfi.")) return preferences.rfiEnabled
  if (eventType.startsWith("owner_update.")) return preferences.ownerUpdateEnabled
  if (eventType.startsWith("schedule.")) return preferences.scheduleEnabled
  if (eventType.startsWith("po.")) return preferences.poEnabled
  return true
}

function normalizeName(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function notificationEmailBody(input: CreateNotificationInput): string {
  return [
    input.title,
    "",
    input.body,
    "",
    `Open in Compass: ${input.href}`,
  ].join("\n")
}

async function sendResendEmail(
  env: unknown,
  toAddress: string,
  subject: string,
  body: string
): Promise<{
  readonly status: string
  readonly providerMessageId: string | null
  readonly error: string | null
}> {
  const apiKey = envString(env, "RESEND_API_KEY")
  if (!apiKey) {
    return {
      status: "pending_provider",
      providerMessageId: null,
      error: "RESEND_API_KEY is not configured",
    }
  }

  const fromAddress =
    envString(env, "COMPASS_EMAIL_FROM") ??
    "Compass <notifications@compass.build>"

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [toAddress],
      subject,
      text: body,
    }),
  })

  const responseText = await response.text()
  let providerMessageId: string | null = null
  try {
    const parsed = JSON.parse(responseText)
    if (isRecord(parsed) && typeof parsed.id === "string") {
      providerMessageId = parsed.id
    }
  } catch {
    providerMessageId = null
  }

  return {
    status: response.ok ? "sent" : "failed",
    providerMessageId,
    error: response.ok ? null : responseText.slice(0, 500),
  }
}

async function getPreferenceForUser(
  db: ReturnType<typeof getDb>,
  userId: string
): Promise<NotificationPreferenceState> {
  const row = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return preferenceFromRow(row)
}

export async function createNotificationEvent(
  input: CreateNotificationInput
): Promise<void> {
  const user = await requireAuth()
  const orgId = requireOrg(user)

  if (orgId !== input.organizationId) {
    throw new Error("Cannot create notifications outside the active organization")
  }

  if (input.createdBy !== user.id) {
    throw new Error("Cannot create notifications on behalf of another user")
  }

  const requestedRecipientIds = Array.from(
    new Set(input.recipients.map((recipient) => recipient.userId))
  )
  if (requestedRecipientIds.length === 0) return

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const now = new Date().toISOString()
  const eventId = crypto.randomUUID()

  const recipients = await db
    .select({
      userId: users.id,
      email: users.email,
      googleEmail: users.googleEmail,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, orgId),
        eq(users.isActive, true),
        inArray(organizationMembers.userId, requestedRecipientIds)
      )
    )

  if (recipients.length === 0) return

  try {
    await db.insert(notificationEvents).values({
      id: eventId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      eventType: input.eventType,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      title: input.title,
      body: input.body,
      href: input.href,
      priority: input.priority,
      audience: input.audience,
      createdBy: input.createdBy,
      createdAt: now,
    })

    for (const recipient of recipients) {
      const preferences = await getPreferenceForUser(db, recipient.userId)
      if (!notificationCategoryEnabled(preferences, input.eventType)) continue

      const recipientId = crypto.randomUUID()
      const emailEnabled = preferences.emailEnabled
      const inAppEnabled = preferences.inAppEnabled

      await db.insert(notificationRecipients).values({
        id: recipientId,
        eventId,
        userId: recipient.userId,
        inApp: inAppEnabled,
        email: emailEnabled,
        push: preferences.pushEnabled,
        readAt: null,
        dismissedAt: null,
        createdAt: now,
      })

      if (emailEnabled) {
        const delivery = await sendResendEmail(
          env,
          recipient.googleEmail ?? recipient.email,
          input.title,
          notificationEmailBody(input)
        )
        await db.insert(notificationDeliveries).values({
          id: crypto.randomUUID(),
          eventId,
          recipientId,
          userId: recipient.userId,
          channel: "email",
          status: delivery.status,
          toAddress: recipient.email,
          provider: "resend",
          providerMessageId: delivery.providerMessageId,
          error: delivery.error,
          attemptedAt: new Date().toISOString(),
          createdAt: now,
        })
      }
    }

    revalidatePath("/", "layout")
  } catch (error) {
    if (!isMissingNotificationTableError(error)) {
      throw error
    }
  }
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
  recipients.set(input.createdBy.id, {
    userId: input.createdBy.id,
    email: input.createdBy.email,
  })

  const assigned = normalizeName(input.assignedToName)
  if (assigned.length > 0) {
    const contacts = await db
      .select({
        displayName: projectContacts.displayName,
        companyName: projectContacts.companyName,
        email: projectContacts.email,
      })
      .from(projectContacts)
      .where(eq(projectContacts.projectId, input.projectId))

    const emails = contacts
      .filter((contact) => {
        const candidates = [
          contact.displayName,
          contact.companyName,
          contact.companyName
            ? `${contact.displayName} - ${contact.companyName}`
            : null,
        ].map(normalizeName)
        return candidates.includes(assigned)
      })
      .map((contact) => contact.email?.trim().toLowerCase() ?? "")
      .filter((email) => email.length > 0)

    if (emails.length > 0) {
      const matchedUsers = await db
        .select({
          id: users.id,
          email: users.email,
          googleEmail: users.googleEmail,
        })
        .from(users)
        .innerJoin(
          organizationMembers,
          eq(organizationMembers.userId, users.id)
        )
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            or(
              inArray(users.email, emails),
              inArray(users.googleEmail, emails)
            )
          )
        )

      for (const matchedUser of matchedUsers) {
        recipients.set(matchedUser.id, {
          userId: matchedUser.id,
          email: matchedUser.googleEmail ?? matchedUser.email,
        })
      }
    }
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
  })
}
