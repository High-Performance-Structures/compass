const DEFAULT_INTERNAL_EMAIL_DOMAINS = [
  "hps-colorado.com",
  "openrangeconstruction.com",
  "openrangeconstruction.ltd",
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function envString(env: unknown, key: string): string | null {
  if (!isRecord(env)) return process.env[key] ?? null
  const value = env[key]
  return typeof value === "string" && value.trim().length > 0
    ? value
    : process.env[key] ?? null
}

function emailParts(value: string): {
  readonly localPart: string
  readonly domain: string
} | null {
  const normalized = value.trim().toLowerCase()
  const separator = normalized.lastIndexOf("@")
  if (separator <= 0 || separator === normalized.length - 1) return null
  return {
    localPart: normalized.slice(0, separator),
    domain: normalized.slice(separator + 1),
  }
}

export function trustedInternalEmailDomains(env: unknown): ReadonlySet<string> {
  const configured = envString(env, "COMPASS_INTERNAL_EMAIL_DOMAINS")
    ?.split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0) ?? []
  return new Set([...DEFAULT_INTERNAL_EMAIL_DOMAINS, ...configured])
}

export function sameTrustedInternalEmailMailbox(input: {
  readonly senderEmail: string
  readonly memberEmail: string
  readonly trustedDomains: ReadonlySet<string>
}): boolean {
  const sender = emailParts(input.senderEmail)
  const member = emailParts(input.memberEmail)
  if (!sender || !member) return false
  return (
    sender.localPart === member.localPart &&
    input.trustedDomains.has(sender.domain) &&
    input.trustedDomains.has(member.domain)
  )
}
