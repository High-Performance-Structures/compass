import { projectNumberReviewIssue } from "@/lib/project-number-review"

export type ProjectDuplicateIdentity = {
  readonly id: string
  readonly projectNumber: string | null
  readonly name: string
  readonly clientName: string | null
  readonly address: string | null
  readonly sageJobId: string | null
  readonly sageJobNumber: string | null
  readonly googleDriveFolderId: string | null
  readonly buildertrendProjectId: string | null
  readonly createdAt: string
}

export type ProjectDuplicateReasonCode =
  | "project_number"
  | "project_department_sequence"
  | "sage_job_id"
  | "sage_job_number"
  | "drive_folder"
  | "buildertrend_project"
  | "project_name"
  | "similar_project_name"
  | "client_name"
  | "project_address"

export type ProjectDuplicateReason = {
  readonly code: ProjectDuplicateReasonCode
  readonly label: string
  readonly weight: number
}

export type ProjectDuplicateMatch = {
  readonly score: number
  readonly confidence: "medium" | "high"
  readonly reasons: readonly ProjectDuplicateReason[]
}

export type ProjectDuplicateCandidate = ProjectDuplicateMatch & {
  readonly first: ProjectDuplicateIdentity
  readonly second: ProjectDuplicateIdentity
}

const DUPLICATE_SCORE_THRESHOLD = 60

function normalizedText(value: string | null): string {
  return (value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function normalizedIdentifier(value: string | null): string {
  return normalizedText(value).replace(/\s+/g, "")
}

function projectDepartmentSequence(value: string | null): string | null {
  if (!value) return null
  // Extra-segment cutover values need a human numbering decision before they
  // can safely participate in the governed department/sequence rule.
  if (projectNumberReviewIssue(value)) return null
  const match = /^([OHND])\s*-\s*(\d+)(?:\s*-\s*[A-Z0-9]+)?$/i.exec(
    value.trim(),
  )
  const department = match?.[1]?.toUpperCase()
  const rawSequence = match?.[2]
  if (!department || !rawSequence) return null

  const sequence = rawSequence.replace(/^0+(?=\d)/, "")
  return `${department}-${sequence}`
}

function tokens(value: string): ReadonlySet<string> {
  return new Set(value.split(" ").filter((token) => token.length > 1))
}

function tokenSimilarity(first: string, second: string): number {
  const firstTokens = tokens(first)
  const secondTokens = tokens(second)
  if (firstTokens.size === 0 || secondTokens.size === 0) return 0

  let overlap = 0
  for (const token of firstTokens) {
    if (secondTokens.has(token)) overlap += 1
  }
  return (2 * overlap) / (firstTokens.size + secondTokens.size)
}

function exactReason(
  code: ProjectDuplicateReasonCode,
  label: string,
  weight: number,
  first: string | null,
  second: string | null,
  identifier = false,
): ProjectDuplicateReason | null {
  const normalize = identifier ? normalizedIdentifier : normalizedText
  const firstValue = normalize(first)
  const secondValue = normalize(second)
  if (!firstValue || firstValue !== secondValue) return null
  return { code, label, weight }
}

export function compareProjectDuplicateIdentity(
  first: ProjectDuplicateIdentity,
  second: ProjectDuplicateIdentity,
): ProjectDuplicateMatch | null {
  if (first.id === second.id) return null

  const reasons: ProjectDuplicateReason[] = []
  const exactProjectNumberReason = exactReason(
    "project_number",
    "Same Compass project number",
    100,
    first.projectNumber,
    second.projectNumber,
    true,
  )
  const firstDepartmentSequence = projectDepartmentSequence(first.projectNumber)
  const secondDepartmentSequence = projectDepartmentSequence(second.projectNumber)
  const exactReasons = [
    exactProjectNumberReason,
    !exactProjectNumberReason &&
    firstDepartmentSequence &&
    firstDepartmentSequence === secondDepartmentSequence
      ? {
          code: "project_department_sequence" as const,
          label: "Same project department and sequence",
          weight: 100,
        }
      : null,
    exactReason(
      "sage_job_id",
      "Same Sage internal ID",
      100,
      first.sageJobId,
      second.sageJobId,
      true,
    ),
    exactReason(
      "sage_job_number",
      "Same Sage job number",
      100,
      first.sageJobNumber,
      second.sageJobNumber,
      true,
    ),
    exactReason(
      "drive_folder",
      "Same Google Drive folder",
      100,
      first.googleDriveFolderId,
      second.googleDriveFolderId,
      true,
    ),
    exactReason(
      "buildertrend_project",
      "Same Buildertrend project ID",
      100,
      first.buildertrendProjectId,
      second.buildertrendProjectId,
      true,
    ),
    exactReason(
      "project_name",
      "Same project name",
      45,
      first.name,
      second.name,
    ),
    exactReason(
      "client_name",
      "Same client",
      25,
      first.clientName,
      second.clientName,
    ),
    exactReason(
      "project_address",
      "Same project address",
      55,
      first.address,
      second.address,
    ),
  ]
  reasons.push(
    ...exactReasons.filter(
      (reason): reason is ProjectDuplicateReason => reason !== null,
    ),
  )

  const hasExactName = reasons.some((reason) => reason.code === "project_name")
  const firstName = normalizedText(first.name)
  const secondName = normalizedText(second.name)
  if (
    !hasExactName &&
    firstName.length >= 5 &&
    secondName.length >= 5 &&
    tokenSimilarity(firstName, secondName) >= 0.8
  ) {
    reasons.push({
      code: "similar_project_name",
      label: "Very similar project name",
      weight: 35,
    })
  }

  const score = Math.min(
    100,
    reasons.reduce((total, reason) => total + reason.weight, 0),
  )
  if (score < DUPLICATE_SCORE_THRESHOLD) return null

  return {
    score,
    confidence: score >= 85 ? "high" : "medium",
    reasons,
  }
}

export function projectDuplicatePairKey(
  firstProjectId: string,
  secondProjectId: string,
): string {
  return JSON.stringify([firstProjectId, secondProjectId].sort())
}

export function findProjectDuplicateCandidates(
  projects: readonly ProjectDuplicateIdentity[],
): ProjectDuplicateCandidate[] {
  const candidates: ProjectDuplicateCandidate[] = []

  for (let firstIndex = 0; firstIndex < projects.length; firstIndex += 1) {
    const first = projects[firstIndex]
    if (!first) continue
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < projects.length;
      secondIndex += 1
    ) {
      const second = projects[secondIndex]
      if (!second) continue
      const match = compareProjectDuplicateIdentity(first, second)
      if (match) candidates.push({ first, second, ...match })
    }
  }

  return candidates.sort(
    (first, second) =>
      second.score - first.score ||
      first.first.createdAt.localeCompare(second.first.createdAt),
  )
}
