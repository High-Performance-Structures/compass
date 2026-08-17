"use server"

import { and, asc, desc, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  gotoInboundEvents,
  organizations,
  organizationMembers,
  staffMessageHistory,
  staffMessageRecords,
  users,
} from "@/db/schema"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  archivedStaffMessageGotoEventState,
  canTransitionStaffMessageStatus,
  isEligibleStaffMessageAssignee,
  isStaffMessageDeskUser,
  isStaffMessageStatus,
  linkedStaffMessageGotoEventState,
  type StaffMessageDeskUser,
  type StaffMessageStatus,
} from "@/lib/staff-message-desk"
import { createNotificationEvent } from "@/lib/notifications/create-event"
import { requireOrg } from "@/lib/org-scope"
import { canManageUserAccessRole } from "@/lib/user-roles"

const MESSAGE_DESK_PATH = "/dashboard/office-maintenance/message-desk"

type ActionFailure = { readonly success: false; readonly error: string }
type ActionSuccess<T> = { readonly success: true; readonly data: T }
type ActionResult<T> = ActionFailure | ActionSuccess<T>

type AssigneeRow = {
  readonly id: string
  readonly email: string
  readonly firstName: string | null
  readonly lastName: string | null
  readonly displayName: string | null
  readonly isActive: boolean
  readonly memberRole: string
}

export type StaffMessageRecordDto = Readonly<{
  readonly id: string
  readonly sourceType: "call" | "message"
  readonly gotoInboundEventId: string | null
  readonly callerName: string
  readonly callerCompany: string | null
  readonly callerPhone: string | null
  readonly callerEmail: string | null
  readonly subject: string
  readonly body: string
  readonly status: StaffMessageStatus
  readonly assigneeUserId: string
  readonly assigneeName: string
  readonly followUpDueDate: string | null
  readonly completionOutcome: string | null
  readonly createdBy: string | null
  readonly completedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly history: readonly StaffMessageHistoryDto[]
}>

export type StaffMessageHistoryDto = Readonly<{
  readonly id: string
  readonly action: string
  readonly fromStatus: string | null
  readonly toStatus: string | null
  readonly fromAssigneeUserId: string | null
  readonly toAssigneeUserId: string | null
  readonly note: string | null
  readonly createdAt: string
  readonly actorName: string
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
  readonly records: readonly StaffMessageRecordDto[]
  readonly assignees: readonly StaffMessageAssigneeDto[]
  readonly inboundTexts: readonly StaffMessageInboundTextDto[]
  readonly canDelete: boolean
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

function sourceType(valueToCheck: string): "call" | "message" {
  if (valueToCheck === "call" || valueToCheck === "message") return valueToCheck
  throw new Error("Source type must be call or message")
}

function parseStatus(valueToCheck: string): StaffMessageStatus {
  if (isStaffMessageStatus(valueToCheck)) return valueToCheck
  throw new Error("Choose a governed staff message status")
}

function parseDueDate(valueToCheck: string | null): string | null {
  if (valueToCheck === null) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueToCheck)) {
    throw new Error("Follow-up due date must use YYYY-MM-DD")
  }
  return valueToCheck
}

function staffDeskUser(user: AuthUser): StaffMessageDeskUser {
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
  if (!isStaffMessageDeskUser(staffDeskUser(user))) {
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

async function assigneeFor(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  userId: string
): Promise<AssigneeRow> {
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
    .where(
      and(
        eq(users.id, userId),
        eq(organizationMembers.organizationId, organizationId)
      )
    )
    .get()
  if (!row) throw new Error("Assignee is not a member of the active organization")
  const candidate: StaffMessageDeskUser = {
    id: row.id,
    isActive: row.isActive,
    organizationId,
    organizationType: "internal",
    role: row.memberRole,
  }
  if (!isEligibleStaffMessageAssignee(candidate, organizationId)) {
    throw new Error("Assignee must be active internal staff")
  }
  return row
}

function assigneeName(row: Pick<AssigneeRow, "displayName" | "firstName" | "lastName" | "email">): string {
  const displayName = row.displayName?.trim()
  if (displayName) return displayName
  const fullName = [row.firstName, row.lastName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim()
  return fullName || row.email
}

async function activeAssignees(
  db: ReturnType<typeof getDb>,
  organizationId: string
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
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(users.isActive, true)
      )
    )
    .orderBy(asc(users.displayName), asc(users.email))
  return rows
    .filter((row) =>
      isEligibleStaffMessageAssignee(
        {
          id: row.id,
          isActive: row.isActive,
          organizationId,
          organizationType: "internal",
          role: row.memberRole,
        },
        organizationId
      )
    )
    .map((row) => ({ id: row.id, name: assigneeName(row), email: row.email }))
}

async function appendHistory(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly recordId: string
  readonly actorUserId: string
  readonly action: string
  readonly fromStatus: string | null
  readonly toStatus: string | null
  readonly fromAssigneeUserId?: string | null
  readonly toAssigneeUserId?: string | null
  readonly note?: string | null
  readonly createdAt: string
}): Promise<void> {
  await input.db
    .insert(staffMessageHistory)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      recordId: input.recordId,
      actorUserId: input.actorUserId,
      action: input.action,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      fromAssigneeUserId: input.fromAssigneeUserId ?? null,
      toAssigneeUserId: input.toAssigneeUserId ?? null,
      note: input.note ?? null,
      metadata: null,
      createdAt: input.createdAt,
    })
    .run()
}

async function notifyAssignment(input: {
  readonly organizationId: string
  readonly recordId: string
  readonly subject: string
  readonly assignee: AssigneeRow
  readonly actor: AuthUser
}): Promise<void> {
  try {
    await createNotificationEvent({
      organizationId: input.organizationId,
      projectId: null,
      eventType: "staff_message.assigned",
      sourceType: "staff_message_record",
      sourceId: input.recordId,
      title: `Staff message assigned: ${input.subject}`,
      body: `${input.actor.displayName ?? input.actor.email} assigned this message to you.`,
      href: `${MESSAGE_DESK_PATH}#message-${encodeURIComponent(input.recordId)}`,
      priority: "normal",
      audience: "assignee",
      createdBy: input.actor.id,
      recipients: [{ userId: input.assignee.id, email: input.assignee.email }],
      delivery: { inApp: true, email: true, push: true },
    })
  } catch (error) {
    console.error("[staff-message-desk] assignment notification error", error)
  }
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
        status: staffMessageRecords.status,
        assigneeUserId: staffMessageRecords.assigneeUserId,
        followUpDueDate: staffMessageRecords.followUpDueDate,
        completionOutcome: staffMessageRecords.completionOutcome,
        createdBy: staffMessageRecords.createdBy,
        completedAt: staffMessageRecords.completedAt,
        createdAt: staffMessageRecords.createdAt,
        updatedAt: staffMessageRecords.updatedAt,
        assigneeDisplayName: users.displayName,
        assigneeFirstName: users.firstName,
        assigneeLastName: users.lastName,
        assigneeEmail: users.email,
      })
      .from(staffMessageRecords)
      .innerJoin(users, eq(users.id, staffMessageRecords.assigneeUserId))
      .where(
        and(
          eq(staffMessageRecords.organizationId, organizationId),
          isNull(staffMessageRecords.deletedAt)
        )
      )
      .orderBy(desc(staffMessageRecords.updatedAt))
    const historyRows = await db
      .select({
        id: staffMessageHistory.id,
        recordId: staffMessageHistory.recordId,
        action: staffMessageHistory.action,
        fromStatus: staffMessageHistory.fromStatus,
        toStatus: staffMessageHistory.toStatus,
        fromAssigneeUserId: staffMessageHistory.fromAssigneeUserId,
        toAssigneeUserId: staffMessageHistory.toAssigneeUserId,
        note: staffMessageHistory.note,
        createdAt: staffMessageHistory.createdAt,
        actorDisplayName: users.displayName,
        actorFirstName: users.firstName,
        actorLastName: users.lastName,
        actorEmail: users.email,
      })
      .from(staffMessageHistory)
      .leftJoin(users, eq(users.id, staffMessageHistory.actorUserId))
      .where(eq(staffMessageHistory.organizationId, organizationId))
      .orderBy(desc(staffMessageHistory.createdAt))
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
        and(
          eq(staffMessageRecords.gotoInboundEventId, gotoInboundEvents.id),
          isNull(staffMessageRecords.deletedAt)
        )
      )
      .where(
        and(
          eq(gotoInboundEvents.organizationId, organizationId),
          eq(gotoInboundEvents.status, "needs_review"),
          isNull(staffMessageRecords.id)
        )
      )
      .orderBy(desc(gotoInboundEvents.receivedAt))
    const historyByRecord = new Map<string, StaffMessageHistoryDto[]>()
    for (const row of historyRows) {
      const list = historyByRecord.get(row.recordId) ?? []
      list.push({
        id: row.id,
        action: row.action,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        fromAssigneeUserId: row.fromAssigneeUserId,
        toAssigneeUserId: row.toAssigneeUserId,
        note: row.note,
        createdAt: row.createdAt,
        actorName:
          row.actorDisplayName ??
          ([row.actorFirstName, row.actorLastName]
            .filter((part): part is string => Boolean(part?.trim()))
            .join(" ")
            .trim() ||
            row.actorEmail ||
            "Compass"),
      })
      historyByRecord.set(row.recordId, list)
    }
    const records: StaffMessageRecordDto[] = rows.flatMap((row) => {
      if (!isStaffMessageStatus(row.status)) return []
      return [
        {
          id: row.id,
          sourceType: sourceType(row.sourceType),
          gotoInboundEventId: row.gotoInboundEventId,
          callerName: row.callerName,
          callerCompany: row.callerCompany,
          callerPhone: row.callerPhone,
          callerEmail: row.callerEmail,
          subject: row.subject,
          body: row.body,
          status: row.status,
          assigneeUserId: row.assigneeUserId,
          assigneeName: assigneeName({
            displayName: row.assigneeDisplayName,
            firstName: row.assigneeFirstName,
            lastName: row.assigneeLastName,
            email: row.assigneeEmail,
          }),
          followUpDueDate: row.followUpDueDate,
          completionOutcome: row.completionOutcome,
          createdBy: row.createdBy,
          completedAt: row.completedAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          history: historyByRecord.get(row.id) ?? [],
        },
      ]
    })
    return {
      success: true,
      data: {
        records,
        assignees: await activeAssignees(db, organizationId),
        inboundTexts: inboundRows,
        canDelete: canManageUserAccessRole(user.role),
      },
    }
  } catch (error) {
    return failure(error)
  }
}

export async function createStaffMessageRecord(
  formData: FormData
): Promise<ActionResult<{ readonly id: string }>> {
  try {
    const { db, organizationId, user } = await staffMessageContext()
    const assignee = await assigneeFor(
      db,
      organizationId,
      requiredValue(formData, "assigneeUserId")
    )
    const linkedEventId = value(formData, "gotoInboundEventId")
    if (linkedEventId) {
      const event = await db
        .select({ id: gotoInboundEvents.id })
        .from(gotoInboundEvents)
        .where(
          and(
            eq(gotoInboundEvents.id, linkedEventId),
            eq(gotoInboundEvents.organizationId, organizationId),
            eq(gotoInboundEvents.status, "needs_review")
          )
        )
        .get()
      if (!event) throw new Error("GoTo text is not available for linking")
    }
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const recordInsert = db
      .insert(staffMessageRecords)
      .values({
        id,
        organizationId,
        sourceType: sourceType(requiredValue(formData, "sourceType")),
        gotoInboundEventId: linkedEventId,
        callerName: requiredValue(formData, "callerName"),
        callerCompany: value(formData, "callerCompany"),
        callerPhone: value(formData, "callerPhone"),
        callerEmail: value(formData, "callerEmail"),
        subject: requiredValue(formData, "subject"),
        body: requiredValue(formData, "body"),
        status: "New",
        assigneeUserId: assignee.id,
        followUpDueDate: parseDueDate(value(formData, "followUpDueDate")),
        completionOutcome: null,
        createdBy: user.id,
        completedAt: null,
        deletedAt: null,
        deletedBy: null,
        createdAt: now,
        updatedAt: now,
      })
    if (linkedEventId) {
      await db.batch([
        recordInsert,
        db
          .update(gotoInboundEvents)
          .set(linkedStaffMessageGotoEventState(now))
          .where(
            and(
              eq(gotoInboundEvents.id, linkedEventId),
              eq(gotoInboundEvents.organizationId, organizationId),
              eq(gotoInboundEvents.status, "needs_review")
            )
          ),
      ])
    } else {
      await db.batch([recordInsert])
    }
    await appendHistory({
      db,
      organizationId,
      recordId: id,
      actorUserId: user.id,
      action: "created",
      fromStatus: null,
      toStatus: "New",
      toAssigneeUserId: assignee.id,
      note: value(formData, "note"),
      createdAt: now,
    })
    await notifyAssignment({
      organizationId,
      recordId: id,
      subject: requiredValue(formData, "subject"),
      assignee,
      actor: user,
    })
    revalidatePath(MESSAGE_DESK_PATH)
    return { success: true, data: { id } }
  } catch (error) {
    return failure(error)
  }
}

export async function updateStaffMessageRecord(
  formData: FormData
): Promise<ActionResult<{ readonly id: string }>> {
  try {
    const { db, organizationId, user } = await staffMessageContext()
    const recordId = requiredValue(formData, "recordId")
    const existing = await db
      .select()
      .from(staffMessageRecords)
      .where(
        and(
          eq(staffMessageRecords.id, recordId),
          eq(staffMessageRecords.organizationId, organizationId),
          isNull(staffMessageRecords.deletedAt)
        )
      )
      .get()
    if (!existing) throw new Error("Staff message record not found")
    if (!isStaffMessageStatus(existing.status)) {
      throw new Error("Stored staff message has an invalid status")
    }
    const nextStatus = parseStatus(requiredValue(formData, "status"))
    if (!canTransitionStaffMessageStatus(existing.status, nextStatus)) {
      throw new Error(`Cannot move ${existing.status} to ${nextStatus}`)
    }
    const requestedAssigneeId = requiredValue(formData, "assigneeUserId")
    if (
      requestedAssigneeId !== existing.assigneeUserId &&
      user.id !== existing.assigneeUserId &&
      !canManageUserAccessRole(user.role)
    ) {
      throw new Error("Only the current assignee or an administrator may reassign")
    }
    const assignee = await assigneeFor(db, organizationId, requestedAssigneeId)
    const outcome = value(formData, "completionOutcome")
    if (nextStatus === "Completed" && !outcome) {
      throw new Error("Completion outcome is required before completing a record")
    }
    const now = new Date().toISOString()
    const dueDate = parseDueDate(value(formData, "followUpDueDate"))
    await db
      .update(staffMessageRecords)
      .set({
        status: nextStatus,
        assigneeUserId: assignee.id,
        followUpDueDate: dueDate,
        completionOutcome: outcome,
        completedAt: nextStatus === "Completed" ? existing.completedAt ?? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(staffMessageRecords.id, recordId),
          eq(staffMessageRecords.organizationId, organizationId),
          isNull(staffMessageRecords.deletedAt)
        )
      )
      .run()
    const changed =
      existing.status !== nextStatus ||
      existing.assigneeUserId !== assignee.id ||
      existing.followUpDueDate !== dueDate ||
      existing.completionOutcome !== outcome
    if (changed) {
      await appendHistory({
        db,
        organizationId,
        recordId,
        actorUserId: user.id,
        action:
          existing.assigneeUserId !== assignee.id
            ? "reassigned"
            : existing.status !== nextStatus
              ? "status_changed"
              : "updated",
        fromStatus: existing.status,
        toStatus: nextStatus,
        fromAssigneeUserId: existing.assigneeUserId,
        toAssigneeUserId: assignee.id,
        note: value(formData, "note"),
        createdAt: now,
      })
    }
    if (existing.assigneeUserId !== assignee.id) {
      await notifyAssignment({
        organizationId,
        recordId,
        subject: existing.subject,
        assignee,
        actor: user,
      })
    }
    revalidatePath(MESSAGE_DESK_PATH)
    return { success: true, data: { id: recordId } }
  } catch (error) {
    return failure(error)
  }
}

export async function deleteStaffMessageRecord(
  formData: FormData
): Promise<ActionResult<{ readonly id: string }>> {
  try {
    const { db, organizationId, user } = await staffMessageContext()
    if (!canManageUserAccessRole(user.role)) {
      throw new Error("Administrator permission is required to delete a record")
    }
    const recordId = requiredValue(formData, "recordId")
    const existing = await db
      .select({
        id: staffMessageRecords.id,
        status: staffMessageRecords.status,
        assigneeUserId: staffMessageRecords.assigneeUserId,
        gotoInboundEventId: staffMessageRecords.gotoInboundEventId,
      })
      .from(staffMessageRecords)
      .where(
        and(
          eq(staffMessageRecords.id, recordId),
          eq(staffMessageRecords.organizationId, organizationId),
          isNull(staffMessageRecords.deletedAt)
        )
      )
      .get()
    if (!existing) throw new Error("Staff message record not found")
    const now = new Date().toISOString()
    const recordArchive = db
      .update(staffMessageRecords)
      .set({ deletedAt: now, deletedBy: user.id, updatedAt: now })
      .where(
        and(
          eq(staffMessageRecords.id, recordId),
          eq(staffMessageRecords.organizationId, organizationId),
          isNull(staffMessageRecords.deletedAt)
        )
      )
    if (existing.gotoInboundEventId) {
      await db.batch([
        recordArchive,
        db
          .update(gotoInboundEvents)
          .set(archivedStaffMessageGotoEventState(now))
          .where(
            and(
              eq(gotoInboundEvents.id, existing.gotoInboundEventId),
              eq(gotoInboundEvents.organizationId, organizationId)
            )
          ),
      ])
    } else {
      await db.batch([recordArchive])
    }
    await appendHistory({
      db,
      organizationId,
      recordId,
      actorUserId: user.id,
      action: "deleted",
      fromStatus: existing.status,
      toStatus: existing.status,
      fromAssigneeUserId: existing.assigneeUserId,
      toAssigneeUserId: existing.assigneeUserId,
      note: value(formData, "note"),
      createdAt: now,
    })
    revalidatePath(MESSAGE_DESK_PATH)
    return { success: true, data: { id: recordId } }
  } catch (error) {
    return failure(error)
  }
}

export async function submitCreateStaffMessageRecord(
  formData: FormData
): Promise<void> {
  await createStaffMessageRecord(formData)
}

export async function submitUpdateStaffMessageRecord(
  formData: FormData
): Promise<void> {
  await updateStaffMessageRecord(formData)
}

export async function submitDeleteStaffMessageRecord(
  formData: FormData
): Promise<void> {
  await deleteStaffMessageRecord(formData)
}
