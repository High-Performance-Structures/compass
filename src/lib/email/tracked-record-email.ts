/**
 * Every email Compass sends to people outside the company carries a tracked
 * reply address, so the reply comes back onto its record (or job) instead of
 * landing in one person's inbox. See docs/development/email-workflows.md.
 */
export const TRACKED_RECORD_KINDS = ["rfi", "rfq", "purchase_order", "job_email", "nutech_email"] as const

export type TrackedRecordKind = (typeof TRACKED_RECORD_KINDS)[number]

export function isTrackedRecordKind(value: string): value is TrackedRecordKind {
  return TRACKED_RECORD_KINDS.some((kind) => kind === value)
}

export function trackedRecordLabel(kind: TrackedRecordKind): string {
  if (kind === "rfi") return "RFI"
  if (kind === "rfq") return "RFQ"
  if (kind === "job_email") return "Job email"
  if (kind === "nutech_email") return "Nu-Tech email"
  return "Purchase order"
}

/** Job-level emails have no record of their own; their replies belong to the job. */
export function isJobLevelKind(kind: TrackedRecordKind): boolean {
  return kind === "job_email" || kind === "nutech_email"
}

/** Notification event types use the prefixes the Settings switches filter on. */
export function trackedRecordReplyEventType(kind: TrackedRecordKind): string {
  if (kind === "rfi") return "rfi.email_reply"
  if (kind === "rfq") return "rfq.email_reply"
  if (kind === "job_email") return "job_email.reply"
  if (kind === "nutech_email") return "nutech_email.reply"
  return "po.email_reply"
}

export function trackedRecordHref(input: {
  readonly kind: TrackedRecordKind
  readonly projectId: string
  readonly recordId: string
}): string {
  const project = `/dashboard/projects/${encodeURIComponent(input.projectId)}`
  const record = encodeURIComponent(input.recordId)
  if (input.kind === "rfi") return `${project}/rfis?item=${record}#rfi-${record}`
  if (input.kind === "rfq") return `${project}/rfqs#rfq-${record}`
  if (input.kind === "job_email") return `${project}/information`
  if (input.kind === "nutech_email") return `${project}/nutech`
  return `${project}/purchase-orders?item=${record}#purchase-order-${record}`
}

function quotedDisplayName(value: string): string {
  return `"${value.replace(/[\r\n"\\<>]/g, " ").replace(/\s+/g, " ").trim()}"`
}

/**
 * The tracked address comes first and carries a readable name. People who
 * should still see replies directly (the sender, a department mailbox) are
 * listed after it, so a reply reaches both them and Compass.
 */
export function trackedRecordReplyTo(input: {
  readonly replyToAddress: string
  readonly displayName: string
  readonly alsoTo: readonly (string | null | undefined)[]
}): string {
  const tracked = input.replyToAddress.replace(
    /^Compass (?=<)/,
    () => `${quotedDisplayName(input.displayName)} `
  )
  const trackedEmail = /<([^>]+)>/.exec(tracked)?.[1]?.toLowerCase() ?? tracked.toLowerCase()
  const seen = new Set([trackedEmail])
  const extra: string[] = []
  for (const address of input.alsoTo) {
    const email = address?.trim().toLowerCase()
    if (!email || !/^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/.test(email) || seen.has(email)) continue
    seen.add(email)
    extra.push(email)
  }
  return [tracked, ...extra].join(", ")
}

export function emailReplyPreview(value: string, limit = 240): string {
  const compact = value
    .split(/\r?\n/)
    // Stop at the quoted original so the preview shows what they wrote.
    .reduce<{ readonly lines: readonly string[]; readonly done: boolean }>(
      (state, line) => {
        if (state.done) return state
        if (/^\s*>/.test(line) || /^On .+wrote:\s*$/.test(line.trim()) || /^-{2,}\s*Original Message/i.test(line.trim())) {
          return { lines: state.lines, done: true }
        }
        return { lines: [...state.lines, line], done: false }
      },
      { lines: [], done: false }
    )
    .lines.join(" ")
    .replace(/\s+/g, " ")
    .trim()
  if (compact.length <= limit) return compact
  return `${compact.slice(0, limit - 1).trimEnd()}…`
}
