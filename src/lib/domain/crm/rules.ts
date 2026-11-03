/**
 * Pure client-relationship rules: who can own follow-up, and how the
 * company-wide follow-up queue is built and ordered. No database access.
 */
import { clientFollowUpState, followUpThresholds } from "@/lib/project-follow-up"
import { PROJECT_JOB_STATUS_DEFINITIONS, isEligibleFollowUpOwner, type ProjectClientStatus } from "@/lib/project-profile"
import { projectClientStatus } from "@/lib/domain/project/profile-rules"

export type ProjectFollowUpOwner = {
  readonly id: string
  readonly displayName: string
}

/** Active internal members who may own follow-up, labelled by name or email. */
export function followUpOwners(
  members: readonly {
    readonly id: string
    readonly displayName: string | null
    readonly email: string
    readonly active: boolean
    readonly role: string
  }[],
): readonly ProjectFollowUpOwner[] {
  return members
    .filter((member) => isEligibleFollowUpOwner(member))
    .map((member) => ({ id: member.id, displayName: member.displayName ?? member.email }))
}

export type ProjectFollowUpQueueItem = {
  readonly projectId: string
  readonly projectNumber: string | null
  readonly projectName: string
  readonly clientName: string | null
  readonly clientStatus: ProjectClientStatus
  readonly jobStatusId: string
  readonly jobStatusLabel: string
  readonly state: "current" | "due" | "overdue" | "scheduled" | "unrecorded"
  readonly businessDaysSinceLastTouch: number | null
  readonly lastClientInteractionAt: string | null
  readonly nextFollowUpAt: string | null
  readonly followUpOwnerName: string | null
}

/** One row per project × qualifying client interaction (null when none). */
export type FollowUpQueueRow = {
  readonly projectId: string
  readonly projectNumber: string | null
  readonly projectName: string
  readonly clientName: string | null
  readonly clientStatus: string
  readonly jobStatusId: string
  readonly occurredAt: string | null
  readonly nextFollowUpAt: string | null
  readonly ownerName: string | null
}

type FollowUpCustomStatus = {
  readonly id: string
  readonly label: string
  readonly cadenceDays: number | null
}

const STATE_ORDER: Readonly<Record<ProjectFollowUpQueueItem["state"], number>> = {
  overdue: 0,
  due: 1,
  unrecorded: 2,
  current: 3,
  scheduled: 4,
}

/**
 * Groups the joined rows by project, keeps the projects whose status is
 * followed up, and orders them overdue → due → unrecorded → current →
 * scheduled, then by the earliest next follow-up or last contact.
 */
export function buildFollowUpQueue(input: {
  readonly rows: readonly FollowUpQueueRow[]
  readonly customStatuses: readonly FollowUpCustomStatus[]
  readonly agingSettings: Parameters<typeof followUpThresholds>[0]["settings"]
  readonly now: Date
}): readonly ProjectFollowUpQueueItem[] {
  const customStatusesById = new Map(input.customStatuses.map((status) => [status.id, status]))
  const builtInStatusLabels = new Map<string, string>(
    PROJECT_JOB_STATUS_DEFINITIONS.map((status) => [status.id, status.label]),
  )
  const grouped = new Map<
    string,
    {
      readonly row: FollowUpQueueRow
      readonly clientStatus: ProjectClientStatus
      readonly interactions: {
        readonly occurredAt: string
        readonly deletedAt: null
        readonly qualifiesForClientTouch: true
      }[]
    }
  >()
  for (const row of input.rows) {
    let project = grouped.get(row.projectId)
    if (!project) {
      project = { row, clientStatus: projectClientStatus(row.clientStatus), interactions: [] }
      grouped.set(row.projectId, project)
    }
    if (row.occurredAt) {
      project.interactions.push({
        occurredAt: row.occurredAt,
        deletedAt: null,
        qualifiesForClientTouch: true,
      })
    }
  }

  const queue = [...grouped.values()].flatMap(({ row, clientStatus, interactions }) => {
    const customStatus = customStatusesById.get(row.jobStatusId)
    const state = clientFollowUpState({
      jobStatusId: row.jobStatusId,
      thresholds: followUpThresholds({
        jobStatusId: row.jobStatusId,
        customCadenceDays: customStatus ? customStatus.cadenceDays : undefined,
        settings: input.agingSettings,
      }),
      interactions,
      nextFollowUpAt: row.nextFollowUpAt,
      now: input.now,
    })
    if (!state.eligible || state.state === "excluded") return []
    const jobStatusLabel =
      builtInStatusLabels.get(row.jobStatusId) ?? customStatus?.label ?? "Unknown"
    return [{
      projectId: row.projectId,
      projectNumber: row.projectNumber,
      projectName: row.projectName,
      clientName: row.clientName,
      clientStatus,
      jobStatusId: row.jobStatusId,
      jobStatusLabel,
      state: state.state,
      businessDaysSinceLastTouch: state.businessDaysSinceLastTouch,
      lastClientInteractionAt: state.lastClientInteractionAt,
      nextFollowUpAt: state.nextFollowUpAt,
      followUpOwnerName: row.ownerName,
    }]
  })
  return queue.sort((left, right) => {
    const stateDifference = STATE_ORDER[left.state] - STATE_ORDER[right.state]
    if (stateDifference !== 0) return stateDifference
    const leftTime = left.nextFollowUpAt ?? left.lastClientInteractionAt ?? ""
    const rightTime = right.nextFollowUpAt ?? right.lastClientInteractionAt ?? ""
    return leftTime.localeCompare(rightTime)
  })
}
