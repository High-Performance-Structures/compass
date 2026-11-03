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

type ProjectDuplicateReasonCode =
  | "manual_registry_selection"
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
  | "project_location_suffix"

type ProjectDuplicateReason = {
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

function normalizedProjectName(value: string): string {
  const withoutLeadingProjectNumber = value.replace(
    /^\s*[OHND]\s*-\s*\d+\s*-\s*[A-Z0-9]+(?:\s*-\s*\d+)?(?:\s*[-—:]\s*|\s+)/i,
    "",
  )
  return normalizedText(withoutLeadingProjectNumber || value)
}

function projectLocationSuffix(
  value: string | null,
  projectName: string,
): string | null {
  if (!value) return null
  const issue = projectNumberReviewIssue(value, projectName)
  const candidate = issue?.suggestedProjectNumber ?? value
  const match = /^[OHND]\s*-\s*\d+\s*-\s*(\d+)$/i.exec(candidate.trim())
  const rawSuffix = match?.[1]
  if (!rawSuffix) return null

  const suffix = rawSuffix.replace(/^0+(?=\d)/, "")
  return suffix === "0" ? null : suffix
}

function tokens(value: string): ReadonlySet<string> {
  return new Set(value.split(" ").filter((token) => token.length > 1))
}

function tokenSimilarity(
  firstTokens: ReadonlySet<string>,
  secondTokens: ReadonlySet<string>,
): number {
  if (firstTokens.size === 0 || secondTokens.size === 0) return 0

  let overlap = 0
  for (const token of firstTokens) {
    if (secondTokens.has(token)) overlap += 1
  }
  return (2 * overlap) / (firstTokens.size + secondTokens.size)
}

/**
 * Everything the pairwise comparison needs from one project, normalized once.
 * The registry scan compares every pair of projects (n² / 2), so normalizing
 * inside the comparison made a 1,100-project scan take seconds.
 */
type DuplicateProfile = {
  readonly id: string
  readonly projectNumber: string
  readonly departmentSequence: string | null
  readonly sageJobId: string
  readonly sageJobNumber: string
  readonly googleDriveFolderId: string
  readonly buildertrendProjectId: string
  readonly exactName: string
  readonly clientName: string
  readonly address: string
  readonly locationSuffix: string | null
  readonly name: string
  readonly nameTokens: ReadonlySet<string>
}

function duplicateProfile(project: ProjectDuplicateIdentity): DuplicateProfile {
  const name = normalizedProjectName(project.name)
  return {
    id: project.id,
    projectNumber: normalizedIdentifier(project.projectNumber),
    departmentSequence: projectNumberDepartmentSequence(
      project.projectNumber,
      project.name,
    ),
    sageJobId: normalizedIdentifier(project.sageJobId),
    sageJobNumber: normalizedIdentifier(project.sageJobNumber),
    googleDriveFolderId: normalizedIdentifier(project.googleDriveFolderId),
    buildertrendProjectId: normalizedIdentifier(project.buildertrendProjectId),
    exactName: normalizedText(name),
    clientName: normalizedText(project.clientName),
    address: normalizedText(project.address),
    locationSuffix: projectLocationSuffix(project.projectNumber, project.name),
    name,
    nameTokens: tokens(name),
  }
}

function exactReason(
  code: ProjectDuplicateReasonCode,
  label: string,
  weight: number,
  firstValue: string,
  secondValue: string,
): ProjectDuplicateReason | null {
  if (!firstValue || firstValue !== secondValue) return null
  return { code, label, weight }
}

function sameValue(first: string | null, second: string | null): boolean {
  return first !== null && first !== "" && first === second
}

function sharesAnyValue(first: DuplicateProfile, second: DuplicateProfile): boolean {
  return (
    sameValue(first.projectNumber, second.projectNumber) ||
    sameValue(first.departmentSequence, second.departmentSequence) ||
    sameValue(first.sageJobId, second.sageJobId) ||
    sameValue(first.sageJobNumber, second.sageJobNumber) ||
    sameValue(first.googleDriveFolderId, second.googleDriveFolderId) ||
    sameValue(first.buildertrendProjectId, second.buildertrendProjectId) ||
    sameValue(first.exactName, second.exactName) ||
    sameValue(first.clientName, second.clientName) ||
    sameValue(first.address, second.address) ||
    sameValue(first.locationSuffix, second.locationSuffix)
  )
}

function compareDuplicateProfiles(
  first: DuplicateProfile,
  second: DuplicateProfile,
): ProjectDuplicateMatch | null {
  if (first.id === second.id) return null
  // Without one shared value the only possible reason is a similar name
  // (35), below the threshold: most pairs stop here without allocating.
  if (!sharesAnyValue(first, second)) return null

  const reasons: ProjectDuplicateReason[] = []
  const exactProjectNumberReason = exactReason(
    "project_number",
    "Same Compass project number",
    100,
    first.projectNumber,
    second.projectNumber,
  )
  const exactReasons = [
    exactProjectNumberReason,
    !exactProjectNumberReason &&
    first.departmentSequence &&
    first.departmentSequence === second.departmentSequence
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
    ),
    exactReason(
      "sage_job_number",
      "Same Sage job number",
      100,
      first.sageJobNumber,
      second.sageJobNumber,
    ),
    exactReason(
      "drive_folder",
      "Same Google Drive folder",
      100,
      first.googleDriveFolderId,
      second.googleDriveFolderId,
    ),
    exactReason(
      "buildertrend_project",
      "Same Buildertrend project ID",
      100,
      first.buildertrendProjectId,
      second.buildertrendProjectId,
    ),
    exactReason(
      "project_name",
      "Same project name",
      45,
      first.exactName,
      second.exactName,
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

  const hasExactAddress = reasons.some(
    (reason) => reason.code === "project_address",
  )
  if (
    !hasExactAddress &&
    first.locationSuffix &&
    first.locationSuffix === second.locationSuffix
  ) {
    reasons.push({
      code: "project_location_suffix",
      label: "Same project location suffix",
      weight: 35,
    })
  }

  const hasExactName = reasons.some((reason) => reason.code === "project_name")
  if (
    !hasExactName &&
    first.name.length >= 5 &&
    second.name.length >= 5 &&
    tokenSimilarity(first.nameTokens, second.nameTokens) >= 0.8
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

export function compareProjectDuplicateIdentity(
  first: ProjectDuplicateIdentity,
  second: ProjectDuplicateIdentity,
): ProjectDuplicateMatch | null {
  if (first.id === second.id) return null
  return compareDuplicateProfiles(duplicateProfile(first), duplicateProfile(second))
}

export function projectDuplicatePairKey(
  firstProjectId: string,
  secondProjectId: string,
): string {
  return JSON.stringify([firstProjectId, secondProjectId].sort())
}

/** Evidence that only says two jobs are for the same customer. */
const SAME_CUSTOMER_REASON_CODES: ReadonlySet<ProjectDuplicateReasonCode> =
  new Set([
    "project_name",
    "similar_project_name",
    "client_name",
    "project_location_suffix",
  ])

export type ProjectDuplicateScanOptions = {
  /**
   * Department codes whose customers routinely place repeat orders, each its
   * own job with its own number (a company setting).
   */
  readonly repeatOrderDepartments?: ReadonlySet<string>
}

/** Orders this far apart are separate orders, even at the same site. */
const SEPARATE_ORDER_MINIMUM_MS = 24 * 60 * 60 * 1000

function placedOnDifferentDays(first: string, second: string): boolean {
  const firstTime = Date.parse(first)
  const secondTime = Date.parse(second)
  if (Number.isNaN(firstTime) || Number.isNaN(secondTime)) return false
  return Math.abs(firstTime - secondTime) > SEPARATE_ORDER_MINIMUM_MS
}

/**
 * Separate orders from a repeat customer: different project numbers, at least
 * one in a repeat-order department, and nothing in common beyond the
 * customer. A shared site address also counts as a repeat order when the two
 * were placed more than a day apart (follow-up orders for the same
 * building); same-day orders at one address may be a double entry. A shared
 * Sage job, Drive folder or Buildertrend project still counts as a possible
 * duplicate.
 */
function isRepeatOrderPair(
  first: ProjectDuplicateIdentity,
  second: ProjectDuplicateIdentity,
  firstKey: string | null,
  secondKey: string | null,
  reasons: readonly ProjectDuplicateReason[],
  repeatOrderDepartments: ReadonlySet<string> | undefined,
): boolean {
  if (!repeatOrderDepartments || repeatOrderDepartments.size === 0) return false
  if (!firstKey || !secondKey || firstKey === secondKey) return false
  const firstDepartment = firstKey.charAt(0)
  const secondDepartment = secondKey.charAt(0)
  if (
    !repeatOrderDepartments.has(firstDepartment) &&
    !repeatOrderDepartments.has(secondDepartment)
  ) {
    return false
  }
  const separateDays = placedOnDifferentDays(first.createdAt, second.createdAt)
  return reasons.every(
    (reason) =>
      SAME_CUSTOMER_REASON_CODES.has(reason.code) ||
      (reason.code === "project_address" && separateDays),
  )
}

export function findProjectDuplicateCandidates(
  projects: readonly ProjectDuplicateIdentity[],
  options: ProjectDuplicateScanOptions = {},
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

  const profiles = projects.map(duplicateProfile)
  for (let firstIndex = 0; firstIndex < projects.length; firstIndex += 1) {
    const first = projects[firstIndex]
    const firstProfile = profiles[firstIndex]
    if (!first || !firstProfile) continue
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < projects.length;
      secondIndex += 1
    ) {
      const second = projects[secondIndex]
      const secondProfile = profiles[secondIndex]
      if (!second || !secondProfile) continue
      const match = compareDuplicateProfiles(firstProfile, secondProfile)
      if (!match) continue
      if (
        isRepeatOrderPair(
          first,
          second,
          firstProfile.departmentSequence,
          secondProfile.departmentSequence,
          match.reasons,
          options.repeatOrderDepartments,
        )
      ) {
        continue
      }

      const collisionKey = firstProfile.departmentSequence
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
