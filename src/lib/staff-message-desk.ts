import type { AuthUser } from "@/lib/auth"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { canManageProjectRegistry } from "@/lib/permissions"
import { isInternalStaffRole, isProjectLeadRole } from "@/lib/user-roles"

export type StaffMessageDeskUser = Readonly<{
  readonly id: string
  readonly isActive: boolean
  readonly organizationId: string | null
  readonly organizationType: string | null
  readonly role: string
}>

export function isStaffMessageDeskUser(
  user: StaffMessageDeskUser | null
): boolean {
  return (
    user !== null &&
    user.isActive &&
    user.organizationId !== null &&
    user.organizationType === "internal" &&
    isInternalStaffRole(user.role)
  )
}

/**
 * Who reviews job emails Compass held back (the desk's "Held job emails"):
 * anyone who manages the project registry, plus project managers and project
 * administrators, who run jobs day to day.
 */
export function canReviewHeldJobEmails(user: AuthUser | null): boolean {
  if (canManageProjectRegistry(user)) return true
  if (!user || !user.isActive) return false
  if (isDemoUser(user.id) || (user.organizationId !== null && isDemoOrg(user.organizationId))) return false
  return isProjectLeadRole(user.role)
}

export function isEligibleStaffMessageAssignee(
  user: StaffMessageDeskUser,
  organizationId: string,
  creatorUserId: string
): boolean {
  return (
    isStaffMessageDeskUser(user) &&
    user.organizationId === organizationId &&
    user.id !== creatorUserId
  )
}

export type StaffMessageAssignmentNotification = Readonly<{
  readonly organizationId: string
  readonly recordId: string
  readonly recipientUserId: string
  readonly title: string
  readonly href: string
}>

export function buildStaffMessageAssignmentNotification(input: {
  readonly organizationId: string
  readonly recordId: string
  readonly subject: string
  readonly assigneeUserId: string
}): StaffMessageAssignmentNotification {
  return {
    organizationId: input.organizationId,
    recordId: input.recordId,
    recipientUserId: input.assigneeUserId,
    title: `Staff message assigned: ${input.subject}`,
    href: `/dashboard/office-maintenance/message-desk#message-${encodeURIComponent(input.recordId)}`,
  }
}

export type GotoStaffMessageDraft = Readonly<{
  readonly sourceType: "message"
  readonly gotoInboundEventId: string
  readonly callerName: string
  readonly callerPhone: string
  readonly subject: string
  readonly body: string
  readonly assigneeUserId: string
  readonly sourceEventMutation: null
}>

export function buildGotoStaffMessageDraft(input: {
  readonly eventId: string
  readonly senderPhone: string
  readonly messageBody: string | null
  readonly assigneeUserId: string
}): GotoStaffMessageDraft {
  const body = input.messageBody?.trim() ?? ""
  const subject = body.split(/\r?\n/, 1)[0]?.trim().slice(0, 120) || "Inbound text"
  return {
    sourceType: "message",
    gotoInboundEventId: input.eventId,
    callerName: "Inbound text caller",
    callerPhone: input.senderPhone,
    subject,
    body: body || "No message body was retained.",
    assigneeUserId: input.assigneeUserId,
    sourceEventMutation: null,
  }
}
