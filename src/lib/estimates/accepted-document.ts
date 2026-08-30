export function acceptedEstimateDocumentUrl(input: {
  readonly status: string
  readonly signaturePackageUrl: string | null
}): string | null {
  if (input.status !== "accepted" || !input.signaturePackageUrl) return null
  try {
    const url = new URL(input.signaturePackageUrl)
    return url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

export function acceptedEstimateEvidenceUrl(input: {
  readonly status: string
  readonly signaturePackageUrl: string | null
}): string | null {
  if (input.status !== "accepted" || !input.signaturePackageUrl) return null
  if (input.signaturePackageUrl.startsWith("/api/integrations/foxit/envelopes/")) {
    return input.signaturePackageUrl
  }
  return acceptedEstimateDocumentUrl(input)
}

export function acceptedEstimateDateLabel(value: string | null): string {
  if (!value) return "Date not recorded"
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value)
  if (!match) return "Date not recorded"
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return "Date not recorded"
  }
  return `${month}/${day}/${year}`
}
