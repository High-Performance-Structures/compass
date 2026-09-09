const SESSION_EXPIRED_MESSAGE =
  "Your Compass session expired. Sign in again, then return to this card and submit it."

const SESSION_ERROR_MARKERS = [
  "session has expired",
  "session expired",
  "sign in again",
  "unauthorized",
  "invalid_grant",
  "could not authorize the request",
] as const

export type GreetingCardActionFailure = {
  readonly message: string
  readonly sessionExpired: boolean
}

export function greetingCardActionFailure(
  error: unknown,
): GreetingCardActionFailure {
  const messages = errorMessages(error)
  const sessionExpired = messages.some((message) =>
    SESSION_ERROR_MARKERS.some((marker) => message.toLowerCase().includes(marker)),
  )

  return {
    message: sessionExpired
      ? SESSION_EXPIRED_MESSAGE
      : messages[0] ?? "Unable to submit the greeting-card request.",
    sessionExpired,
  }
}

function errorMessages(error: unknown): readonly string[] {
  const messages: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current)
    if (typeof current === "string") {
      if (current.trim()) messages.push(current.trim())
      break
    }
    if (typeof current !== "object") break

    const message = Reflect.get(current, "message")
    if (typeof message === "string" && message.trim()) {
      messages.push(message.trim())
    }
    current = Reflect.get(current, "cause")
  }

  return messages
}
