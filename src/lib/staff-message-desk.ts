import { isInternalStaffRole } from "@/lib/user-roles"

export type StaffMessageStatus =
  | "new"
  | "follow_up_needed"
  | "in_progress"
  | "waiting_on_contact"
  | "closed"

export type StaffMessageStatusOption = Readonly<{
  readonly value: StaffMessageStatus
  readonly label: string
}>

export const STAFF_MESSAGE_STATUS_OPTIONS: readonly StaffMessageStatusOption[] = [
  { value: "new", label: "New" },
  { value: "follow_up_needed", label: "Follow-Up Needed" },
  { value: "in_progress", label: "In Progress" },
  { value: "waiting_on_contact", label: "Waiting on Caller" },
  { value: "closed", label: "Closed" },
]

export function parseStaffMessageStatus(value: string): StaffMessageStatus | null {
  return (
    STAFF_MESSAGE_STATUS_OPTIONS.find((option) => option.value === value)?.value ??
    null
  )
}

export function staffMessageStatusLabel(status: StaffMessageStatus): string {
  return (
    STAFF_MESSAGE_STATUS_OPTIONS.find((option) => option.value === status)?.label ??
    status
  )
}

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
