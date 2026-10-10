"use server"

import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  gotoInboundEvents,
  organizations,
  organizationMembers,
  staffMessageEvents,
  staffMessageRecords,
  users,
} from "@/db/schema"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  buildGotoStaffMessageDraft,
  buildStaffMessageAssignmentNotification,
  isEligibleStaffMessageAssignee,
  isStaffMessageDeskUser,
  type StaffMessageDeskUser,
} from "@/lib/staff-message-desk"
import { createNotificationEvent } from "@/lib/notifications/create-event"
import { requireOrg } from "@/lib/org-scope"
import { canManageProjectRegistry } from "@/lib/permissions"
import {
  STAFF_MESSAGE_STATUS_LABEL,
  isStaffMessageStatus,
  staffMessageStatus,
  type StaffMessageStatus,
} from "@/lib/staff-message-desk/triage"

const MESSAGE_DESK_PATH = "/dashboard/office-maintenance/message-desk"

type ActionFailure = { readonly success: false; readonly error: string }
type ActionSuccess<T> = { readonly success: true; readonly data: T }
type ActionResult<T> = ActionFailure | ActionSuccess<T>

type StaffDeskUserRow = {
  readonly id: string
  readonly email: string
  readonly firstName: string | null
  readonly lastName: string | null
  readonly displayName: string | null
  readonly isActive: boolean
  readonly memberRole: string
}

export type StaffMessageDeskRecordDto = Readonly<{
  readonly id: string
  readonly sourceType: "call" | "message"
  readonly gotoInboundEventId: string | null
  readonly callerName: string
  readonly callerCompany: string | null
  readonly callerPhone: string | null
  readonly callerEmail: string | null
  readonly subject: string
  readonly body: string
  readonly assigneeUserId: string
  readonly assigneeName: string
  readonly createdBy: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly status: StaffMessageStatus
  /** Last status change, note or reassignment (falls back to updatedAt). */
  readonly lastActivityAt: string
  readonly resolvedAt: string | null
  readonly history: readonly StaffMessageEventDto[]
}>

export type StaffMessageEventDto = Readonly<{
  readonly id: string
  readonly actorName: string
  readonly eventType: string
  readonly fromStatus: string | null
  readonly toStatus: string | null
  readonly note: string | null
  readonly createdAt: string
}>

export type StaffMessageAssigneeDto = Readonly<{
  readonly id: string
  readonly name: string
  readonly email: string
}>

export type StaffMessageInboundTextDto = Readonly<{
  readonly id: string
  readonly senderPhone: string
  readonly messageBody: string | null
  readonly receivedAt: string
}>

export type StaffMessageDeskData = Readonly<{
  readonly viewerId: string
  readonly records: readonly StaffMessageDeskRecordDto[]
  readonly assignees: readonly StaffMessageAssigneeDto[]
  readonly inboundTexts: readonly StaffMessageInboundTextDto[]
}>

function failure(error: unknown): ActionFailure {
  return {
    success: false,
    error: error instanceof Error ? error.message : "Staff message action failed",
  }
}

function value(formData: FormData, key: string): string | null {
  const candidate = formData.get(key)
  if (typeof candidate !== "string") return null
  const trimmed = candidate.trim()
  return trimmed.length > 0 ? trimmed : null
}

function requiredValue(formData: FormData, key: string): string {
  const candidate = value(formData, key)
  if (!candidate) throw new Error(`${key} is required`)
  return candidate
}

function deskUser(user: {
  readonly id: string
  readonly isActive: boolean
  readonly organizationId: string | null
  readonly organizationType: string | null
  readonly role: string
}): StaffMessageDeskUser {
  return {
    id: user.id,
    isActive: user.isActive,
    organizationId: user.organizationId,
    organizationType: user.organizationType,
    role: user.role,
  }
}

async function staffMessageContext(): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly user: AuthUser
}> {
  const user = await requireAuth()
  if (!isStaffMessageDeskUser(deskUser(user))) {
    throw new Error("Staff Message Desk access is restricted to active internal staff")
  }
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const organization = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, organizationId),
        eq(organizations.type, "internal"),
        eq(organizations.isActive, true)
      )
    )
    .get()
  if (!organization) throw new Error("Active internal organization is required")
  return { db, organizationId, user }
}

async function staffReviewContext(): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly user: AuthUser
}> {
  const context = await staffMessageContext()
  if (!canManageProjectRegistry(context.user)) {
    throw new Error("Project administration permission is required")
  }
  return context
}

function displayName(row: Pick<StaffDeskUserRow, "displayName" | "firstName" | "lastName" | "email">): string {
  const named = row.displayName?.trim()
  if (named) return named
  const fullName = [row.firstName, row.lastName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim()
  return fullName || row.email
}

async function assigneeFor(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  creatorUserId: string,
  assigneeUserId: string
): Promise<StaffDeskUserRow> {
  const row = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      displayName: users.displayName,
      isActive: users.isActive,
      memberRole: organizationMembers.role,
    })
    .from(users)
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(users.id, assigneeUserId),
        ne(users.id, creatorUserId),
        eq(users.isActive, true),
        eq(organizationMembers.organizationId, organizationId),
        eq(organizations.type, "internal"),
        eq(organizations.isActive, true)
      )
    )
    .get()
  if (!row) throw new Error("Choose one other active internal staff member")
  if (
    !isEligibleStaffMessageAssignee(
      deskUser({
        id: row.id,
        isActive: row.isActive,
        organizationId,
        organizationType: "internal",
        role: row.memberRole,
      }),
      organizationId,
      creatorUserId
    )
  ) {
    throw new Error("Assignee must be another active internal staff member")
  }
  return row
}

async function activeAssignees(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  creatorUserId: string
): Promise<readonly StaffMessageAssigneeDto[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      displayName: users.displayName,
      isActive: users.isActive,
      memberRole: organizationMembers.role,
    })
    .from(users)
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        ne(users.id, creatorUserId),
        eq(users.isActive, true),
        eq(organizationMembers.organizationId, organizationId),
        eq(organizations.type, "internal"),
        eq(organizations.isActive, true)
      )
    )
    .orderBy(asc(users.displayName), asc(users.email))
  return rows
    .filter((row) =>
      isEligibleStaffMessageAssignee(
        deskUser({
          id: row.id,
          isActive: row.isActive,
          organizationId,
          organizationType: "internal",
          role: row.memberRole,
        }),
        organizationId,
        creatorUserId
      )
    )
    .map((row) => ({ id: row.id, name: displayName(row), email: row.email }))
}

export async function getStaffMessageAssignees(): Promise<
  ActionResult<readonly StaffMessageAssigneeDto[]>
> {
  try {
    const { db, organizationId, user } = await staffMessageContext()
    return {
      success: true,
      data: await activeAssignees(db, organizationId, user.id),
    }
  } catch (error) {
    return failure(error)
  }
}

async function notifyAssignment(input: {
  readonly organizationId: string
  readonly recordId: string
  readonly subject: string
  readonly assignee: StaffDeskUserRow
  readonly actor: AuthUser
}): Promise<void> {
  const notification = buildStaffMessageAssignmentNotification({
    organizationId: input.organizationId,
    recordId: input.recordId,
    subject: input.subject,
    assigneeUserId: input.assignee.id,
  })
  await createNotificationEvent({
    organizationId: notification.organizationId,
    projectId: null,
    eventType: "staff_message.assigned",
    sourceType: "staff_message_record",
    sourceId: notification.recordId,
    title: notification.title,
    body: `${input.actor.displayName ?? input.actor.email} assigned this message to you.`,
    href: notification.href,
    priority: "normal",
    audience: "assignee",
    createdBy: input.actor.id,
    recipients: [{ userId: input.assignee.id, email: input.assignee.email }],
    delivery: { inApp: true, email: false, push: false },
  })
}

function sourceType(valueToCheck: string): "call" | "message" {
  if (valueToCheck === "call" || valueToCheck === "message") return valueToCheck
  throw new Error("Source type must be call or message")
}

export async function getStaffMessageDesk(): Promise<ActionResult<StaffMessageDeskData>> {
  try {
    const { db, organizationId, user } = await staffMessageContext()
    const rows = await db
      .select({
        id: staffMessageRecords.id,
        sourceType: staffMessageRecords.sourceType,
        gotoInboundEventId: staffMessageRecords.gotoInboundEventId,
        callerName: staffMessageRecords.callerName,
        callerCompany: staffMessageRecords.callerCompany,
        callerPhone: staffMessageRecords.callerPhone,
        callerEmail: staffMessageRecords.callerEmail,
        subject: staffMessageRecords.subject,
        body: staffMessageRecords.body,
        assigneeUserId: staffMessageRecords.assigneeUserId,
        createdBy: staffMessageRecords.createdBy,
        createdAt: staffMessageRecords.createdAt,
        updatedAt: staffMessageRecords.updatedAt,
        status: staffMessageRecords.status,
        lastActivityAt: staffMessageRecords.lastActivityAt,
        resolvedAt: staffMessageRecords.resolvedAt,
        assigneeDisplayName: users.displayName,
        assigneeFirstName: users.firstName,
        assigneeLastName: users.lastName,
        assigneeEmail: users.email,
      })
      .from(staffMessageRecords)
      .innerJoin(users, eq(users.id, staffMessageRecords.assigneeUserId))
      .where(eq(staffMessageRecords.organizationId, organizationId))
      .orderBy(desc(staffMessageRecords.updatedAt))
    const inboundRows = await db
      .select({
        id: gotoInboundEvents.id,
        senderPhone: gotoInboundEvents.senderPhone,
        messageBody: gotoInboundEvents.messageBody,
        receivedAt: gotoInboundEvents.receivedAt,
      })
      .from(gotoInboundEvents)
      .leftJoin(
        staffMessageRecords,
        eq(staffMessageRecords.gotoInboundEventId, gotoInboundEvents.id)
      )
      .where(
        and(
          eq(gotoInboundEvents.organizationId, organizationId),
          eq(gotoInboundEvents.status, "needs_review"),
          isNull(staffMessageRecords.id)
        )
      )
      .orderBy(desc(gotoInboundEvents.receivedAt))
    const events = rows.length
      ? await db
          .select({
            id: staffMessageEvents.id,
            messageId: staffMessageEvents.messageId,
            actorName: staffMessageEvents.actorName,
            eventType: staffMessageEvents.eventType,
            fromStatus: staffMessageEvents.fromStatus,
            toStatus: staffMessageEvents.toStatus,
            note: staffMessageEvents.note,
            createdAt: staffMessageEvents.createdAt,
          })
          .from(staffMessageEvents)
          .where(eq(staffMessageEvents.organizationId, organizationId))
          .orderBy(asc(staffMessageEvents.createdAt))
      : []
    const historyByMessage = new Map<string, StaffMessageEventDto[]>()
    for (const event of events) {
      const list = historyByMessage.get(event.messageId) ?? []
      list.push({
        id: event.id,
        actorName: event.actorName,
        eventType: event.eventType,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        note: event.note,
        createdAt: event.createdAt,
      })
      historyByMessage.set(event.messageId, list)
    }
    return {
      success: true,
      data: {
        viewerId: user.id,
        records: rows.map((row) => ({
          id: row.id,
          sourceType: sourceType(row.sourceType),
          gotoInboundEventId: row.gotoInboundEventId,
          callerName: row.callerName,
          callerCompany: row.callerCompany,
          callerPhone: row.callerPhone,
          callerEmail: row.callerEmail,
          subject: row.subject,
          body: row.body,
          assigneeUserId: row.assigneeUserId,
          assigneeName: displayName({
            displayName: row.assigneeDisplayName,
            firstName: row.assigneeFirstName,
            lastName: row.assigneeLastName,
            email: row.assigneeEmail,
          }),
          createdBy: row.createdBy,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          status: staffMessageStatus(row.status),
          lastActivityAt: row.lastActivityAt ?? row.updatedAt,
          resolvedAt: row.resolvedAt,
          history: historyByMessage.get(row.id) ?? [],
        })),
        assignees: await activeAssignees(db, organizationId, user.id),
        inboundTexts: inboundRows.map((row) => ({
          id: row.id,
          senderPhone: row.senderPhone,
          messageBody: row.messageBody,
          receivedAt: row.receivedAt,
        })),
      },
    }
  } catch (error) {
    return failure(error)
  }
}

async function insertStaffMessage(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly user: AuthUser
  readonly assignee: StaffDeskUserRow
  readonly sourceType: "call" | "message"
  readonly gotoInboundEventId: string | null
  readonly callerName: string
  readonly callerCompany: string | null
  readonly callerPhone: string | null
  readonly callerEmail: string | null
  readonly subject: string
  readonly body: string
}): Promise<string> {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  await input.db.insert(staffMessageRecords).values({
    id,
    organizationId: input.organizationId,
    sourceType: input.sourceType,
    gotoInboundEventId: input.gotoInboundEventId,
    callerName: input.callerName,
    callerCompany: input.callerCompany,
    callerPhone: input.callerPhone,
    callerEmail: input.callerEmail,
    subject: input.subject,
    body: input.body,
    assigneeUserId: input.assignee.id,
    createdBy: input.user.id,
    createdAt: now,
    updatedAt: now,
  })
  try {
    await notifyAssignment({
      organizationId: input.organizationId,
      recordId: id,
      subject: input.subject,
      assignee: input.assignee,
      actor: input.user,
    })
  } catch (error) {
    console.error("[staff-message-desk] assignment notification error", error)
  }
  return id
}

export async function createStaffMessage(
  formData: FormData
): Promise<ActionResult<{ readonly id: string }>> {
  try {
    const { db, organizationId, user } = await staffMessageContext()
    const assignee = await assigneeFor(
      db,
      organizationId,
      user.id,
      requiredValue(formData, "assigneeUserId")
    )
    const id = await insertStaffMessage({
      db,
      organizationId,
      user,
      assignee,
      sourceType: sourceType(requiredValue(formData, "sourceType")),
      gotoInboundEventId: null,
      callerName: requiredValue(formData, "callerName"),
      callerCompany: value(formData, "callerCompany"),
      callerPhone: value(formData, "callerPhone"),
      callerEmail: value(formData, "callerEmail"),
      subject: requiredValue(formData, "subject"),
      body: requiredValue(formData, "body"),
    })
    revalidatePath(MESSAGE_DESK_PATH)
    return { success: true, data: { id } }
  } catch (error) {
    return failure(error)
  }
}

export async function routeGotoTextToMessageDesk(
  formData: FormData
): Promise<ActionResult<{ readonly id: string }>> {
  try {
    const { db, organizationId, user } = await staffReviewContext()
    const eventId = requiredValue(formData, "eventId")
    const assignee = await assigneeFor(
      db,
      organizationId,
      user.id,
      requiredValue(formData, "assigneeUserId")
    )
    const event = await db
      .select({
        id: gotoInboundEvents.id,
        senderPhone: gotoInboundEvents.senderPhone,
        messageBody: gotoInboundEvents.messageBody,
      })
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
    const draft = buildGotoStaffMessageDraft({
      eventId: event.id,
      senderPhone: event.senderPhone,
      messageBody: event.messageBody,
      assigneeUserId: assignee.id,
    })
    const id = await insertStaffMessage({
      db,
      organizationId,
      user,
      assignee,
      sourceType: draft.sourceType,
      gotoInboundEventId: draft.gotoInboundEventId,
      callerName: draft.callerName,
      callerCompany: null,
      callerPhone: draft.callerPhone,
      callerEmail: null,
      subject: draft.subject,
      body: draft.body,
    })
    revalidatePath(MESSAGE_DESK_PATH)
    revalidatePath("/dashboard/office-maintenance/inbound-email")
    return { success: true, data: { id } }
  } catch (error) {
    return failure(error)
  }
}

export async function submitCreateStaffMessage(formData: FormData): Promise<void> {
  await createStaffMessage(formData)
}

export async function submitRouteGotoTextToMessageDesk(
  formData: FormData
): Promise<void> {
  await routeGotoTextToMessageDesk(formData)
}

const MAX_TRIAGE_BATCH = 100

/**
 * Updates one or more Message Desk records: change status, reassign to another
 * staff member, and/or add a note. Every change is recorded in the message's
 * history and counts as activity, which resets its aging flag.
 */
export async function updateStaffMessages(input: {
  readonly ids: readonly string[]
  readonly status?: string | null
  readonly assigneeUserId?: string | null
  readonly note?: string | null
}): Promise<ActionResult<{ readonly updated: number }>> {
  try {
    const { db, organizationId, user } = await staffMessageContext()
    const ids = [...new Set(input.ids.map((id) => id.trim()).filter((id) => id.length > 0))]
    if (ids.length === 0) throw new Error("Choose at least one message")
    if (ids.length > MAX_TRIAGE_BATCH) throw new Error(`Update at most ${MAX_TRIAGE_BATCH} messages at a time`)
    const requestedStatus = input.status ? input.status.trim() : null
    if (requestedStatus && !isStaffMessageStatus(requestedStatus)) throw new Error("Choose a listed status")
    const nextStatus: StaffMessageStatus | null =
      requestedStatus && isStaffMessageStatus(requestedStatus) ? requestedStatus : null
    const note = input.note?.trim() ? input.note.trim().slice(0, 4000) : null
    const assignee = input.assigneeUserId
      ? await assigneeFor(db, organizationId, user.id, input.assigneeUserId)
      : null
    if (!nextStatus && !assignee && !note) throw new Error("Choose a status, a new owner, or add a note")

    const records = await db
      .select({
        id: staffMessageRecords.id,
        subject: staffMessageRecords.subject,
        status: staffMessageRecords.status,
        assigneeUserId: staffMessageRecords.assigneeUserId,
      })
      .from(staffMessageRecords)
      .where(and(eq(staffMessageRecords.organizationId, organizationId), inArray(staffMessageRecords.id, ids)))
    if (records.length !== ids.length) throw new Error("Some of those messages no longer exist. Refresh and try again.")

    const now = new Date().toISOString()
    const actorName = (user.displayName?.trim() || user.email).slice(0, 200)
    for (const record of records) {
      const fromStatus = staffMessageStatus(record.status)
      const statusChanged = nextStatus !== null && nextStatus !== fromStatus
      const reassigned = assignee !== null && assignee.id !== record.assigneeUserId
      if (!statusChanged && !reassigned && !note) continue
      await db
        .update(staffMessageRecords)
        .set({
          ...(statusChanged && nextStatus
            ? {
                status: nextStatus,
                statusChangedAt: now,
                resolvedAt: nextStatus === "resolved" ? now : null,
                resolvedBy: nextStatus === "resolved" ? user.id : null,
              }
            : {}),
          ...(reassigned && assignee ? { assigneeUserId: assignee.id } : {}),
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(and(eq(staffMessageRecords.id, record.id), eq(staffMessageRecords.organizationId, organizationId)))
      await db.insert(staffMessageEvents).values({
        id: crypto.randomUUID(),
        organizationId,
        messageId: record.id,
        actorUserId: user.id,
        actorName,
        eventType: statusChanged ? "status_changed" : reassigned ? "reassigned" : "note",
        fromStatus: statusChanged ? fromStatus : null,
        toStatus: statusChanged ? nextStatus : null,
        fromAssigneeUserId: reassigned ? record.assigneeUserId : null,
        toAssigneeUserId: reassigned && assignee ? assignee.id : null,
        note:
          note ??
          (reassigned && assignee
            ? `Reassigned to ${displayName(assignee)}.`
            : statusChanged && nextStatus
              ? `Marked ${STAFF_MESSAGE_STATUS_LABEL[nextStatus].toLowerCase()}.`
              : null),
        createdAt: now,
      })
      if (reassigned && assignee) {
        try {
          await notifyAssignment({ organizationId, recordId: record.id, subject: record.subject, assignee, actor: user })
        } catch (error) {
          console.error("[staff-message-desk] reassignment notification error", error)
        }
      }
    }
    revalidatePath(MESSAGE_DESK_PATH)
    return { success: true, data: { updated: records.length } }
  } catch (error) {
    return failure(error)
  }
}
