export function ownerFacingExternalText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) return null
  if (trimmed.startsWith("Buildertrend title:")) return null
  if (trimmed.includes("Buildertrend job ID:")) return null

  const withoutProviderUrls = trimmed
    .split("\n")
    .filter(
      (line) =>
        !/https?:\/\/(?:(?:[a-z0-9-]+\.)*youtube\.com|youtu\.be|drive\.google\.com)\//i.test(
          line
        )
    )
    .join("\n")
    .trim()
  return withoutProviderUrls.length > 0 ? withoutProviderUrls : null
}

export function ownerFacingDailyLogNotes(value: string | null): string | null {
  return ownerFacingExternalText(value)
}
