/*
 * Buildertrend staging manifest rules: the manifest shape, its validation,
 * and the stable fingerprint that makes a replayed import idempotent. Pure:
 * no database or network access.
 */
import { z } from "zod/v4"

const optionalText = z.string().trim().min(1).optional()
const nullableText = z.string().trim().min(1).nullable().optional()

const sourceRecordSchema = z
  .object({
    sourceKey: z.string().trim().min(1),
    projectId: optionalText,
    sourceScope: z.string().trim().min(1).default("job"),
    sourceRecordType: z.string().trim().min(1),
    buildertrendJobId: optionalText,
    buildertrendLeadId: optionalText,
    buildertrendRecordId: optionalText,
    buildertrendRecordNumber: optionalText,
    buildertrendUrl: optionalText,
    title: z.string().trim().min(1),
    recordDate: optionalText,
    recordStatus: optionalText,
    sourceStatus: optionalText,
    departmentCode: optionalText,
    clientName: optionalText,
    contactName: optionalText,
    contactEmail: optionalText,
    amount: z.number().finite().optional(),
    searchableText: optionalText,
    normalizedSummary: optionalText,
    rawPayload: z.unknown().optional(),
    archiveDriveFolderId: optionalText,
    archiveDriveFileId: optionalText,
    archiveDriveUrl: optionalText,
    notes: optionalText,
  })
  .strict()

const archiveFileSchema = z
  .object({
    sourceKey: z.string().trim().min(1),
    sourceRecordKey: optionalText,
    projectId: optionalText,
    sourceScope: z.string().trim().min(1).default("job"),
    sourceRecordType: z.string().trim().min(1),
    buildertrendJobId: optionalText,
    buildertrendLeadId: optionalText,
    buildertrendFileId: optionalText,
    buildertrendUrl: optionalText,
    fileName: z.string().trim().min(1),
    mimeType: optionalText,
    fileSize: z.number().int().nonnegative().optional(),
    driveFolderId: optionalText,
    driveFileId: optionalText,
    driveUrl: optionalText,
    thumbnailDriveFileId: optionalText,
    thumbnailUrl: optionalText,
    checksum: optionalText,
    capturedAt: optionalText,
    metadata: z.unknown().optional(),
  })
  .strict()

const accessCandidateSchema = z
  .object({
    sourceKey: z.string().trim().min(1),
    sourceRecordKey: optionalText,
    projectId: optionalText,
    buildertrendJobId: optionalText,
    buildertrendLeadId: optionalText,
    buildertrendContactId: optionalText,
    buildertrendAccessRole: optionalText,
    contactName: z.string().trim().min(1),
    companyName: nullableText,
    email: nullableText,
    phone: nullableText,
    proposedContactType: z.string().trim().min(1).default("vendor"),
    proposedProjectRole: nullableText,
    notes: nullableText,
  })
  .strict()

const buildertrendStagingManifestSchema = z
  .object({
    runKey: z.string().trim().min(1),
    sourceMethod: z.string().trim().min(1),
    sourceLabel: z.string().trim().min(1),
    capturedAt: z.iso.datetime({ offset: true }),
    rawArtifactDriveFileId: optionalText,
    rawArtifactDriveUrl: optionalText,
    notes: optionalText,
    records: z.array(sourceRecordSchema).readonly().default([]),
    files: z.array(archiveFileSchema).readonly().default([]),
    accessCandidates: z
      .array(accessCandidateSchema)
      .readonly()
      .default([]),
  })
  .strict()

export type BuildertrendStagingManifest = z.infer<
  typeof buildertrendStagingManifestSchema
>

export type BuildertrendStagingSummary = {
  readonly runKey: string
  readonly sourceLabel: string
  readonly recordCount: number
  readonly fileCount: number
  readonly accessCandidateCount: number
}

export type BuildertrendStagingBuild = {
  readonly sql: string
  readonly statements: readonly string[]
  readonly summary: BuildertrendStagingSummary
}

export type BuildertrendStagingParseResult =
  | {
      readonly success: true
      readonly data: BuildertrendStagingManifest
    }
  | {
      readonly success: false
      readonly errors: readonly string[]
    }

export type ChildReference = {
  readonly projectId?: string
  readonly sourceRecordKey?: string
}

export async function manifestFingerprint(
  manifest: BuildertrendStagingManifest
): Promise<string> {
  const canonicalManifest = {
    ...manifest,
    records: [...manifest.records].sort((left, right) =>
      stableTextCompare(left.sourceKey, right.sourceKey)
    ),
    files: [...manifest.files].sort((left, right) =>
      stableTextCompare(left.sourceKey, right.sourceKey)
    ),
    accessCandidates: [...manifest.accessCandidates].sort((left, right) =>
      stableTextCompare(left.sourceKey, right.sourceKey)
    ),
  }
  const bytes = new TextEncoder().encode(
    JSON.stringify(canonicalJsonValue(canonicalManifest))
  )
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue)
  if (value === null || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => stableTextCompare(left, right))
      .map(([key, nestedValue]) => [key, canonicalJsonValue(nestedValue)])
  )
}

function stableTextCompare(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function ensureUniqueKeys(
  label: string,
  values: readonly { readonly sourceKey: string }[]
): readonly string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const value of values) {
    if (seen.has(value.sourceKey)) duplicates.add(value.sourceKey)
    seen.add(value.sourceKey)
  }

  return [...duplicates].map(
    (sourceKey) => `${label} contains duplicate sourceKey "${sourceKey}"`
  )
}

function validateManifestLinks(
  manifest: BuildertrendStagingManifest
): readonly string[] {
  const recordProjects = new Map(
    manifest.records.map((record) => [record.sourceKey, record.projectId])
  )
  const errors: string[] = []

  function validateChildren(
    label: string,
    children: readonly {
      readonly sourceKey: string
      readonly sourceRecordKey?: string
      readonly projectId?: string
    }[]
  ): void {
    for (const child of children) {
      if (!child.sourceRecordKey) continue
      const parentProjectId = recordProjects.get(child.sourceRecordKey)
      if (!recordProjects.has(child.sourceRecordKey)) continue
      if (
        parentProjectId &&
        child.projectId &&
        parentProjectId !== child.projectId
      ) {
        errors.push(
          `${label}.${child.sourceKey} projectId does not match source record "${child.sourceRecordKey}"`
        )
      }
    }
  }

  validateChildren("files", manifest.files)
  validateChildren("accessCandidates", manifest.accessCandidates)

  return errors
}

export function parseBuildertrendStagingManifest(
  value: unknown
): BuildertrendStagingParseResult {
  const result = buildertrendStagingManifestSchema.safeParse(value)
  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map(
        (issue) =>
          `${issue.path.length > 0 ? issue.path.join(".") : "manifest"}: ${issue.message}`
      ),
    }
  }

  const errors = [
    ...ensureUniqueKeys("records", result.data.records),
    ...ensureUniqueKeys("files", result.data.files),
    ...ensureUniqueKeys("accessCandidates", result.data.accessCandidates),
    ...validateManifestLinks(result.data),
  ]

  return errors.length > 0
    ? { success: false, errors }
    : { success: true, data: result.data }
}
