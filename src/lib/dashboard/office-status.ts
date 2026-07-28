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

export function deskStatusForPresenceMessage(
  message: string | null
): DeskStatus {
  const matchingStatus = Object.entries(DESK_STATUS_LABELS).find(
    ([, label]) => label === message
  )
  return matchingStatus && isDeskStatus(matchingStatus[0])
    ? matchingStatus[0]
    : "in-office"
}
