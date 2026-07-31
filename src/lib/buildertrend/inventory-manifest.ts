import { z } from "zod/v4"

import {
  type BuildertrendStagingManifest,
  parseBuildertrendStagingManifest,
} from "./staging-manifest"

const optionalText = z
  .union([z.string(), z.null()])
  .transform((value) => value?.trim() || undefined)
  .optional()
const nullableText = z
  .union([z.string(), z.null()])
  .transform((value) => {
    if (value === null) return null
    return value.trim() || null
  })
  .optional()

const contactSchema = z
  .object({
    buildertrendContactId: optionalText,
    text: optionalText,
    name: optionalText,
    href: optionalText,
    email: nullableText,
    phone: nullableText,
    companyName: nullableText,
  })
  .passthrough()

const jobRowSchema = z
  .object({
    buildertrendJobId: optionalText,
    jobId: optionalText,
    href: optionalText,
    jobHref: optionalText,
    name: optionalText,
    jobName: optionalText,
    projectId: optionalText,
    rowText: optionalText,
    sourceContext: optionalText,
    pageSummary: optionalText,
    buildertrendStatus: optionalText,
    jobStatus: optionalText,
    address: optionalText,
    city: optionalText,
    state: optionalText,
    zipCode: optionalText,
    projectManager: optionalText,
    clientPhone: optionalText,
    clientEmail: optionalText,
    scheduleStatus: optionalText,
    cells: z.array(z.unknown()).optional(),
    contacts: z.array(contactSchema).optional(),
    contactLinks: z.array(contactSchema).optional(),
  })
  .passthrough()

const leadRowSchema = z
  .object({
    buildertrendLeadId: optionalText,
    leadId: optionalText,
    href: optionalText,
    title: optionalText,
    name: optionalText,
    projectId: optionalText,
    rowText: optionalText,
    sourceStatus: optionalText,
    status: optionalText,
    clientName: optionalText,
    contacts: z.array(contactSchema).optional(),
  })
  .passthrough()

const snapshotSchema = z
  .object({
    rows: z.array(z.unknown()),
    error: z.unknown().optional(),
    success: z.boolean().optional(),
  })
  .passthrough()

export const buildertrendInventoryKinds = [
  "jobs",
  "lead_opportunities",
] as const

export type BuildertrendInventoryKind =
  (typeof buildertrendInventoryKinds)[number]

export type BuildertrendInventoryManifestOptions = {
  readonly kind: BuildertrendInventoryKind
  readonly runKey: string
  readonly sourceLabel: string
  readonly capturedAt: string
  readonly sourceMethod?: string
  readonly rawArtifactDriveFileId?: string
  readonly rawArtifactDriveUrl?: string
  readonly notes?: string
  readonly allowEmpty?: boolean
  readonly expectedRowCount?: number
}

export type BuildertrendInventoryManifestSummary = {
  readonly kind: BuildertrendInventoryKind
  readonly recordCount: number
  readonly accessCandidateCount: number
  readonly missingProjectIdCount: number
}

export type BuildertrendInventoryManifestBuild =
  | {
      readonly success: true
      readonly manifest: BuildertrendStagingManifest
      readonly summary: BuildertrendInventoryManifestSummary
    }
  | {
      readonly success: false
      readonly errors: readonly string[]
    }

type InventoryRecord = BuildertrendStagingManifest["records"][number]
type AccessCandidate =
  BuildertrendStagingManifest["accessCandidates"][number]

function text(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim()
  }
  return ""
}

function firstText(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    const normalized = text(value)
    if (normalized) return normalized
  }
  return undefined
}

function cellText(cells: readonly unknown[] | undefined, index: number): string {
  return text(cells?.[index])
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90)
}

function stableTextCompare(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function departmentCode(value: string): string | undefined {
  return value.match(/^([OHND])-/)?.[1]
}

function projectNumber(value: string): string | undefined {
  return value.match(/^([OHND]-\d+(?:-\d+){0,2})\b/)?.[1]
}

function buildertrendIdFromHref(
  href: string | undefined,
  segment: "JobPage" | "Contact"
): string | undefined {
  if (!href) return undefined
  return href.match(new RegExp(`${segment}/(\\d+)`, "i"))?.[1]
}

function leadIdFromHref(href: string | undefined): string | undefined {
  if (!href) return undefined
  return href.match(/\/leads\/opportunities\/Lead\/(\d+)/i)?.[1]
}

function trustedBuildertrendUrl(candidate: string): URL | undefined {
  try {
    const url = new URL(candidate, "https://buildertrend.net")
    const hostname = url.hostname.toLowerCase()
    const allowed =
      hostname === "buildertrend.net" ||
      hostname.endsWith(".buildertrend.net") ||
      hostname === "buildertrend.com" ||
      hostname.endsWith(".buildertrend.com")
    if (
      !allowed ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port
    ) {
      return undefined
    }
    return url
  } catch {
    return undefined
  }
}

function trustedBuildertrendEntityUrl(
  href: string | undefined,
  fallbackPath: string,
  entityKind: "job" | "lead",
  entityId: string
): string | undefined {
  const url = trustedBuildertrendUrl(href || fallbackPath)
  if (!url) return undefined
  try {
    const pathMatches =
      entityKind === "job"
        ? new RegExp(`^/app/JobPage/${entityId}(?:/|$)`, "i").test(
            url.pathname
          )
        : new RegExp(
            `^/app/leads/opportunities/Lead/${entityId}(?:/|$)`,
            "i"
          ).test(url.pathname)
    if (!pathMatches) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function trustedBuildertrendContactId(
  href: string | undefined
): string | undefined {
  if (!href) return undefined
  const url = trustedBuildertrendUrl(href)
  if (!url) return undefined
  return url.pathname.match(/\/Contact\/(\d+)(?:\/|$)/i)?.[1]
}

function validBuildertrendId(value: string): boolean {
  return /^\d+$/.test(value)
}

function uniqueValues(values: readonly (string | undefined)[]): readonly string[] {
  return [...new Set(values.filter((value) => value !== undefined))]
}

function normalizedContacts(
  contacts: readonly z.infer<typeof contactSchema>[] | undefined
): readonly z.infer<typeof contactSchema>[] {
  return contacts ?? []
}

function contactName(
  contact: z.infer<typeof contactSchema>
): string | undefined {
  return firstText(contact.name, contact.text)
}

function contactIdentityError(
  contact: z.infer<typeof contactSchema>
): string | undefined {
  const explicitId = contact.buildertrendContactId
  const hrefId = trustedBuildertrendContactId(contact.href)
  if (explicitId && !validBuildertrendId(explicitId)) {
    return "Buildertrend contact ID must contain only digits"
  }
  if (contact.href && !hrefId) {
    return "Buildertrend contact link is not trusted"
  }
  if (explicitId && hrefId && explicitId !== hrefId) {
    return "Buildertrend contact ID does not match its contact link"
  }
  return undefined
}

function accessCandidate(
  scope: "job" | "lead",
  parentKey: string,
  projectId: string | undefined,
  buildertrendId: string,
  contact: z.infer<typeof contactSchema>
): AccessCandidate | null {
  const name = contactName(contact)
  if (!name) return null
  const buildertrendContactId =
    contact.buildertrendContactId ||
    trustedBuildertrendContactId(contact.href)
  const stableContactKey =
    buildertrendContactId || slug(contact.email || "") || slug(name)
  if (!stableContactKey) return null

  const combinedName = /\s(?:&|and|\+)\s/i.test(name)
  return {
    sourceKey: `access:${scope}:${buildertrendId}:${stableContactKey}`,
    sourceRecordKey: parentKey,
    projectId,
    ...(scope === "job"
      ? { buildertrendJobId: buildertrendId }
      : { buildertrendLeadId: buildertrendId }),
    buildertrendContactId,
    buildertrendAccessRole:
      scope === "job" ? "client" : "lead_contact",
    contactName: name,
    companyName: contact.companyName,
    email: contact.email,
    phone: contact.phone,
    proposedContactType: "customer",
    notes: combinedName
      ? "Combined Buildertrend contact name; split and verify identity before any portal invitation."
      : "Captured contact candidate only; this import does not grant portal access.",
  }
}

function normalizeJob(
  value: unknown,
  index: number
):
  | {
      readonly record: InventoryRecord
      readonly contacts: readonly AccessCandidate[]
    }
  | { readonly error: string } {
  const parsed = jobRowSchema.safeParse(value)
  if (!parsed.success) {
    return { error: `rows.${index}: ${parsed.error.issues[0]?.message}` }
  }

  const row = parsed.data
  const explicitJobIds = uniqueValues([
    row.buildertrendJobId,
    row.jobId,
  ])
  if (explicitJobIds.length > 1) {
    return {
      error: `rows.${index}: Buildertrend job ID aliases disagree`,
    }
  }
  const hrefs = uniqueValues([row.href, row.jobHref])
  const hrefJobIds = uniqueValues(
    hrefs.map((href) => buildertrendIdFromHref(href, "JobPage"))
  )
  if (hrefJobIds.length > 1) {
    return {
      error: `rows.${index}: Buildertrend job links disagree`,
    }
  }
  const explicitJobId = explicitJobIds[0]
  const hrefJobId = hrefJobIds[0]
  if (explicitJobId && !validBuildertrendId(explicitJobId)) {
    return {
      error: `rows.${index}: Buildertrend job ID must contain only digits`,
    }
  }
  if (explicitJobId && hrefJobId && explicitJobId !== hrefJobId) {
    return {
      error: `rows.${index}: Buildertrend job ID does not match its job link`,
    }
  }
  const jobId = explicitJobId || hrefJobId
  const title = firstText(row.name, row.jobName, cellText(row.cells, 2))
  if (!jobId || !title) {
    return {
      error: `rows.${index}: job inventory rows require a Buildertrend job ID and title`,
    }
  }

  const normalizedHrefs = (
    hrefs.length > 0 ? hrefs : [undefined]
  ).map((href) =>
    trustedBuildertrendEntityUrl(
      href,
      `/app/JobPage/${jobId}/1`,
      "job",
      jobId
    )
  )
  if (normalizedHrefs.some((href) => !href)) {
    return { error: `rows.${index}: Buildertrend job URL is not trusted` }
  }
  const sourceUrl = normalizedHrefs[0]
  if (!sourceUrl) {
    return { error: `rows.${index}: Buildertrend job URL is not trusted` }
  }

  const sourceKey = `job:${jobId}`
  const contacts = normalizedContacts(row.contacts ?? row.contactLinks)
  for (const [contactIndex, contact] of contacts.entries()) {
    const identityError = contactIdentityError(contact)
    if (identityError) {
      return {
        error: `rows.${index}.contacts.${contactIndex}: ${identityError}`,
      }
    }
  }
  const names = contacts.map(contactName).filter((name) => Boolean(name))
  const rowText =
    firstText(row.rowText) ||
    (row.cells ?? []).map(text).filter(Boolean).join(" | ")
  const projectAddress = [
    firstText(row.address, cellText(row.cells, 3)),
    firstText(row.city, cellText(row.cells, 4)),
    firstText(row.state, cellText(row.cells, 5)),
    firstText(row.zipCode, cellText(row.cells, 6)),
  ]
    .filter((part) => Boolean(part))
    .join(", ")
  const sourceStatus = firstText(
    row.buildertrendStatus,
    row.jobStatus,
    row.sourceContext,
    row.pageSummary
  )

  const record: InventoryRecord = {
    sourceKey,
    projectId: row.projectId,
    sourceScope: "job",
    sourceRecordType: "job",
    buildertrendJobId: jobId,
    buildertrendRecordId: jobId,
    buildertrendUrl: sourceUrl,
    title,
    recordStatus: firstText(row.buildertrendStatus, row.jobStatus),
    sourceStatus,
    departmentCode: departmentCode(title),
    clientName: names.join("; ") || undefined,
    contactEmail: firstText(row.clientEmail, cellText(row.cells, 10)),
    searchableText: [
      title,
      rowText,
      projectAddress,
      firstText(row.projectManager, cellText(row.cells, 7)),
      names.join(" "),
    ]
      .filter((part) => Boolean(part))
      .join(" | "),
    normalizedSummary: `Buildertrend job inventory record for ${title}.`,
    rawPayload: {
      ...row,
      extractedProjectNumber: projectNumber(title),
      projectAddress: projectAddress || null,
      scheduleStatus: firstText(
        row.scheduleStatus,
        cellText(row.cells, 15)
      ),
      clientPhone: firstText(row.clientPhone, cellText(row.cells, 9)),
    },
    notes:
      "Archive and reconciliation only. Project linkage must be explicit and reviewed.",
  }

  return {
    record,
    contacts: contacts
      .map((contact) =>
        accessCandidate("job", sourceKey, row.projectId, jobId, contact)
      )
      .filter((candidate) => candidate !== null),
  }
}

function normalizeLead(
  value: unknown,
  index: number
):
  | {
      readonly record: InventoryRecord
      readonly contacts: readonly AccessCandidate[]
    }
  | { readonly error: string } {
  const parsed = leadRowSchema.safeParse(value)
  if (!parsed.success) {
    return { error: `rows.${index}: ${parsed.error.issues[0]?.message}` }
  }
  const row = parsed.data
  const explicitLeadIds = uniqueValues([
    row.buildertrendLeadId,
    row.leadId,
  ])
  if (explicitLeadIds.length > 1) {
    return {
      error: `rows.${index}: Buildertrend lead ID aliases disagree`,
    }
  }
  const explicitLeadId = explicitLeadIds[0]
  const hrefLeadId = leadIdFromHref(row.href)
  if (explicitLeadId && !validBuildertrendId(explicitLeadId)) {
    return {
      error: `rows.${index}: Buildertrend lead ID must contain only digits`,
    }
  }
  if (explicitLeadId && hrefLeadId && explicitLeadId !== hrefLeadId) {
    return {
      error: `rows.${index}: Buildertrend lead ID does not match its lead link`,
    }
  }
  const leadId = explicitLeadId || hrefLeadId
  const title = firstText(row.title, row.name)
  if (!leadId || !title) {
    return {
      error: `rows.${index}: lead opportunity rows require a Buildertrend lead ID and title`,
    }
  }
  const sourceUrl = trustedBuildertrendEntityUrl(
    row.href,
    `/app/leads/opportunities/Lead/${leadId}`,
    "lead",
    leadId
  )
  if (!sourceUrl) {
    return { error: `rows.${index}: Buildertrend lead URL is not trusted` }
  }

  const sourceKey = `lead:${leadId}`
  const contacts = normalizedContacts(row.contacts)
  for (const [contactIndex, contact] of contacts.entries()) {
    const identityError = contactIdentityError(contact)
    if (identityError) {
      return {
        error: `rows.${index}.contacts.${contactIndex}: ${identityError}`,
      }
    }
  }
  const names = contacts.map(contactName).filter((name) => Boolean(name))
  const record: InventoryRecord = {
    sourceKey,
    projectId: row.projectId,
    sourceScope: "lead",
    sourceRecordType: "lead_opportunity",
    buildertrendLeadId: leadId,
    buildertrendRecordId: leadId,
    buildertrendUrl: sourceUrl,
    title,
    recordStatus: firstText(row.status),
    sourceStatus: firstText(row.sourceStatus),
    departmentCode: departmentCode(title),
    clientName: firstText(row.clientName) || names.join("; ") || undefined,
    contactName: names.join("; ") || undefined,
    searchableText: [title, row.rowText, names.join(" ")]
      .filter((part) => Boolean(part))
      .join(" | "),
    normalizedSummary: `Buildertrend lead opportunity for ${title}.`,
    rawPayload: {
      ...row,
      extractedProjectNumber: projectNumber(title),
    },
    notes:
      "Preconstruction archive only. Do not create a project, customer, or invitation from this record.",
  }

  return {
    record,
    contacts: contacts
      .map((contact) =>
        accessCandidate("lead", sourceKey, row.projectId, leadId, contact)
      )
      .filter((candidate) => candidate !== null),
  }
}

function defaultSourceMethod(kind: BuildertrendInventoryKind): string {
  if (kind === "jobs") return "buildertrend_job_inventory_snapshot"
  return "buildertrend_lead_opportunity_snapshot"
}

export function buildBuildertrendInventoryManifest(
  snapshot: unknown,
  options: BuildertrendInventoryManifestOptions
): BuildertrendInventoryManifestBuild {
  const parsedSnapshot = snapshotSchema.safeParse(snapshot)
  if (!parsedSnapshot.success) {
    return {
      success: false,
      errors: parsedSnapshot.error.issues.map(
        (issue) =>
          `${issue.path.length > 0 ? issue.path.join(".") : "snapshot"}: ${issue.message}`
      ),
    }
  }
  if (
    parsedSnapshot.data.success === false ||
    (parsedSnapshot.data.error !== undefined &&
      parsedSnapshot.data.error !== null &&
      parsedSnapshot.data.error !== false &&
      parsedSnapshot.data.error !== "")
  ) {
    return {
      success: false,
      errors: ["snapshot: capture reported an error or unsuccessful status"],
    }
  }
  if (
    options.expectedRowCount !== undefined &&
    (!Number.isInteger(options.expectedRowCount) ||
      options.expectedRowCount < 0)
  ) {
    return {
      success: false,
      errors: ["expectedRowCount: expected a nonnegative integer"],
    }
  }
  if (
    options.expectedRowCount !== undefined &&
    parsedSnapshot.data.rows.length !== options.expectedRowCount
  ) {
    return {
      success: false,
      errors: [
        `snapshot.rows: expected ${options.expectedRowCount} rows but captured ${parsedSnapshot.data.rows.length}`,
      ],
    }
  }
  if (parsedSnapshot.data.rows.length === 0 && !options.allowEmpty) {
    return {
      success: false,
      errors: [
        "snapshot.rows: empty captures require an explicit allowEmpty decision",
      ],
    }
  }

  const records: InventoryRecord[] = []
  const accessCandidates: AccessCandidate[] = []
  const errors: string[] = []

  for (const [index, row] of parsedSnapshot.data.rows.entries()) {
    const normalized =
      options.kind === "jobs"
        ? normalizeJob(row, index)
        : normalizeLead(row, index)

    if ("error" in normalized) {
      errors.push(normalized.error)
      continue
    }
    records.push(normalized.record)
    if ("contacts" in normalized) {
      accessCandidates.push(...normalized.contacts)
    }
  }

  if (errors.length > 0) return { success: false, errors }

  records.sort((left, right) =>
    stableTextCompare(left.sourceKey, right.sourceKey)
  )
  accessCandidates.sort((left, right) =>
    stableTextCompare(left.sourceKey, right.sourceKey)
  )

  const candidate: unknown = {
    runKey: options.runKey,
    sourceMethod: options.sourceMethod || defaultSourceMethod(options.kind),
    sourceLabel: options.sourceLabel,
    capturedAt: options.capturedAt,
    rawArtifactDriveFileId: options.rawArtifactDriveFileId,
    rawArtifactDriveUrl: options.rawArtifactDriveUrl,
    notes:
      options.notes ||
      "Generated from a captured Buildertrend inventory. Archive and review only.",
    records,
    files: [],
    accessCandidates,
  }
  const parsedManifest = parseBuildertrendStagingManifest(candidate)
  if (!parsedManifest.success) {
    return { success: false, errors: parsedManifest.errors }
  }

  return {
    success: true,
    manifest: parsedManifest.data,
    summary: {
      kind: options.kind,
      recordCount: records.length,
      accessCandidateCount: accessCandidates.length,
      missingProjectIdCount: records.filter((record) => !record.projectId)
        .length,
    },
  }
}
