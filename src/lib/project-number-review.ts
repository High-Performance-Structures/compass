import { projectNumberParts } from "@/lib/project-profile"

export type ProjectNumberReviewIssue = {
  readonly currentProjectNumber: string
  readonly department: "O" | "H" | "N" | "D"
  readonly sequence: string
  readonly suggestedProjectNumber: string
  readonly reason: "extra_segments"
}

const EXTRA_SEGMENT_PROJECT_NUMBER_PATTERN =
  /^([OHND])\s*-\s*(\d+)\s*-\s*([A-Z0-9]+)(?:\s*-\s*[A-Z0-9]+)+$/i

/**
 * Identifies cutover-style project numbers with an extra estimate/version
 * segment. The suggested value is only a starting point for human review.
 */
export function projectNumberReviewIssue(
  value: string | null,
): ProjectNumberReviewIssue | null {
  if (!value) return null
  const trimmed = value.trim()
  const match = EXTRA_SEGMENT_PROJECT_NUMBER_PATTERN.exec(trimmed)
  const department = match?.[1]?.toUpperCase()
  const sequence = match?.[2]
  const addressSuffix = match?.[3]?.toUpperCase()
  if (
    (department !== "O" &&
      department !== "H" &&
      department !== "N" &&
      department !== "D") ||
    !sequence ||
    !addressSuffix
  ) {
    return null
  }

  return {
    currentProjectNumber: trimmed,
    department,
    sequence,
    suggestedProjectNumber: `${department}-${sequence}-${addressSuffix}`,
    reason: "extra_segments",
  }
}

export function isApprovedProjectNumber(value: string | null): boolean {
  return value !== null && projectNumberParts(value) !== null
}

export function isExactProjectNumberReviewMerge(input: {
  readonly reviewedProjectNumber: string | null
  readonly keptProjectNumber: string | null
}): boolean {
  const issue = projectNumberReviewIssue(input.reviewedProjectNumber)
  return (
    issue !== null &&
    input.keptProjectNumber?.trim().toUpperCase() ===
      issue.suggestedProjectNumber
  )
}
