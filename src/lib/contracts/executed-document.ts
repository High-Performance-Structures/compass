export type ExecutedContractDocumentReplacement = {
  readonly url: string
  readonly label: string
  readonly reason: string
}

function requiredLimitedText(
  value: string | null,
  label: string,
  maximumLength: number
): string {
  const cleaned = value?.trim() ?? ""
  if (!cleaned) throw new Error(`${label} is required.`)
  if (cleaned.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer.`)
  }
  return cleaned
}

export function validateExecutedContractDocumentReplacement(input: {
  readonly evidenceUrl: string | null
  readonly evidenceLabel: string | null
  readonly reason: string | null
  readonly attested: boolean
}): ExecutedContractDocumentReplacement {
  if (!input.attested) {
    throw new Error(
      "Confirm that the replacement is the same fully executed contract packet."
    )
  }

  const evidenceUrl = requiredLimitedText(
    input.evidenceUrl,
    "Replacement contract link",
    2_000
  )
  let parsedUrl: URL
  try {
    parsedUrl = new URL(evidenceUrl)
  } catch {
    throw new Error("Enter a valid replacement contract link.")
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("The replacement contract must use a secure HTTPS link.")
  }

  return {
    url: parsedUrl.toString(),
    label: requiredLimitedText(input.evidenceLabel, "Document label", 200),
    reason: requiredLimitedText(input.reason, "Replacement reason", 1_000),
  }
}
