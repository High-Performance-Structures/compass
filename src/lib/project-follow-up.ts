import { defaultFollowUpCadenceDays } from "@/lib/project-profile"

export type ClientInteractionTime = {
  readonly occurredAt: string
  readonly deletedAt: string | null
  readonly qualifiesForClientTouch: boolean
}

export type ClientFollowUpState = {
  readonly eligible: boolean
  readonly businessDaysSinceLastTouch: number | null
  readonly lastClientInteractionAt: string | null
  readonly nextFollowUpAt: string | null
  readonly state: "current" | "due" | "overdue" | "scheduled" | "unrecorded" | "excluded"
}

function validDate(value: string): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  )
}

function businessDaysBetween(start: Date, end: Date): number {
  const firstDay = startOfUtcDay(start)
  const lastDay = startOfUtcDay(end)
  if (lastDay.getTime() <= firstDay.getTime()) return 0

  let days = 0
  const cursor = new Date(firstDay)
  cursor.setUTCDate(cursor.getUTCDate() + 1)
  while (cursor.getTime() <= lastDay.getTime()) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) days += 1
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

function latestInteraction(
  interactions: readonly ClientInteractionTime[],
): ClientInteractionTime | null {
  return interactions.reduce<ClientInteractionTime | null>((latest, interaction) => {
    if (
      !interaction.qualifiesForClientTouch
      || interaction.deletedAt !== null
      || validDate(interaction.occurredAt) === null
    ) {
      return latest
    }
    if (latest === null || interaction.occurredAt > latest.occurredAt) {
      return interaction
    }
    return latest
  }, null)
}

export function clientFollowUpState(input: {
  readonly jobStatusId: string
  readonly cadenceDays?: number | null
  readonly interactions: readonly ClientInteractionTime[]
  readonly nextFollowUpAt: string | null
  readonly now: Date
}): ClientFollowUpState {
  const cadenceDays =
    input.cadenceDays === undefined
      ? defaultFollowUpCadenceDays(input.jobStatusId)
      : input.cadenceDays
  if (cadenceDays === null) {
    return {
      eligible: false,
      businessDaysSinceLastTouch: null,
      lastClientInteractionAt: null,
      nextFollowUpAt: null,
      state: "excluded",
    }
  }

  const latest = latestInteraction(input.interactions)
  if (!latest) {
    return {
      eligible: true,
      businessDaysSinceLastTouch: null,
      lastClientInteractionAt: null,
      nextFollowUpAt: input.nextFollowUpAt,
      state: "unrecorded",
    }
  }

  const occurredAt = validDate(latest.occurredAt)
  if (!occurredAt) {
    return {
      eligible: true,
      businessDaysSinceLastTouch: null,
      lastClientInteractionAt: null,
      nextFollowUpAt: input.nextFollowUpAt,
      state: "unrecorded",
    }
  }

  const businessDaysSinceLastTouch = businessDaysBetween(occurredAt, input.now)
  const scheduledAt = input.nextFollowUpAt ? validDate(input.nextFollowUpAt) : null
  if (scheduledAt && scheduledAt.getTime() > input.now.getTime()) {
    return {
      eligible: true,
      businessDaysSinceLastTouch,
      lastClientInteractionAt: latest.occurredAt,
      nextFollowUpAt: input.nextFollowUpAt,
      state: "scheduled",
    }
  }

  const state =
    businessDaysSinceLastTouch > cadenceDays
      ? "overdue"
      : businessDaysSinceLastTouch === cadenceDays
        ? "due"
        : "current"
  return {
    eligible: true,
    businessDaysSinceLastTouch,
    lastClientInteractionAt: latest.occurredAt,
    nextFollowUpAt: input.nextFollowUpAt,
    state,
  }
}
