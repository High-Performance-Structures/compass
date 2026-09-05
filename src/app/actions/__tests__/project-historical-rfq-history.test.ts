import { createRequire } from "node:module"
import { drizzle } from "drizzle-orm/d1"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { projectOperations, projects } from "@/db/schema"
import { buildertrendArchiveFiles, buildertrendImportObservations, buildertrendSourceRecords } from "@/db/schema-buildertrend"

const mocks = vi.hoisted(() => ({
  assertProjectAccess: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  isDemoUser: vi.fn(),
  isInternalStaffRole: vi.fn(),
  requireAuth: vi.fn(),
  requireFeaturePermission: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/demo", () => ({ isDemoUser: mocks.isDemoUser }))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))
vi.mock("@/lib/permission-enforcement", () => ({ requireFeaturePermission: mocks.requireFeaturePermission }))
vi.mock("@/lib/user-roles", () => ({ isInternalStaffRole: mocks.isInternalStaffRole }))

import { getProjectHistoricalRfqWorkspace } from "@/app/actions/project-historical-rfq-history"

type SqliteStatement = Readonly<{
  readonly run: (...values: readonly unknown[]) => { readonly changes: number }
  readonly all: (...values: readonly unknown[]) => readonly unknown[]
  readonly get: (...values: readonly unknown[]) => unknown
  readonly values?: (...values: readonly unknown[]) => readonly unknown[][]
  readonly raw?: () => SqliteStatement
}>

type Sqlite = Readonly<{
  readonly exec: (sql: string) => void
  readonly close: () => void
  readonly prepare?: (sql: string) => SqliteStatement
  readonly query?: (sql: string) => SqliteStatement
}>

type SqliteConstructor = new (file: string) => Sqlite

function isSqliteConstructor(value: unknown): value is SqliteConstructor {
  return typeof value === "function"
}

const nodeRequire = createRequire(import.meta.url)

function newSqlite(path: string): Sqlite {
  try {
    const imported: unknown = nodeRequire("better-sqlite3")
    if (isSqliteConstructor(imported)) return new imported(path)
    const defaultImport = imported !== null && typeof imported === "object" ? Reflect.get(imported, "default") : undefined
    if (isSqliteConstructor(defaultImport)) return new defaultImport(path)
  } catch { /* Bun can use its built-in SQLite when the native addon is unavailable. */ }
  const imported: unknown = nodeRequire("bun:sqlite")
  const database = imported !== null && typeof imported === "object" ? Reflect.get(imported, "Database") : undefined
  if (isSqliteConstructor(database)) return new database(path)
  throw new Error("No SQLite test adapter available")
}

function statement(sqlite: Sqlite, sql: string): SqliteStatement {
  if (sqlite.prepare) return sqlite.prepare(sql)
  if (sqlite.query) return sqlite.query(sql)
  throw new Error("SQLite adapter has no statement method")
}

type D1Statement = Readonly<{
  readonly __query: string
  readonly bind: (...values: readonly unknown[]) => D1Statement
  readonly all: () => Promise<Readonly<{ readonly success: true; readonly results: readonly unknown[] }>>
  readonly raw: () => Promise<readonly unknown[][]>
}>

function createD1(sqlite: Sqlite) {
  function prepared(query: string, values: readonly unknown[] = []): D1Statement {
    const sql = statement(sqlite, query)
    return {
      __query: query,
      bind: (...nextValues) => prepared(query, nextValues),
      async all() {
        return { success: true, results: sql.all(...values) }
      },
      async raw() {
        if (sql.values) return sql.values(...values)
        if (sql.raw) return sql.raw().all(...values).map((row) => Array.isArray(row) ? row : [row])
        return sql.all(...values).map((row) => row !== null && typeof row === "object" ? Object.values(row) : [row])
      },
    }
  }
  return {
    prepare(query: string): D1Statement { return prepared(query) },
    async batch(statements: readonly D1Statement[]) {
      return Promise.all(statements.map(async item => item.all()))
    },
  }
}

type TestUser = Readonly<{
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly role: string
  readonly organizationId: string | null
  readonly organizationType: string
  readonly isActive: boolean
}>

type TestState = Readonly<{
  readonly sqlite: Sqlite
  readonly d1: unknown
  readonly db: ReturnType<typeof drizzle>
  readonly projectId: string
  readonly organizationId: string
  readonly jobId: string
  readonly rootId: string
}>

const projectId = "project-history"
const otherProjectId = "project-other"
const organizationId = "org-history"
const jobId = "12345"
const rootId = "drive-root-history"
const actor: TestUser = {
  id: "staff-history",
  email: "staff@example.test",
  displayName: "History Reviewer",
  role: "admin",
  organizationId,
  organizationType: "internal",
  isActive: true,
}

function sourceKey(requestId: string, sourceJobId = jobId): string {
  return `job:${sourceJobId}:rfq_response:${requestId}`
}

function sourceRecordId(requestId: string, sourceJobId = jobId, sourceOrganizationId = organizationId): string {
  return `buildertrend:source:${sourceOrganizationId}:${sourceKey(requestId, sourceJobId)}`
}

function fileSourceKey(requestId: string, documentInstanceId: string, sourceJobId = jobId): string {
  return `${sourceKey(requestId, sourceJobId)}:attachment:${documentInstanceId}`
}

function fileRecordId(requestId: string, documentInstanceId: string, sourceJobId = jobId): string {
  return `buildertrend:file:${organizationId}:${fileSourceKey(requestId, documentInstanceId, sourceJobId)}`
}

type SourceFormat = "modern" | "legacy" | "preserved"
type ObservationFormat = "raw" | "wrapper" | "frozen-envelope"
type ObservationKeyFormat = "source" | "raw"
type WrapperDrift = "identity" | "raw" | "key"
type FrozenEnvelopeDrift = "row-id" | "organization" | "raw" | "project" | "marker" | "evidence"

const frozenObservationSemantics = "Frozen canonical migration observation assembled now; historical dates remain separate source fields."

function frozenObservation(
  row: Readonly<Record<string, unknown>>,
  drift: FrozenEnvelopeDrift | undefined,
): string {
  const driftedRow = drift === "row-id" ? { ...row, id: "drifted-source-row" } :
    drift === "organization" ? { ...row, organization_id: "drifted-organization" } :
      drift === "raw" ? { ...row, raw_payload_json: JSON.stringify({ drifted: true }) } :
        drift === "project" ? { ...row, project_id: "drifted-project" } : row
  return JSON.stringify({
    row: driftedRow,
    evidence: drift === "evidence" ? [] : [{ path: "synthetic-frozen-evidence.json", sha256: "a".repeat(64), claim: "synthetic test evidence" }],
    observationSemantics: drift === "marker" ? "Wrong migration observation marker." : frozenObservationSemantics,
  })
}

function sourcePayload(
  requestId: string,
  status: "Draft" | "Submitted" | "Unsupported",
  incomplete = false,
  packageId = "70001",
  includeAttachment = true,
  format: SourceFormat = "modern",
  sourceJobId = jobId,
): string {
  if (status === "Unsupported") return JSON.stringify({ unsupported: true, requestId })
  const href = sourceUrl(packageId, requestId, sourceJobId)
  if (format === "legacy") {
    return JSON.stringify({
      provenance: "synthetic legacy source capture",
      sourceArtifact: "synthetic-legacy.json",
      projectNumber: "HIST-1",
      projectId,
      buildertrendJobId: sourceJobId,
      bidPackageId: packageId,
      bidId: requestId,
      vendor: `Synthetic vendor ${requestId}`,
      status,
      submittedAt: status === "Submitted" ? "2026-09-05" : null,
      bidAmount: status === "Submitted" ? 1250 : 0,
      sourceHref: href,
      responseEvidence: {
        bidId: requestId,
        vendor: `Synthetic vendor ${requestId}`,
        submittedBy: "Synthetic submitter",
        notes: "Synthetic legacy note.",
        lineItems: status === "Submitted" ? [{ description: "Synthetic scope", unitCost: "1250.00", quantity: "1.0000", builderCost: "1250.00" }] : [],
        total: status === "Submitted" ? "1250.00" : "0.00",
        attachments: [],
        attachmentDocumentInstanceIds: {},
        detailSourceHref: href,
      },
      attachmentEvidence: [],
    })
  }
  if (format === "preserved") {
    const priced = status === "Submitted"
    return JSON.stringify({
      schema: "buildertrend-rfq-request-preserved-v1",
      projectId,
      buildertrendJobId: sourceJobId,
      bidPackageId: packageId,
      bidId: requestId,
      vendor: `Synthetic vendor ${requestId}`,
      status,
      sourceHref: href,
      sourceArtifact: "synthetic-preserved.json",
      sourceArtifactSha256: "a".repeat(64),
      parentRfqRecordId: `bt-module-rfq-${sourceJobId}-${packageId}`,
      parentRfqSourceKey: `rfq:${sourceJobId}:${packageId}`,
      recordDateSemantics: "Synthetic display dates only.",
      requestEvidence: {
        sourceBidRequestId: requestId,
        sourceHref: href,
        vendorDisplay: `Synthetic vendor ${requestId}`,
        status,
        amountDisplay: priced ? "$1,250.00" : "$0.00",
        totalDisplay: priced ? "$1,250.00" : "$0.00",
        pricedSubmission: priced,
        lines: priced ? [{ title: "Synthetic scope", builderCostDisplay: "$1,250.00" }] : [],
        attachments: [],
      },
      sourceFieldsArePreserved: true,
      sourcePackageEvidence: { title: "Synthetic package" },
      attachmentEvidence: [],
      importedAs: "Historical staging evidence only.",
      recipientAccessVerified: false,
    })
  }
  const submitted = status === "Submitted"
  return JSON.stringify({
    id: `bt-rfq-response-${requestId}`,
    sourceKey: sourceKey(requestId, sourceJobId),
    project: { projectId, buildertrendJobId: sourceJobId, bidPackageId: packageId },
    source: { sourceBidRequestId: requestId, sourceHref: href },
    vendor: { displayName: `Synthetic vendor ${requestId}` },
    status: {
      sourceStatus: status, submitted, pricedSubmission: submitted,
      releaseDateDisplay: "Synthetic release", submittedDisplay: submitted ? "Synthetic submission" : null,
    },
    financial: {
      amountDisplay: submitted ? "$1,234.00" : null,
      totalDisplay: submitted ? "$1,234.00" : null,
      derivedMoney: false,
      lines: [{ title: "Synthetic scope", builderCostDisplay: incomplete ? null : "$1,234.00" }],
    },
    attachments: includeAttachment ? [{ sourceDocumentInstanceId: "80001", sourceFileId: "80001", fileName: "held-source.pdf" }] : [],
  })
}

function sourceUrl(packageId: string, requestId: string, sourceJobId = jobId): string {
  return `https://buildertrend.net/app/BidPackages/BidPackage/${packageId}/${sourceJobId}/Bid/${requestId}/${sourceJobId}/0/0`
}

function createSchema(sqlite: Sqlite): void {
  sqlite.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, organization_id TEXT, buildertrend_project_id TEXT, google_drive_folder_id TEXT);
    CREATE TABLE project_operations (id TEXT PRIMARY KEY, project_id TEXT, source_system TEXT, source_record_type TEXT, source_record_id TEXT);
    CREATE TABLE buildertrend_staging_records (
      id TEXT PRIMARY KEY, organization_id TEXT, project_id TEXT, requested_project_id TEXT,
      source_key TEXT, source_scope TEXT, source_record_type TEXT, buildertrend_job_id TEXT,
      buildertrend_record_id TEXT, buildertrend_record_number TEXT, buildertrend_url TEXT,
      raw_payload_json TEXT, updated_at TEXT
    );
    CREATE TABLE buildertrend_staging_observations (
      id TEXT PRIMARY KEY, import_run_id TEXT, organization_id TEXT, entity_kind TEXT,
      entity_key TEXT, entity_id TEXT, observed_payload_json TEXT, observed_at TEXT
    );
    CREATE TABLE buildertrend_staging_files (
      id TEXT PRIMARY KEY, organization_id TEXT, source_key TEXT, requested_source_record_key TEXT,
      source_record_id TEXT, requested_project_id TEXT, project_id TEXT, source_scope TEXT,
      source_record_type TEXT, buildertrend_job_id TEXT, buildertrend_lead_id TEXT,
      buildertrend_file_id TEXT, buildertrend_url TEXT, file_name TEXT, mime_type TEXT,
      file_size INTEGER, source_drive_folder_id TEXT, source_drive_file_id TEXT, source_drive_url TEXT,
      source_thumbnail_drive_file_id TEXT, source_thumbnail_url TEXT, verified_drive_folder_id TEXT,
      verified_drive_file_id TEXT, verified_drive_url TEXT, verified_thumbnail_drive_file_id TEXT,
      verified_thumbnail_url TEXT, source_checksum TEXT, verified_checksum TEXT, captured_at TEXT,
      visibility TEXT, review_status TEXT, source_metadata_json TEXT, review_metadata_json TEXT,
      created_at TEXT, updated_at TEXT
    );
  `)
}

function createState(): TestState {
  const sqlite = newSqlite(":memory:")
  createSchema(sqlite)
  statement(sqlite, "INSERT INTO projects VALUES (?, ?, ?, ?)").run(projectId, organizationId, jobId, rootId)
  statement(sqlite, "INSERT INTO projects VALUES (?, ?, ?, ?)").run(otherProjectId, organizationId, "54321", "other-root")
  const d1 = createD1(sqlite)
  // @ts-expect-error This focused adapter implements only the D1 methods exercised here.
  const db = drizzle(d1, { schema: { projects, projectOperations, buildertrendArchiveFiles, buildertrendSourceRecords, buildertrendImportObservations } })
  return { sqlite, d1, db, projectId, organizationId, jobId, rootId }
}

function addSource(state: TestState, input: Readonly<{
  readonly requestId: string
  readonly packageId?: string
  readonly status?: "Draft" | "Submitted" | "Unsupported"
  readonly incomplete?: boolean
  readonly project?: string
  readonly requestedProject?: string | null
  readonly organization?: string
  readonly sourceJobId?: string
  readonly observedPayload?: string | null
  readonly observationCount?: number
  readonly includeAttachment?: boolean
  readonly format?: SourceFormat
  readonly observationFormat?: ObservationFormat
  readonly observationKeyFormat?: ObservationKeyFormat
  readonly wrapperDrift?: WrapperDrift
  readonly frozenEnvelopeDrift?: FrozenEnvelopeDrift
}>): void {
  const packageId = input.packageId ?? `7${input.requestId.padStart(4, "0")}`
  const status = input.status ?? "Submitted"
  const sourceJobId = input.sourceJobId ?? state.jobId
  const payload = sourcePayload(input.requestId, status, input.incomplete ?? false, packageId, input.includeAttachment ?? true, input.format ?? "modern", sourceJobId)
  const sourceProject = input.project ?? state.projectId
  const requestedProject = input.requestedProject === undefined ? state.projectId : input.requestedProject
  const sourceOrganization = input.organization ?? state.organizationId
  const sourceObservationKey = sourceKey(input.requestId, sourceJobId)
  statement(state.sqlite, "INSERT INTO buildertrend_staging_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    sourceRecordId(input.requestId, sourceJobId, sourceOrganization), sourceOrganization, sourceProject, requestedProject,
    sourceObservationKey, "job", "rfq_response",
    sourceJobId, input.requestId, input.requestId, sourceUrl(packageId, input.requestId, sourceJobId), payload,
    `2026-09-05T00:00:${input.requestId.slice(-2).padStart(2, "0")}Z`,
  )
  if (input.observedPayload === null) return
  const observationFormat = input.observationFormat ?? "raw"
  const frozenRow: Readonly<Record<string, unknown>> = {
    id: sourceRecordId(input.requestId, sourceJobId, sourceOrganization),
    organization_id: sourceOrganization,
    project_id: sourceProject,
    requested_project_id: requestedProject,
    source_key: sourceObservationKey,
    source_scope: "job",
    source_record_type: "rfq_response",
    buildertrend_job_id: sourceJobId,
    buildertrend_record_id: input.requestId,
    buildertrend_record_number: input.requestId,
    buildertrend_url: sourceUrl(packageId, input.requestId, sourceJobId),
    title: `Synthetic RFQ response ${input.requestId}`,
    record_date: null,
    record_status: status.toLowerCase(),
    source_status: status,
    department_code: null,
    client_name: null,
    contact_name: `Synthetic vendor ${input.requestId}`,
    contact_email: null,
    amount: status === "Submitted" ? 1234 : null,
    searchable_text: `Synthetic vendor ${input.requestId} ${input.requestId}`,
    normalized_summary: `Synthetic ${status} RFQ response.`,
    raw_payload_json: payload,
    archive_drive_folder_id: null,
    archive_drive_file_id: null,
    archive_drive_url: null,
    notes: null,
  }
  const observedPayload = input.observedPayload ?? (observationFormat === "wrapper"
    ? JSON.stringify({
      sourceKey: sourceObservationKey,
      projectId: sourceProject,
      sourceScope: "job",
      sourceRecordType: "rfq_response",
      buildertrendJobId: sourceJobId,
      buildertrendRecordId: input.requestId,
      buildertrendRecordNumber: input.requestId,
      buildertrendUrl: sourceUrl(packageId, input.requestId, sourceJobId),
      title: `Synthetic RFQ response ${input.requestId}`,
      rawPayload: JSON.parse(payload),
    })
    : observationFormat === "frozen-envelope"
      ? frozenObservation(frozenRow, input.frozenEnvelopeDrift)
      : payload)
  const observationJson = input.wrapperDrift === undefined || observationFormat !== "wrapper"
    ? observedPayload
    : JSON.stringify({
      sourceKey: input.wrapperDrift === "key" ? `record:${sourceObservationKey}:response` : sourceObservationKey,
      projectId: sourceProject,
      sourceScope: "job",
      sourceRecordType: "rfq_response",
      buildertrendJobId: sourceJobId,
      buildertrendRecordId: input.wrapperDrift === "identity" ? `drift-${input.requestId}` : input.requestId,
      buildertrendRecordNumber: input.requestId,
      buildertrendUrl: sourceUrl(packageId, input.requestId, sourceJobId),
      title: `Synthetic RFQ response ${input.requestId}`,
      rawPayload: input.wrapperDrift === "raw" ? { drifted: true } : JSON.parse(payload),
    })
  const observationEntityKey = input.observationKeyFormat === "raw"
    ? `record:${sourceObservationKey}:response`
    : sourceObservationKey
  for (let index = 0; index < (input.observationCount ?? 1); index += 1) {
    statement(state.sqlite, "INSERT INTO buildertrend_staging_observations VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      `observation-${input.requestId}-${index}`, "run-history", sourceOrganization, "record", observationEntityKey, sourceRecordId(input.requestId, sourceJobId, sourceOrganization),
      observationJson, `2026-09-05T00:00:${String(index).padStart(2, "0")}Z`,
    )
  }
}

function addVerifiedFile(
  state: TestState,
  requestId: string,
  packageId = `7${requestId.padStart(4, "0")}`,
  validAncestry = true,
  parentSourceRecordIdOverride?: string,
): void {
  const documentInstanceId = "80001"
  const label = "held-source.pdf"
  const driveFileId = `drive-file-${requestId}`
  const sourceChecksum = "a".repeat(64)
  const receiptChecksum = "b".repeat(64)
  const parentSourceRecordId = parentSourceRecordIdOverride ?? sourceRecordId(requestId, state.jobId)
  const requestKey = sourceKey(requestId, state.jobId)
  const sourceMetadata = JSON.stringify({
    schema: "buildertrend-rfq-response-attachment-v1",
    sourceDocumentInstanceId: documentInstanceId,
    documentInstanceId,
    bidId: requestId,
    bidPackageId: packageId,
    sourceJobId: state.jobId,
    sourceParentId: parentSourceRecordId,
    sourceParentKey: requestKey,
    canonicalProofArtifact: "sealed-receipt.json",
    canonicalProofSha256: receiptChecksum,
  })
  const reviewMetadata = JSON.stringify({
    binding: "staging-only",
    recipientAccessVerified: false,
    canonicalProof: {
      driveId: driveFileId,
      driveUrl: `https://drive.google.com/file/d/${driveFileId}/view`,
      driveDirectParentId: "drive-root-files",
      canonicalRootId: state.rootId,
      ancestry: validAncestry
        ? [
            { id: driveFileId, parents: ["drive-root-files"] },
            { id: "drive-root-files", parents: [state.rootId] },
            { id: state.rootId, parents: [] },
          ]
        : [
            { id: driveFileId, parents: ["wrong-parent"] },
            { id: "drive-root-files", parents: [state.rootId] },
            { id: state.rootId, parents: [] },
          ],
      sha256: sourceChecksum,
      bytes: 12,
      readbackReceiptSha256: receiptChecksum,
      sourceDocumentInstanceId: documentInstanceId,
      fileName: label,
      originalBytesEqual: true,
      recipientAccessVerified: false,
      pages: 1,
      allPagesViewable: true,
    },
  })
  statement(state.sqlite, `INSERT INTO buildertrend_staging_files (
    id, organization_id, source_key, requested_source_record_key, source_record_id, requested_project_id,
    project_id, source_scope, source_record_type, buildertrend_job_id, buildertrend_file_id, file_name,
    mime_type, file_size, verified_drive_folder_id, verified_drive_file_id, verified_drive_url,
    source_checksum, verified_checksum, visibility, review_status, source_metadata_json, review_metadata_json,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    fileRecordId(requestId, documentInstanceId, state.jobId), state.organizationId,
    fileSourceKey(requestId, documentInstanceId, state.jobId), requestKey, parentSourceRecordId, state.projectId,
    state.projectId, "job", "rfq_response_attachment", state.jobId, documentInstanceId, label,
    "application/pdf", 12, "drive-root-files", driveFileId, `https://drive.google.com/file/d/${driveFileId}/view`,
    sourceChecksum, sourceChecksum, "internal", "verified", sourceMetadata, reviewMetadata,
    "2026-09-05T00:00:00Z", "2026-09-05T00:00:00Z",
  )
}

function addOperation(state: TestState, packageId: string, count = 1): void {
  for (let index = 0; index < count; index += 1) {
    statement(state.sqlite, "INSERT INTO project_operations VALUES (?, ?, ?, ?, ?)").run(
      `operation-${packageId}-${index}`, state.projectId, "buildertrend", "rfq", packageId,
    )
  }
}

function configure(state: TestState, user: TestUser = actor): void {
  mocks.requireAuth.mockResolvedValue(user)
  mocks.isDemoUser.mockReturnValue(false)
  mocks.isInternalStaffRole.mockImplementation((role: unknown) => role !== "client")
  mocks.requireFeaturePermission.mockResolvedValue(undefined)
  mocks.assertProjectAccess.mockResolvedValue({ id: state.projectId, organizationId: state.organizationId, projectNumber: "HIST-1" })
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: state.d1 } })
  mocks.getDb.mockReturnValue(state.db)
}

describe("historical RFQ history action", () => {
  let state: TestState

  beforeEach(() => {
    state = createState()
    configure(state)
  })

  afterEach(() => {
    state.sqlite.close()
    vi.clearAllMocks()
  })

  it("reconstructs modern, legacy, and preserved rows from importer IDs", async () => {
    addSource(state, { requestId: "9701", includeAttachment: false, format: "modern", observationFormat: "wrapper" })
    addSource(state, { requestId: "9702", includeAttachment: false, format: "legacy", observationFormat: "wrapper" })
    addSource(state, { requestId: "9703", includeAttachment: false, format: "preserved", observationFormat: "wrapper" })
    addSource(state, { requestId: "9704", includeAttachment: false, format: "modern", observationFormat: "wrapper", wrapperDrift: "identity" })
    addSource(state, { requestId: "9705", includeAttachment: false, format: "legacy", observationFormat: "wrapper", wrapperDrift: "raw" })
    addSource(state, { requestId: "9706", includeAttachment: false, format: "preserved", observationFormat: "wrapper", wrapperDrift: "key" })
    addSource(state, { requestId: "9707", includeAttachment: false, format: "modern", observationKeyFormat: "raw" })
    addSource(state, { requestId: "9711", includeAttachment: false, format: "modern", observationFormat: "frozen-envelope" })
    addSource(state, { requestId: "9712", includeAttachment: false, format: "legacy", observationFormat: "frozen-envelope" })
    addSource(state, { requestId: "9713", includeAttachment: false, format: "preserved", observationFormat: "frozen-envelope" })
    addSource(state, { requestId: "9714", includeAttachment: false, format: "modern", observationFormat: "frozen-envelope", frozenEnvelopeDrift: "row-id" })
    addSource(state, { requestId: "9715", includeAttachment: false, format: "legacy", observationFormat: "frozen-envelope", frozenEnvelopeDrift: "organization" })
    addSource(state, { requestId: "9716", includeAttachment: false, format: "preserved", observationFormat: "frozen-envelope", frozenEnvelopeDrift: "raw" })
    addSource(state, { requestId: "9717", includeAttachment: false, format: "modern", observationFormat: "frozen-envelope", frozenEnvelopeDrift: "project" })
    addSource(state, { requestId: "9718", includeAttachment: false, format: "legacy", observationFormat: "frozen-envelope", frozenEnvelopeDrift: "marker" })
    addSource(state, { requestId: "9719", includeAttachment: false, format: "preserved", observationFormat: "frozen-envelope", frozenEnvelopeDrift: "evidence" })
    const result = await getProjectHistoricalRfqWorkspace(projectId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.totalRecords).toBe(16)
    expect(result.items).toHaveLength(16)
    expect(result.items.map(item => item.sourceRecordId)).toEqual([
      sourceRecordId("9701"), sourceRecordId("9702"), sourceRecordId("9703"), sourceRecordId("9704"),
      sourceRecordId("9705"), sourceRecordId("9706"), sourceRecordId("9707"), sourceRecordId("9711"),
      sourceRecordId("9712"), sourceRecordId("9713"), sourceRecordId("9714"), sourceRecordId("9715"),
      sourceRecordId("9716"), sourceRecordId("9717"), sourceRecordId("9718"), sourceRecordId("9719"),
    ])
    expect(result.items.slice(0, 3).every(item => item.kind === "request")).toBe(true)
    expect(result.items.slice(3, 6).every(item => item.kind === "held")).toBe(true)
    expect(result.items[6]).toMatchObject({ kind: "request", requestId: "9707" })
    expect(result.items.slice(7, 10).every(item => item.kind === "request")).toBe(true)
    expect(result.items.slice(10).every(item => item.kind === "held")).toBe(true)
    const legacy = result.items.find(item => item.sourceRecordId === sourceRecordId("9702"))
    const preserved = result.items.find(item => item.sourceRecordId === sourceRecordId("9703"))
    expect(legacy).toMatchObject({ kind: "request", requestId: "9702", submission: "submitted" })
    expect(preserved).toMatchObject({ kind: "request", requestId: "9703", submission: "submitted" })
  })

  it("denies inactive/demo/external/role/auth/org/feature/project access", async () => {
    const deniedUsers: readonly TestUser[] = [
      { ...actor, isActive: false },
      { ...actor, id: "demo-user-001" },
      { ...actor, organizationType: "external" },
      { ...actor, role: "client" },
      { ...actor, organizationId: null },
    ]
    for (const user of deniedUsers) {
      configure(state, user)
      if (user.id === "demo-user-001") mocks.isDemoUser.mockReturnValue(true)
      expect((await getProjectHistoricalRfqWorkspace(projectId)).success).toBe(false)
    }
    configure(state)
    mocks.requireAuth.mockRejectedValue(new Error("unauthenticated"))
    expect((await getProjectHistoricalRfqWorkspace(projectId)).success).toBe(false)
    configure(state)
    mocks.requireFeaturePermission.mockRejectedValue(new Error("denied"))
    expect((await getProjectHistoricalRfqWorkspace(projectId)).success).toBe(false)
    configure(state)
    mocks.assertProjectAccess.mockRejectedValue(new Error("denied"))
    expect((await getProjectHistoricalRfqWorkspace(projectId)).success).toBe(false)
  })

  it("fails closed for missing project/root and distinguishes no rows from load failure", async () => {
    expect((await getProjectHistoricalRfqWorkspace("missing-project")).success).toBe(false)
    statement(state.sqlite, "UPDATE projects SET google_drive_folder_id=NULL WHERE id=?").run(projectId)
    const missingRoot = await getProjectHistoricalRfqWorkspace(projectId)
    expect(missingRoot).toMatchObject({ success: true, totalRecords: 0, items: [] })
    state.sqlite.close()
    const failedState = createState()
    configure(failedState)
    failedState.sqlite.exec("DROP TABLE buildertrend_staging_records")
    expect(await getProjectHistoricalRfqWorkspace(projectId)).toEqual({ success: false, error: "Historical RFQ data could not be loaded. This is not an empty-history result." })
    failedState.sqlite.close()
  })

  it("retains draft, incomplete, unsupported, missing-observation, and wrong-payload rows as visible history", async () => {
    addSource(state, { requestId: "9101", status: "Draft" })
    addSource(state, { requestId: "9102", status: "Submitted", incomplete: true })
    addSource(state, { requestId: "9103", status: "Unsupported" })
    addSource(state, { requestId: "9104", observedPayload: null })
    addSource(state, { requestId: "9105", observedPayload: "wrong-payload" })
    const result = await getProjectHistoricalRfqWorkspace(projectId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.totalRecords).toBe(5)
    expect(result.items).toHaveLength(5)
    const byId = new Map(result.items.map(item => [item.sourceRecordId, item]))
    expect(byId.get(sourceRecordId("9101"))).toMatchObject({ kind: "request", submission: "draft", pricingReconciliation: "unpriced" })
    expect(byId.get(sourceRecordId("9102"))).toMatchObject({ kind: "request", submission: "submitted", pricingReconciliation: "incomplete" })
    expect(byId.get(sourceRecordId("9103"))).toMatchObject({ kind: "held", bidPackageId: "79103" })
    expect(byId.get(sourceRecordId("9104"))).toMatchObject({ kind: "held", bidPackageId: "79104" })
    expect(byId.get(sourceRecordId("9105"))).toMatchObject({ kind: "held", bidPackageId: "79105" })
  })

  it("holds project, job, and requested-parent identity mismatches", async () => {
    addSource(state, { requestId: "9201", sourceJobId: "99999" })
    addSource(state, { requestId: "9202", requestedProject: otherProjectId })
    addSource(state, { requestId: "9203" })
    expect(statement(state.sqlite, "UPDATE projects SET buildertrend_project_id=? WHERE id=?").run("88888", projectId).changes).toBe(1)
    const result = await getProjectHistoricalRfqWorkspace(projectId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.items).toHaveLength(3)
    expect(result.items.every(item => item.kind === "held")).toBe(true)
    expect(result.items.every(item => item.bidPackageId === null)).toBe(true)
  })

  it("scopes null-project candidates by requested project without falling back to job or tenant", async () => {
    addSource(state, { requestId: "9801", packageId: "79801" })
    addSource(state, { requestId: "9802", sourceJobId: "77777", packageId: "79802" })
    addSource(state, { requestId: "9803", requestedProject: otherProjectId })
    addSource(state, { requestId: "9804", requestedProject: null })
    addSource(state, { requestId: "9805", project: otherProjectId, requestedProject: state.projectId })
    const otherOrganizationId = "org-other-history"
    addSource(state, { requestId: "9806", organization: otherOrganizationId })
    const otherJobRecordId = sourceRecordId("9802", "77777")
    for (const recordId of [sourceRecordId("9801"), otherJobRecordId, sourceRecordId("9803"), sourceRecordId("9804")]) {
      expect(statement(state.sqlite, "UPDATE buildertrend_staging_records SET project_id=NULL WHERE id=?").run(recordId).changes).toBe(1)
    }
    const result = await getProjectHistoricalRfqWorkspace(projectId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.totalRecords).toBe(2)
    expect(result.items).toHaveLength(2)
    expect(result.nextCursor).toBeNull()
    expect(result.items.every(item => item.kind === "held")).toBe(true)
    expect(result.items.map(item => item.sourceRecordId)).toEqual([sourceRecordId("9801"), otherJobRecordId])
    expect(result.items.find(item => item.sourceRecordId === sourceRecordId("9801"))).toMatchObject({ kind: "held", bidPackageId: "79801" })
    expect(result.items.find(item => item.sourceRecordId === otherJobRecordId)).toMatchObject({ kind: "held", bidPackageId: null })
    expect(result.items.map(item => item.sourceRecordId)).not.toContain(sourceRecordId("9803"))
    expect(result.items.map(item => item.sourceRecordId)).not.toContain(sourceRecordId("9804"))
    expect(result.items.map(item => item.sourceRecordId)).not.toContain(sourceRecordId("9805"))
    expect(result.items.map(item => item.sourceRecordId)).not.toContain(sourceRecordId("9806", jobId, otherOrganizationId))
  })

  it("shows unlinked history with a hold, leaves unrelated projects out, and marks ambiguous parents", async () => {
    addSource(state, { requestId: "9301" })
    addSource(state, { requestId: "9302", project: otherProjectId })
    addOperation(state, "79999")
    addSource(state, { requestId: "9303", packageId: "79303" })
    addOperation(state, "79303", 2)
    const result = await getProjectHistoricalRfqWorkspace(projectId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.items).toHaveLength(2)
    const first = result.items.find(item => item.sourceRecordId === sourceRecordId("9301"))
    const ambiguous = result.items.find(item => item.sourceRecordId === sourceRecordId("9303"))
    expect(first).toMatchObject({ kind: "request", operationId: null })
    if (first?.kind === "request") expect(first.holds).toContain("Historical RFQ package is not yet linked to an operational Compass RFQ.")
    expect(ambiguous).toMatchObject({ kind: "request", operationId: null })
    if (ambiguous?.kind === "request") expect(ambiguous.holds).toContain("Multiple operational RFQ matches require reconciliation.")
  })

  it("deduplicates observations without duplicating response cards", async () => {
    addSource(state, { requestId: "9401", observationCount: 3 })
    const result = await getProjectHistoricalRfqWorkspace(projectId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.totalRecords).toBe(1)
    expect(result.items).toHaveLength(1)
  })

  it("does not require the staging-file table when a displayed request has no attachment", async () => {
    addSource(state, { requestId: "9600", includeAttachment: false })
    state.sqlite.exec("DROP TABLE buildertrend_staging_files")
    const result = await getProjectHistoricalRfqWorkspace(projectId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ kind: "request", attachments: [] })
  })

  it("holds a missing attachment candidate and verifies one canonical persisted proof", async () => {
    addSource(state, { requestId: "9601" })
    addSource(state, { requestId: "9602" })
    addVerifiedFile(state, "9602")
    addSource(state, { requestId: "9603" })
    addVerifiedFile(state, "9603", "79603", false)
    addSource(state, { requestId: "9604" })
    addVerifiedFile(state, "9604", undefined, true, sourceRecordId("9601"))
    const result = await getProjectHistoricalRfqWorkspace(projectId)
    expect(result.success).toBe(true)
    if (!result.success) return
    const missing = result.items.find(item => item.sourceRecordId === sourceRecordId("9601"))
    const verified = result.items.find(item => item.sourceRecordId === sourceRecordId("9602"))
    const badAncestry = result.items.find(item => item.sourceRecordId === sourceRecordId("9603"))
    const wrongParent = result.items.find(item => item.sourceRecordId === sourceRecordId("9604"))
    expect(missing).toMatchObject({ kind: "request", attachments: [{ status: "held", documentInstanceId: "80001", label: "held-source.pdf", reason: "source_identity_mismatch" }] })
    expect(verified).toMatchObject({ kind: "request", attachments: [{ status: "verified", documentInstanceId: "80001", label: "held-source.pdf", url: "https://drive.google.com/file/d/drive-file-9602/view" }] })
    expect(badAncestry).toMatchObject({ kind: "request", attachments: [{ status: "held", documentInstanceId: "80001", label: "held-source.pdf", reason: "canonical_file_proof_missing" }] })
    expect(wrongParent).toMatchObject({ kind: "request", attachments: [{ status: "held", documentInstanceId: "80001", label: "held-source.pdf", reason: "missing_candidate" }] })
  })

  it("returns all 51 records as 50 plus a cursor, including held rows, with no omission on page two", async () => {
    for (let index = 1; index <= 51; index += 1) {
      addSource(state, { requestId: String(9500 + index), status: index === 17 ? "Unsupported" : "Submitted" })
    }
    const first = await getProjectHistoricalRfqWorkspace(projectId)
    expect(first.success).toBe(true)
    if (!first.success) return
    expect(first.totalRecords).toBe(51)
    expect(first.items).toHaveLength(50)
    expect(first.nextCursor).toBe(sourceRecordId("9550"))
    expect(first.items.some(item => item.kind === "held")).toBe(true)
    if (!first.nextCursor) return
    const second = await getProjectHistoricalRfqWorkspace(projectId, first.nextCursor)
    expect(second).toMatchObject({ success: true, totalRecords: 51, hasPreviousPage: true, nextCursor: null })
    if (!second.success) return
    expect(second.items).toHaveLength(1)
    expect(new Set([...first.items, ...second.items].map(item => item.sourceRecordId)).size).toBe(51)
  })
})
