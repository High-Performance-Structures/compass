export type ScheduleConfirmationState = {
  readonly status:
    | "not_requested"
    | "pending"
    | "unavailable"
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
    (input.projectRole === "client" || input.projectRole === "owner") &&
    input.ownerVisible === false
  ) {
    return false
  }
  if (
    (input.projectRole === "subcontractor" ||
      input.projectRole === "supplier") &&
    input.subVendorVisible !== true
  ) {
    return false
  }
  return true
}

export function newScheduleConfirmationState(input: {
  readonly required: boolean
  readonly assignedUserId: string | null
  readonly now: string
}): ScheduleConfirmationState {
  if (!input.required) {
    return { status: "not_requested", requestedAt: null }
  }
  return {
    status: input.assignedUserId ? "pending" : "unavailable",
    requestedAt: input.now,
  }
}
