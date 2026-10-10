import { defaultFollowUpCadenceDays } from "@/lib/project-profile"
import type { ProjectAgingSettings } from "@/lib/feature-settings/registry"

/** Business days since the last client contact at which follow-up is due, then overdue. */
export type FollowUpThresholds = {
  readonly dueDays: number
  readonly overdueDays: number
}

/**
 * A status's thresholds: the company's setting for it, else its cadence (due
 * on the cadence day, overdue the day after). Null when the status is not
 * followed up (closed, internal).
 */
export function followUpThresholds(input: {
  readonly jobStatusId: string
  /** Cadence of an organization-specific status; undefined for built-in statuses. */
  readonly customCadenceDays?: number | null
  readonly settings: ProjectAgingSettings
}): FollowUpThresholds | null {
  const cadence =
    input.customCadenceDays === undefined ? defaultFollowUpCadenceDays(input.jobStatusId) : input.customCadenceDays
  if (cadence === null) return null
  return input.settings.statuses[input.jobStatusId] ?? { dueDays: cadence, overdueDays: cadence + 1 }
}

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
  /** Company thresholds; when given they replace the cadence. */
  readonly thresholds?: FollowUpThresholds | null
  readonly interactions: readonly ClientInteractionTime[]
  readonly nextFollowUpAt: string | null
  readonly now: Date
}): ClientFollowUpState {
  const cadenceDays =
    input.cadenceDays === undefined
      ? defaultFollowUpCadenceDays(input.jobStatusId)
      : input.cadenceDays
  const thresholds =
    input.thresholds !== undefined
      ? input.thresholds
      : cadenceDays === null
        ? null
        : { dueDays: cadenceDays, overdueDays: cadenceDays + 1 }
  if (thresholds === null) {
    return {
      eligible: false,
      businessDaysSinceLastTouch: null,
      lastClientInteractionAt: null,
      nextFollowUpAt: null,
      state: "excluded",
    }
  }

  const latest = latestInteraction(input.interactions)
  // A future follow-up date (set or snoozed) quiets the job even before any
  // contact is logged.
  const plannedAt = input.nextFollowUpAt ? validDate(input.nextFollowUpAt) : null
  if (!latest && plannedAt && plannedAt.getTime() > input.now.getTime()) {
    return {
      eligible: true,
      businessDaysSinceLastTouch: null,
      lastClientInteractionAt: null,
      nextFollowUpAt: input.nextFollowUpAt,
      state: "scheduled",
    }
  }
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
    businessDaysSinceLastTouch >= thresholds.overdueDays
      ? "overdue"
      : businessDaysSinceLastTouch >= thresholds.dueDays
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

/**
 * Aging levels shown on the map, pipeline and job pages, mildest to worst.
 * Same colors as Message Desk aging: red always means overdue.
 */
export type ProjectAgingLevel = "on_track" | "scheduled" | "no_contact" | "due" | "overdue"

export const PROJECT_AGING_LEVELS: Readonly<Record<ProjectAgingLevel, { readonly label: string; readonly colorToken: string }>> = {
  on_track: { label: "On track", colorToken: "--success" },
  scheduled: { label: "Follow-up scheduled", colorToken: "--success" },
  no_contact: { label: "No contact logged", colorToken: "--info" },
  due: { label: "Follow-up due", colorToken: "--warning" },
  overdue: { label: "Overdue", colorToken: "--destructive" },
}

export function projectAgingLevel(state: ClientFollowUpState["state"]): ProjectAgingLevel | null {
  switch (state) {
    case "current":
      return "on_track"
    case "scheduled":
      return "scheduled"
    case "unrecorded":
      return "no_contact"
    case "due":
      return "due"
    case "overdue":
      return "overdue"
    case "excluded":
      return null
  }
}

/** A job's follow-up aging, carried to the map, pipeline and job pages. */
export type ProjectFollowUpSignal = {
  readonly level: ProjectAgingLevel
  readonly businessDaysSinceLastTouch: number | null
  readonly lastContactAt: string | null
  readonly nextFollowUpAt: string | null
  readonly thresholds: FollowUpThresholds
}

/** Needs someone's attention: due or overdue. */
export function needsFollowUp(signal: ProjectFollowUpSignal | null): boolean {
  return signal?.level === "due" || signal?.level === "overdue"
}
