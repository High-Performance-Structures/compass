import {
  projectNumberDepartmentSequence,
  projectNumberReviewIssue,
} from "@/lib/project-number-review"

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
const TRANSITIVE_EXACT_REASON_CODES: ReadonlySet<ProjectDuplicateReasonCode> =
  new Set([
    "sage_job_id",
    "sage_job_number",
    "drive_folder",
    "buildertrend_project",
  ])

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
  const firstDepartmentSequence = projectNumberDepartmentSequence(
    first.projectNumber,
    first.name,
  )
  const secondDepartmentSequence = projectNumberDepartmentSequence(
    second.projectNumber,
    second.name,
  )
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
  const collisionGroups = new Map<string, ProjectDuplicateIdentity[]>()

  for (const project of projects) {
    const key = projectNumberDepartmentSequence(project.projectNumber, project.name)
    if (!key) continue
    const group = collisionGroups.get(key) ?? []
    group.push(project)
    collisionGroups.set(key, group)
  }

  const collisionAnchorByKey = new Map<string, string>()
  for (const [key, group] of collisionGroups) {
    if (group.length < 3) continue
    const ordered = [...group].sort((first, second) => {
      const firstIsBuildertrendPlaceholder =
        projectNumberReviewIssue(first.projectNumber, first.name)?.reason ===
        "buildertrend_placeholder"
      const secondIsBuildertrendPlaceholder =
        projectNumberReviewIssue(second.projectNumber, second.name)?.reason ===
        "buildertrend_placeholder"
      if (firstIsBuildertrendPlaceholder !== secondIsBuildertrendPlaceholder) {
        return firstIsBuildertrendPlaceholder ? 1 : -1
      }
      return first.createdAt.localeCompare(second.createdAt) ||
        first.id.localeCompare(second.id)
    })
    const anchor = ordered[0]
    if (anchor) collisionAnchorByKey.set(key, anchor.id)
  }

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
      if (!match) continue

      const collisionKey = projectNumberDepartmentSequence(
        first.projectNumber,
        first.name,
      )
      const anchorId = collisionKey
        ? collisionAnchorByKey.get(collisionKey)
        : undefined
      const isTransitiveCollisionOnly =
        anchorId !== undefined &&
        first.id !== anchorId &&
        second.id !== anchorId &&
        match.reasons.some(
          (reason) => reason.code === "project_department_sequence",
        ) &&
        !match.reasons.some((reason) =>
          TRANSITIVE_EXACT_REASON_CODES.has(reason.code),
        )
      if (!isTransitiveCollisionOnly) {
        candidates.push({ first, second, ...match })
      }
    }
  }

  return candidates.sort(
    (first, second) =>
      second.score - first.score ||
      first.first.createdAt.localeCompare(second.first.createdAt),
  )
}
