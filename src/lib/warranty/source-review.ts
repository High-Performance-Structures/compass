export type WarrantySourceEvidence = {
  readonly internalNotes: string | null
  readonly comments: readonly { readonly audience: string; readonly text: string }[]
  readonly serviceCount: number | null
  readonly readingCopyHref: string | null
  readonly sourceBackupHref: string | null
  readonly duplicateClaimId: string | null
  readonly structuredEvidenceAvailable: boolean
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function driveHref(value: unknown): string | null {
  const id = text(value)
  return id && /^[A-Za-z0-9_-]{10,}$/.test(id)
    ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`
    : null
}

/** Only project-review fields leave the server; never forward raw media URLs. */
export function warrantySourceEvidence(raw: string): WarrantySourceEvidence {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    payload = null
  }
  const fields = field(payload, "sourceDetailFields")
  const internal = Array.isArray(fields)
    ? fields.find((item: unknown) => field(item, "id") === "internalComments")
    : undefined
  const audiences = field(payload, "commentAudiences")
  const comments = ["Internal", "Clients", "Subs/vendors"].flatMap((audience) => {
    const body = text(field(audiences, audience))
    return body ? [{ audience, text: body }] : []
  })
  const services = field(payload, "services")
  const evidence = field(payload, "sourceEvidence")
  return {
    internalNotes: text(field(internal, "value")),
    comments,
    serviceCount: Array.isArray(services)
      ? services.filter((item: unknown) => text(field(item, "serviceId"))).length
      : null,
    readingCopyHref: driveHref(field(evidence, "readingCopyDriveId")),
    sourceBackupHref: driveHref(field(evidence, "rawPackageDriveId")),
    duplicateClaimId: text(field(field(payload, "duplicateReview"), "existingCompassClaimId")),
    structuredEvidenceAvailable: typeof payload === "object" && payload !== null && !Array.isArray(payload),
  }
}

/** Date-only source values are calendar dates, not local midnight timestamps. */
export function warrantySourceDate(value: string | null): string {
  if (!value) return "Not recorded"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return value
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}
