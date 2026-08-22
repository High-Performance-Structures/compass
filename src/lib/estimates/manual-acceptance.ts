export type EstimateAcceptanceMethod =
  | "foxit"
  | "wet_signature"
  | "external_esignature"

export const ESTIMATE_ACCEPTANCE_EVIDENCE_MAX_BYTES = 50 * 1024 * 1024

const ACCEPTANCE_EVIDENCE_MIME_TYPES = new Set([
  "application/msword",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

export function isEstimateAcceptanceMethod(
  value: string | null
): value is EstimateAcceptanceMethod {
  return (
    value === "foxit" ||
    value === "wet_signature" ||
    value === "external_esignature"
  )
}

export function estimateAcceptanceMethodLabel(
  method: EstimateAcceptanceMethod
): string {
  if (method === "foxit") return "Foxit eSignature"
  if (method === "wet_signature") return "Printed and signed document"
  return "External eSignature"
}

export function estimateAcceptanceDate(
  value: string | null,
  now = new Date()
): string {
  const cleaned = value?.trim() ?? ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new Error("Client acceptance date must be a valid date.")
  }
  const parsed = new Date(`${cleaned}T00:00:00.000Z`)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== cleaned
  ) {
    throw new Error("Client acceptance date must be a valid date.")
  }
  const tomorrow = new Date(now)
  tomorrow.setUTCHours(0, 0, 0, 0)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  if (parsed >= tomorrow) {
    throw new Error("Client acceptance date cannot be in the future.")
  }
  return `${cleaned}T12:00:00.000Z`
}

export function validateEstimateAcceptanceEvidence(input: {
  readonly size: number
  readonly type: string
}): void {
  if (input.size <= 0) {
    throw new Error("The selected signed document is empty.")
  }
  if (input.size > ESTIMATE_ACCEPTANCE_EVIDENCE_MAX_BYTES) {
    throw new Error("The signed document must be 50 MB or smaller.")
  }
  if (!ACCEPTANCE_EVIDENCE_MIME_TYPES.has(input.type)) {
    throw new Error(
      "Upload the signed document as a PDF, Word document, or image."
    )
  }
}

export function isEstimateAcceptanceEvidenceMimeType(
  mimeType: string
): boolean {
  return ACCEPTANCE_EVIDENCE_MIME_TYPES.has(mimeType)
}
