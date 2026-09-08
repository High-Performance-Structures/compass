import { projectNumberParts } from "@/lib/project-profile"

export function projectNumberReviewDecisionKey(
  projectId: string,
  projectNumber: string,
): string {
  return `${projectId}:${projectNumber.trim().toUpperCase()}`
}

export type ProjectNumberReviewIssue = {
  readonly currentProjectNumber: string
  readonly department: "O" | "H" | "N" | "D" | null
  readonly sequence: string | null
  readonly suggestedProjectNumber: string | null
  readonly reason: "buildertrend_placeholder" | "extra_segments"
}

const EXTRA_SEGMENT_PROJECT_NUMBER_PATTERN =
  /^([OHND])\s*-\s*(\d+)\s*-\s*([A-Z0-9]+)(?:\s*-\s*[A-Z0-9]+)+$/i
const BUILDERTREND_PROJECT_NUMBER_PATTERN = /^BT(?:-[A-Z0-9]+)+$/i
const LEADING_GOVERNED_PROJECT_NUMBER_PATTERN =
  /^\s*([OHND])\s*-\s*(\d+)\s*-\s*([A-Z0-9]+)(?=\s|-|$)/i

function governedNumberFromProjectName(projectName: string | null): {
  readonly department: "O" | "H" | "N" | "D"
  readonly sequence: string
  readonly projectNumber: string
} | null {
  if (!projectName) return null
  const match = LEADING_GOVERNED_PROJECT_NUMBER_PATTERN.exec(projectName)
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
    department,
    sequence,
    projectNumber: `${department}-${sequence}-${addressSuffix}`,
  }
}

/**
 * Identifies cutover-style project numbers with an extra estimate/version
 * segment. The suggested value is only a starting point for human review.
 */
export function projectNumberReviewIssue(
  value: string | null,
  projectName: string | null = null,
): ProjectNumberReviewIssue | null {
  if (!value) return null
  const trimmed = value.trim()
  if (BUILDERTREND_PROJECT_NUMBER_PATTERN.test(trimmed)) {
    const inferred = governedNumberFromProjectName(projectName)
    return {
      currentProjectNumber: trimmed,
      department: inferred?.department ?? null,
      sequence: inferred?.sequence ?? null,
      suggestedProjectNumber: inferred?.projectNumber ?? null,
      reason: "buildertrend_placeholder",
    }
  }
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

/**
 * Returns the governed collision key. Buildertrend placeholders participate
 * only when their project name starts with an explicit governed number.
 */
export function projectNumberDepartmentSequence(
  value: string | null,
  projectName: string | null = null,
): string | null {
  if (!value) return null
  const issue = projectNumberReviewIssue(value, projectName)
  if (issue?.reason === "extra_segments") return null
  const candidate = issue?.suggestedProjectNumber ?? value
  const match = /^([OHND])\s*-\s*(\d+)(?:\s*-\s*[A-Z0-9]+)?$/i.exec(
    candidate.trim(),
  )
  const department = match?.[1]?.toUpperCase()
  const rawSequence = match?.[2]
  if (!department || !rawSequence) return null

  const sequence = rawSequence.replace(/^0+(?=\d)/, "")
  return `${department}-${sequence}`
}

export function isApprovedProjectNumber(value: string | null): boolean {
  return value !== null && projectNumberParts(value) !== null
}

export function isExactProjectNumberReviewMerge(input: {
  readonly reviewedProjectNumber: string | null
  readonly reviewedProjectName?: string | null
  readonly keptProjectNumber: string | null
}): boolean {
  const issue = projectNumberReviewIssue(
    input.reviewedProjectNumber,
    input.reviewedProjectName ?? null,
  )
  return (
    issue !== null &&
    issue.suggestedProjectNumber !== null &&
    input.keptProjectNumber?.trim().toUpperCase() ===
      issue.suggestedProjectNumber
  )
}
