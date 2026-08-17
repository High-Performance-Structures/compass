import { isInternalStaffRole } from "@/lib/user-roles"

export const STAFF_MESSAGE_STATUSES = [
  "New",
  "Assigned",
  "In Progress",
  "Waiting",
  "Completed",
] as const

export type StaffMessageStatus = (typeof STAFF_MESSAGE_STATUSES)[number]

export type StaffMessageDeskUser = Readonly<{
  readonly id: string
  readonly isActive: boolean
  readonly organizationId: string | null
  readonly organizationType: string | null
  readonly role: string
}>

const STATUS_TRANSITIONS: Readonly<
  Record<StaffMessageStatus, readonly StaffMessageStatus[]>
> = {
  New: ["New", "Assigned"],
  Assigned: ["Assigned", "In Progress", "Waiting"],
  "In Progress": ["In Progress", "Waiting", "Completed"],
  Waiting: ["Waiting", "In Progress", "Completed"],
  Completed: ["Completed"],
}

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
  organizationId: string
): boolean {
  return (
    isStaffMessageDeskUser(user) && user.organizationId === organizationId
  )
}

export function canTransitionStaffMessageStatus(
  from: StaffMessageStatus,
  to: StaffMessageStatus
): boolean {
  return STATUS_TRANSITIONS[from].includes(to)
}

export function isStaffMessageStatus(
  value: string
): value is StaffMessageStatus {
  return (STAFF_MESSAGE_STATUSES as readonly string[]).includes(value)
}
