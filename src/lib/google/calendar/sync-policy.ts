export type CompassCalendarVisibility =
  | "organization"
  | "participants"
  | "private"
  | "busy"

export type CalendarDetailLevel = "full" | "busy" | "hidden"

export type CalendarPrivacyContext = {
  readonly visibility: CompassCalendarVisibility
  readonly viewerIsOwner: boolean
  readonly viewerIsParticipant: boolean
  readonly viewerHasProjectAccess: boolean
  readonly hasProjectScope: boolean
}

export function calendarDetailLevel(
  context: CalendarPrivacyContext,
): CalendarDetailLevel {
  if (context.hasProjectScope && !context.viewerHasProjectAccess) {
    return "hidden"
  }
  if (context.viewerIsOwner || context.viewerIsParticipant) {
    return "full"
  }
  if (context.visibility === "organization") return "full"
  if (
    context.visibility === "participants" ||
    context.visibility === "busy"
  ) {
    return "busy"
  }
  return "hidden"
}

export type GoogleCalendarSyncDirection = "push" | "pull" | "two_way"
export type GoogleCalendarSyncAction =
  | "noop"
  | "push"
  | "pull"
  | "conflict"

export type GoogleCalendarChangeState = {
  readonly direction: GoogleCalendarSyncDirection
  readonly compassChanged: boolean
  readonly googleChanged: boolean
  readonly googleDeleted: boolean
}

export function decideGoogleCalendarSyncAction(
  state: GoogleCalendarChangeState,
): GoogleCalendarSyncAction {
  if (state.direction === "push") {
    return state.compassChanged || state.googleChanged || state.googleDeleted
      ? "push"
      : "noop"
  }
  if (state.direction === "pull") {
    return state.compassChanged || state.googleChanged || state.googleDeleted
      ? "pull"
      : "noop"
  }
  if (state.compassChanged && (state.googleChanged || state.googleDeleted)) {
    return "conflict"
  }
  if (state.compassChanged) return "push"
  if (state.googleChanged || state.googleDeleted) return "pull"
  return "noop"
}

const BASE32_HEX_ALPHABET = "0123456789abcdefghijklmnopqrstuv"

function base32Hex(bytes: Uint8Array): string {
  let buffer = 0
  let bits = 0
  let output = ""

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += BASE32_HEX_ALPHABET[(buffer >>> bits) & 31]
      buffer &= (1 << bits) - 1
    }
  }
  if (bits > 0) {
    output += BASE32_HEX_ALPHABET[(buffer << (5 - bits)) & 31]
  }
  return output
}

export async function googleEventIdForCompass(
  sourceType: "work_calendar_event" | "schedule_item" | "task",
  sourceId: string,
  connectionId: string,
): Promise<string> {
  const seed = `compass:${sourceType}:${connectionId}:${sourceId}`
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(seed),
  )
  return `cmp${base32Hex(new Uint8Array(digest)).slice(0, 29)}`
}
