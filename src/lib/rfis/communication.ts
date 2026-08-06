export function appendRfiCommunication(input: {
  readonly existing: string | null
  readonly message: string
  readonly author: string
  readonly occurredAt: string
}): string | null {
  const message = input.message.trim()
  if (!message) return input.existing

  const author = input.author.trim() || "Compass user"
  const timestamp = new Date(input.occurredAt).toLocaleString("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  })
  const entry = `${author} · ${timestamp}\n${message}`
  const existing = input.existing?.trim() ?? ""
  return existing ? `${existing}\n\n${entry}` : entry
}
