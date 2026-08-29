export type SocialProjectPrivacyInput = {
  readonly publicTitle: string | null
  readonly publicLocationCity: string | null
  readonly internalProjectName: string
  readonly clientName: string | null
  readonly siteAddress: string | null
}

const STREET_SUFFIX = /\b(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|circle|cir\.?|boulevard|blvd\.?|highway|hwy\.?|trail|trl\.?)\b/i
const STREET_ADDRESS = /\b\d{1,6}\s+[A-Za-z0-9][A-Za-z0-9 .'-]{1,50}\b/
const ZIP_CODE = /\b\d{5}(?:-\d{4})?\b/
const COORDINATES = /\b-?\d{1,3}\.\d{4,}\s*[,/]\s*-?\d{1,3}\.\d{4,}\b/

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

function containsSensitiveName(copy: string, value: string | null): boolean {
  const candidate = value?.trim() ?? ""
  return candidate.length >= 4 && copy.toLowerCase().includes(candidate.toLowerCase())
}

export function validatePublicProjectIdentity(input: {
  readonly publicTitle: string
  readonly locationCity: string
  readonly internalProjectName?: string | null
  readonly clientName?: string | null
}): readonly string[] {
  const title = normalized(input.publicTitle)
  const city = normalized(input.locationCity)
  const errors: string[] = []

  if (title.length < 3 || title.length > 80) {
    errors.push("Public project title must be 3–80 characters.")
  }
  if (STREET_ADDRESS.test(title) || STREET_SUFFIX.test(title)) {
    errors.push("Public project title cannot contain a street address.")
  }
  if (containsSensitiveName(title, input.clientName ?? null)) {
    errors.push("Public project title cannot contain the client name.")
  }
  const internalProjectName = input.internalProjectName?.trim() ?? ""
  if (
    internalProjectName.length >= 4 &&
    title.toLowerCase() === internalProjectName.toLowerCase()
  ) {
    errors.push("Public project title must differ from the internal project name.")
  }
  if (city.length < 2 || city.length > 80 || !/^[\p{L} .'-]+$/u.test(city)) {
    errors.push("Public location must contain a town or city name only.")
  }
  return errors
}

export function socialCopyPrivacyViolations(
  copy: string,
  project: SocialProjectPrivacyInput,
): readonly string[] {
  const combined = normalized(copy)
  const violations: string[] = []
  const internalName = project.internalProjectName.trim()
  const publicTitle = project.publicTitle?.trim() ?? ""

  if (
    internalName.length >= 4 &&
    internalName.toLowerCase() !== publicTitle.toLowerCase() &&
    containsSensitiveName(combined, internalName)
  ) {
    violations.push("internal project name")
  }
  if (containsSensitiveName(combined, project.clientName)) {
    violations.push("client name")
  }
  const streetLine = project.siteAddress?.split(",")[0]?.trim() ?? ""
  if (containsSensitiveName(combined, streetLine)) {
    violations.push("street address")
  }
  if ((STREET_ADDRESS.test(combined) && STREET_SUFFIX.test(combined)) || ZIP_CODE.test(combined)) {
    violations.push("street address or ZIP code")
  }
  if (COORDINATES.test(combined)) {
    violations.push("GPS coordinates")
  }
  return [...new Set(violations)]
}

export function normalizeHashtags(values: readonly string[]): readonly string[] {
  const tags: string[] = []
  for (const raw of values) {
    const tag = raw.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")
    if (!tag || tag.length > 50) continue
    const normalizedTag = `#${tag}`
    if (!tags.some((value) => value.toLowerCase() === normalizedTag.toLowerCase())) {
      tags.push(normalizedTag)
    }
    if (tags.length === 12) break
  }
  return tags
}

export function socialPostText(input: {
  readonly heading: string
  readonly body: string
  readonly hashtags: readonly string[]
}): string {
  return [
    input.heading.trim(),
    input.body.trim(),
    normalizeHashtags(input.hashtags).join(" "),
  ].filter(Boolean).join("\n\n")
}
