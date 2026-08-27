export function importedDailyLogAuthor(tags: string | null): string | null {
  if (tags === null) return null

  try {
    const parsed: unknown = JSON.parse(tags)
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }

    const author: unknown = Reflect.get(parsed, "buildertrendAuthor")
    if (typeof author !== "string") return null
    const trimmed = author.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

export function dailyLogAuthorName(input: {
  readonly compassAuthorName: string | null
  readonly tags: string | null
}): string | null {
  return input.compassAuthorName ?? importedDailyLogAuthor(input.tags)
}
