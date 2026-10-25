const CALENDAR_API = "https://www.googleapis.com/calendar/v3"

export class GoogleCalendarHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/** True when Google says the calendar, event or rule no longer exists. */
export function isGoneError(error: unknown): boolean {
  return error instanceof GoogleCalendarHttpError && (error.status === 404 || error.status === 410)
}

/** One Google Calendar API call with the company connection's access token. */
export async function calendarFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  const response = await fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers },
  })
  if (response.status === 204) return null
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error =
      typeof payload === "object" && payload !== null ? Reflect.get(payload, "error") : null
    const message =
      typeof error === "object" && error !== null && typeof Reflect.get(error, "message") === "string"
        ? String(Reflect.get(error, "message"))
        : `Google Calendar request failed (${response.status})`
    throw new GoogleCalendarHttpError(response.status, message)
  }
  return payload
}
