import { isInternalStaffRole } from "@/lib/user-roles"

export type DeskStatus = "in-office" | "on-site" | "remote" | "out"

export const DESK_STATUS_LABELS: Readonly<Record<DeskStatus, string>> = {
  "in-office": "In Office",
  "on-site": "On Site",
  remote: "Remote",
  out: "Out",
}

export function isDeskStatus(value: string): value is DeskStatus {
  return (
    value === "in-office" ||
    value === "on-site" ||
    value === "remote" ||
    value === "out"
  )
}

export function deskStatusFromPresenceMessage(
  message: string | null
): DeskStatus | null {
  const matchingStatus = Object.entries(DESK_STATUS_LABELS).find(
    ([, label]) => label === message
  )
  return matchingStatus && isDeskStatus(matchingStatus[0])
    ? matchingStatus[0]
    : null
}

export function deskStatusForPresenceMessage(
  message: string | null
): DeskStatus {
  return deskStatusFromPresenceMessage(message) ?? "in-office"
}

export type TeamAvailabilityMember = {
  readonly userId: string
  readonly name: string
  readonly avatarUrl: string | null
  readonly status: DeskStatus
  readonly updatedAt: string
  readonly isCurrentUser: boolean
}

export type TeamAvailabilityRow = {
  readonly userId: string
  readonly email: string
  readonly firstName: string | null
  readonly lastName: string | null
  readonly displayName: string | null
  readonly avatarUrl: string | null
  readonly role: string
  readonly statusMessage: string | null
  readonly updatedAt: string | null
}

function availabilityName(row: TeamAvailabilityRow): string {
  const displayName = row.displayName?.trim()
  if (displayName) return displayName

  const fullName = [row.firstName, row.lastName]
    .filter((value) => Boolean(value?.trim()))
    .join(" ")
    .trim()
  if (fullName) return fullName

  return row.email.split("@")[0] ?? "Team member"
}

function statusRank(status: DeskStatus): number {
  if (status === "in-office") return 0
  if (status === "on-site") return 1
  if (status === "remote") return 2
  return 3
}

export function teamAvailabilityFromRows(
  rows: readonly TeamAvailabilityRow[],
  currentUserId: string
): readonly TeamAvailabilityMember[] {
  const membersById = new Map<string, TeamAvailabilityMember>()

  for (const row of rows) {
    if (!isInternalStaffRole(row.role)) continue

    const status = deskStatusFromPresenceMessage(row.statusMessage)
    if (!status) continue

    const member: TeamAvailabilityMember = {
      userId: row.userId,
      name: availabilityName(row),
      avatarUrl: row.avatarUrl,
      status,
      updatedAt: row.updatedAt ?? "",
      isCurrentUser: row.userId === currentUserId,
    }
    const existing = membersById.get(row.userId)
    if (!existing || member.updatedAt >= existing.updatedAt) {
      membersById.set(row.userId, member)
    }
  }

  return [...membersById.values()].sort((left, right) => {
    if (left.isCurrentUser !== right.isCurrentUser) {
      return left.isCurrentUser ? -1 : 1
    }

    const statusDifference =
      statusRank(left.status) - statusRank(right.status)
    if (statusDifference !== 0) return statusDifference
    return left.name.localeCompare(right.name)
  })
}
