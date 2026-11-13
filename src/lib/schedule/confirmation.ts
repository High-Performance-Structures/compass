import { confirmationMachine, staffConfirmationEvent } from "@/lib/domain/schedule/confirmation-machine"
import type { ScheduleConfirmationStatus } from "@/lib/domain/schedule/statuses"
import { isOwnerRole, isVendorRole } from "@/lib/user-roles"

export type ScheduleConfirmationState = {
  readonly status: ScheduleConfirmationStatus
  readonly requestedAt: string | null
}

export function canViewerConfirmScheduleTask(input: {
  readonly viewerIsInternal: boolean
  readonly viewerId: string
  readonly assignedUserId: string | null
  readonly confirmationRequired: boolean
}): boolean {
  return (
    !input.viewerIsInternal &&
    input.confirmationRequired &&
    input.assignedUserId === input.viewerId
  )
}

export function isPublishedScheduleAssignmentVisible(input: {
  readonly currentAssignedUserId: string | null
  readonly publishedAssignedUserId: string | null
  readonly projectRole: string | null
  readonly ownerVisible: boolean | undefined
  readonly subVendorVisible: boolean | undefined
  readonly confirmationRequired?: boolean
  readonly publishedConfirmationRequired?: boolean
}): boolean {
  if (
    input.currentAssignedUserId === null ||
    input.currentAssignedUserId !== input.publishedAssignedUserId
  ) {
    return false
  }
  if (
    input.confirmationRequired === true &&
    input.publishedConfirmationRequired !== true
  ) {
    return false
  }
  if (
    isOwnerRole(input.projectRole) &&
    input.ownerVisible === false
  ) {
    return false
  }
  if (
    isVendorRole(input.projectRole) &&
    input.subVendorVisible !== true
  ) {
    return false
  }
  return true
}

/** The confirmation staff's settings start (confirmation-machine.ts). */
export function newScheduleConfirmationState(input: {
  readonly required: boolean
  readonly assignedUserId: string | null
  readonly now: string
}): ScheduleConfirmationState {
  const event = staffConfirmationEvent(input)
  return {
    status: confirmationMachine.transitions[event].to,
    requestedAt: event === "stop" ? null : input.now,
  }
}
