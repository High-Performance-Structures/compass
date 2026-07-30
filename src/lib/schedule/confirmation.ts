export type ScheduleConfirmationState = {
  readonly status:
    | "not_requested"
    | "pending"
    | "unavailable"
  readonly requestedAt: string | null
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
