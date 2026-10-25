import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { PDFDocument } from "pdf-lib"
import { openCorrespondenceTestDatabase, context, type CorrespondenceTestDatabase } from "./helpers/correspondence-core"
import type { AuthUser } from "@/lib/auth"
import type { DriveFile, DrivePermission } from "@/lib/google/client/types"
import type { ArchiveDrive } from "@/lib/google/project-archive-drive"
import type { ArchivePublication } from "@/lib/project-archives"

const runtime = vi.hoisted(() => {
  const initial: { database: CorrespondenceTestDatabase | null; user: AuthUser | null; preview: boolean; viewerId: string | null; previewAudience: string; settings: { deliveryRootIds: string[]; excludedMasterRootIds: string[] }; drive: ArchiveDrive | null } = { database: null, user: null, preview: false, viewerId: null, previewAudience: "owner", settings: { deliveryRootIds: ["delivery-root-001"], excludedMasterRootIds: ["master-root-0001"] }, drive: null }
  return initial
})
vi.mock("@/lib/auth", () => ({ requireAuth: async () => { if (!runtime.user) throw new Error("Unauthorized"); return runtime.user }, getCurrentUser: async () => runtime.user }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: runtime.database?.d1 } }) }))
vi.mock("@/lib/project-route-id", () => ({ resolveProjectRouteId: async (id: string) => id, requireProjectRouteId: async (id: string) => id }))
vi.mock("@/lib/feature-settings/server", () => ({ readFeatureSettings: async () => runtime.settings }))
vi.mock("@/lib/google/project-document-drive", () => ({ getProjectDocumentDriveContext: async () => runtime.drive }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: vi.fn(async () => {}) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/project-audience-viewer", () => ({
  assertAudiencePreviewWriteAllowed: async () => { if (runtime.preview) throw new Error("Preview is read only") },
  resolveProjectAudienceViewer: async (projectId: string, audience: string) => ({ db: runtime.database?.db, projectId, organizationId: "org-a", audience, viewer: runtime.viewerId ? { id: runtime.viewerId } : null, isPreview: runtime.preview }),
}))
vi.mock("@/lib/project-audience-request-server", () => ({
  getProjectAudienceRequestScope: async () => runtime.preview ? { projectId: "project-a", audience: runtime.previewAudience, targetUserId: runtime.viewerId } : null,
  assertAudienceResourceProject: async (id: string) => { if (runtime.preview && id !== "project-a") throw new Error("Not found") },
}))

import { publishProjectArchive, setProjectArchiveVisibility, getAudienceArchives } from "@/app/actions/project-archives"
import { visibleArchiveRecords, archiveReaders, publishArchiveRecord } from "@/lib/project-archives"
import { readArchivePdf, verifyArchiveBoundary, MAX_ARCHIVE_BYTES } from "@/lib/google/project-archive-drive"
import { GET } from "@/app/api/projects/[id]/archive/[archiveId]/download/route"
import { archiveDeliverySettingsSchema } from "@/lib/feature-settings/registry"

let database: CorrespondenceTestDatabase
let pdfBytes: Uint8Array<ArrayBuffer>
let files: Map<string, DriveFile>
let permissions: Map<string, readonly DrivePermission[]>
let drive: ArchiveDrive
const fileId = "archive-file-0001"
const input: ArchivePublication = { title: "Daily logs 2025", kind: "daily_log", period: "2025", audience: "owner", driveFileId: fileId, sourceRecordIds: ["source-1", "source-2"], sourceAudienceEvidence: "Clients / All dates; both source IDs; discussions excluded", recipientUserIds: ["owner-a"], audienceConfirmed: true }
const defaultPermissions: readonly DrivePermission[] = [{ id: "owner-permission", type: "user", role: "owner", emailAddress: "staff@example.test" }]
function actor(id: "staff-a" | "owner-a" | "staff-b" | "owner-b"): void { runtime.user = context(database, id, id.endsWith("b") ? "project-other" : "project-a").user }
async function publish(publication: ArchivePublication = input): Promise<string> {
  const pdf = await readArchivePdf(drive, fileId, runtime.settings)
  return publishArchiveRecord({ db: database.db, projectId: "project-a", organizationId: "org-a", actorId: "staff-a", publication, fingerprint: { fileName: pdf.fileName, sha256: pdf.sha256, byteSize: pdf.byteSize, pageCount: pdf.pageCount } })
}
function visible(viewerId: string | null, audience: "owner" | "sub_vendor" = "owner", projectId = "project-a", organizationId = "org-a") {
  return visibleArchiveRecords(database.db, { projectId, organizationId, audience, viewerId })
}
function download(id: string, projectId = "project-a"): Promise<Response> { return GET(new Request("https://example.test/archive"), { params: Promise.resolve({ id: projectId, archiveId: id }) }) }

beforeEach(async () => {
  database = openCorrespondenceTestDatabase()
  database.sqlite.exec(readFileSync("drizzle/0258_project_archive_delivery.sql", "utf8"))
  for (const [id, role, projectRole] of [["owner-c", "client", "owner"], ["vendor-x", "subcontractor", "subcontractor"], ["vendor-y", "subcontractor", "subcontractor"]]) {
    database.sqlite.prepare("INSERT INTO users(id,email,display_name,role,is_active,created_at,updated_at) VALUES(?,?,?, ?,1,'now','now')").run(id, `${id}@example.test`, "Same company label", role)
    database.sqlite.prepare("INSERT INTO organization_members(id,organization_id,user_id,role,joined_at) VALUES(?,'org-a',?,?,'now')").run(`om-${id}`, id, role)
    database.sqlite.prepare("INSERT INTO project_members(id,project_id,user_id,role,assigned_at) VALUES(?,'project-a',?,?,'now')").run(`pm-${id}`, id, projectRole)
  }
  const pdf = await PDFDocument.create(); pdf.addPage(); pdfBytes = new Uint8Array(await pdf.save())
  files = new Map<string, DriveFile>([[fileId, { id: fileId, name: "reviewed.pdf", mimeType: "application/pdf", size: String(pdfBytes.length), parents: ["delivery-root-001"] }], ["delivery-root-001", { id: "delivery-root-001", name: "Private deliveries", mimeType: "application/vnd.google-apps.folder", parents: ["actual-root-0001"] }], ["actual-root-0001", { id: "actual-root-0001", name: "My Drive", mimeType: "application/vnd.google-apps.folder", parents: [] }]])
  permissions = new Map()
  drive = { googleEmail: "staff@example.test", client: {
    getFile: async (_email, id) => { const row = files.get(id); if (!row) throw new Error("Missing"); return row },
    listPermissions: async (_email, id) => permissions.get(id) ?? defaultPermissions,
    downloadFile: async () => new Response(pdfBytes),
  } }
  runtime.database = database; runtime.drive = drive; runtime.preview = false; runtime.viewerId = null; runtime.previewAudience = "owner"; runtime.settings = { deliveryRootIds: ["delivery-root-001"], excludedMasterRootIds: ["master-root-0001"] }; actor("staff-a")
})
afterEach(() => { database.close(); vi.clearAllMocks() })

describe("recipient-scoped Buildertrend archives", () => {
  it("publishes an atomic edition under an internal company and exposes only curated metadata", async () => {
    const result = await publishProjectArchive("project-a", input)
    expect(result).toEqual({ success: true })
    expect(await visible("owner-a")).toHaveLength(1)
    expect(await visible("owner-c")).toEqual([])
    runtime.viewerId = "owner-a"
    const summaries = await getAudienceArchives("project-a", "owner")
    expect(summaries).toHaveLength(1)
    expect(JSON.stringify(summaries)).not.toMatch(/driveFileId|sha256|sourceAudienceEvidence|source_record_ids|source-1/)
    expect(summaries[0]?.sourceCount).toBe(2)
  })
  it("allows only the named vendor, even when company labels are identical or vendor IDs absent", async () => {
    await publish({ ...input, audience: "sub_vendor", recipientUserIds: ["vendor-x"] })
    expect(await visible("vendor-x", "sub_vendor")).toHaveLength(1)
    expect(await visible("vendor-y", "sub_vendor")).toEqual([])
    expect(await visible("owner-a", "sub_vendor")).toEqual([])
    expect(await visible("vendor-x", "owner")).toEqual([])
  })
  it("denies cross-project, cross-organization, inactive and wrong-role readers", async () => {
    await publish()
    expect(await visible("owner-a", "owner", "project-b")).toEqual([])
    expect(await visible("owner-a", "owner", "project-a", "org-b")).toEqual([])
    database.sqlite.prepare("UPDATE users SET is_active=0 WHERE id='owner-a'").run()
    expect(await visible("owner-a")).toEqual([])
    database.sqlite.prepare("UPDATE users SET is_active=1 WHERE id='owner-a'").run()
    database.sqlite.prepare("UPDATE project_members SET role='supplier' WHERE user_id='owner-a'").run()
    expect(await visible("owner-a")).toEqual([])
    expect(await visible(null)).toEqual([])
    expect(await visible("invited:pending")).toEqual([])
  })
  it("rejects stale or unauthorized recipients and leaves no partial publication on a grant race", async () => {
    expect((await publishProjectArchive("project-a", { ...input, recipientUserIds: ["owner-b"] })).success).toBe(false)
    database.failures.setBeforeBatchHook((sqlite) => { sqlite.prepare("UPDATE users SET is_active=0 WHERE id='owner-a'").run() })
    expect((await publishProjectArchive("project-a", input)).success).toBe(false)
    expect(database.sqlite.prepare("SELECT COUNT(*) n FROM project_archive_documents").get()).toEqual({ n: 0 })
  })
  it("requires scoped internal permission for publication and blocks preview mutations", async () => {
    actor("owner-a")
    expect((await publishProjectArchive("project-a", input)).success).toBe(false)
    actor("staff-b")
    expect((await publishProjectArchive("project-a", input)).success).toBe(false)
    actor("staff-a"); runtime.preview = true; runtime.viewerId = "owner-a"
    expect((await publishProjectArchive("project-a", input)).success).toBe(false)
  })
  it("enforces migration identity/scope/recipient rules independently of application code", async () => {
    const id = await publish()
    expect(() => database.sqlite.prepare("UPDATE project_archive_documents SET drive_file_id='replacement' WHERE id=?").run(id)).toThrow(/immutable/)
    expect(() => database.sqlite.prepare("UPDATE project_archive_documents SET organization_id='org-b' WHERE id=?").run(id)).toThrow(/immutable/)
    expect(() => database.sqlite.prepare("INSERT INTO project_archive_recipients(archive_id,user_id) VALUES(?, 'owner-b')").run(id)).toThrow(/matching active/)
    expect(() => database.sqlite.prepare("UPDATE project_archive_recipients SET user_id='owner-c' WHERE archive_id=?").run(id)).toThrow(/immutable/)
  })
  it("removes and restores only original recipients, with source validation and confirmation", async () => {
    const id = await publish()
    expect((await setProjectArchiveVisibility("project-a", id, { status: "revoked", reason: "Incorrect audience", confirmed: false })).success).toBe(false)
    expect(await setProjectArchiveVisibility("project-a", id, { status: "revoked", reason: "Correcting archive", confirmed: true })).toEqual({ success: true })
    expect(await visible("owner-a")).toEqual([])
    actor("owner-a"); runtime.viewerId = "owner-a"
    expect((await download(id)).status).toBe(404)
    actor("staff-a")
    expect((await setProjectArchiveVisibility("project-b", id, { status: "published", reason: "Reviewed edition", confirmed: true })).success).toBe(false)
    expect((await setProjectArchiveVisibility("project-a", id, { status: "published", reason: "Reviewed edition", confirmed: true })).success).toBe(true)
    expect(await visible("owner-a")).toHaveLength(1)
    expect(await visible("owner-c")).toEqual([])
  })
  it("serves PDF bytes only for actual grants and exact-person staff preview", async () => {
    const id = await publish()
    actor("owner-a"); runtime.viewerId = "owner-a"
    const response = await download(id)
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdfBytes)
    actor("staff-a"); runtime.preview = true; runtime.viewerId = "owner-c"
    expect((await download(id)).status).toBe(404)
    runtime.viewerId = null; expect((await download(id)).status).toBe(404)
    runtime.viewerId = "owner-a"; expect((await download(id)).status).toBe(200)
    expect((await download(id, "project-b")).status).toBe(404)
  })
  it("denies replaced file bytes on downloads and restoration", async () => {
    const id = await publish()
    const replacement = await PDFDocument.create(); replacement.addPage(); replacement.addPage(); pdfBytes = new Uint8Array(await replacement.save())
    const file = files.get(fileId); if (!file) throw new Error("Missing test file")
    files.set(fileId, { ...file, size: String(pdfBytes.length) })
    actor("owner-a"); runtime.viewerId = "owner-a"
    expect((await download(id)).status).toBe(404)
    actor("staff-a")
    await setProjectArchiveVisibility("project-a", id, { status: "revoked", reason: "Changed source", confirmed: true })
    expect((await setProjectArchiveVisibility("project-a", id, { status: "published", reason: "Try restoring", confirmed: true })).success).toBe(false)
  })
})

describe("private delivery boundary", () => {
  it("denies unconfigured, outside-root and master-nested files", async () => {
    await expect(verifyArchiveBoundary(drive, fileId, { deliveryRootIds: [], excludedMasterRootIds: [] })).rejects.toThrow(/Configure/)
    await expect(verifyArchiveBoundary(drive, fileId, { ...runtime.settings, deliveryRootIds: ["different-root-00"] })).rejects.toThrow(/approved private/)
    files.set("delivery-root-001", { id: "delivery-root-001", name: "Nested", mimeType: "application/vnd.google-apps.folder", parents: ["master-root-0001"] })
    await expect(verifyArchiveBoundary(drive, fileId, runtime.settings)).rejects.toThrow(/Internal master/)
  })
  it("denies public/shared permissions on files or ancestors, cycles, trash and oversized volumes", async () => {
    permissions.set(fileId, [...defaultPermissions, { id: "public", type: "anyone", role: "reader" }])
    await expect(readArchivePdf(drive, fileId, runtime.settings)).rejects.toThrow(/must be private/)
    permissions.delete(fileId)
    permissions.set("delivery-root-001", [{ id: "other", type: "user", role: "reader", emailAddress: "outside@example.test" }])
    await expect(readArchivePdf(drive, fileId, runtime.settings)).rejects.toThrow(/must be private/)
    permissions.clear()
    const file = files.get(fileId); if (!file) throw new Error("Missing fixture")
    files.set(fileId, { ...file, size: String(MAX_ARCHIVE_BYTES + 1) })
    await expect(readArchivePdf(drive, fileId, runtime.settings)).rejects.toThrow(/20 MB/)
    files.set(fileId, { ...file, trashed: true })
    await expect(readArchivePdf(drive, fileId, runtime.settings)).rejects.toThrow(/private My Drive/)
    files.set(fileId, file)
    files.set("actual-root-0001", { id: "actual-root-0001", name: "Cycle", mimeType: "application/vnd.google-apps.folder", parents: ["delivery-root-001"] })
    await expect(readArchivePdf(drive, fileId, runtime.settings)).rejects.toThrow(/Internal master/)
  })
  it("requires PDF bytes and configured excluded masters", async () => {
    expect(archiveDeliverySettingsSchema.safeParse({ deliveryRootIds: ["delivery-root-001"], excludedMasterRootIds: [] }).success).toBe(false)
    expect(archiveDeliverySettingsSchema.safeParse({ deliveryRootIds: [], excludedMasterRootIds: [] }).success).toBe(true)
    pdfBytes = new TextEncoder().encode("not a PDF")
    const file = files.get(fileId); if (!file) throw new Error("Missing fixture")
    files.set(fileId, { ...file, size: String(pdfBytes.length) })
    await expect(readArchivePdf(drive, fileId, runtime.settings)).rejects.toThrow(/not a PDF/)
  })
  it("rechecks account and project role when listing readers after publication", async () => {
    await publish()
    database.sqlite.prepare("UPDATE organization_members SET role='admin' WHERE user_id='owner-a'").run()
    expect((await archiveReaders(database.db, "project-a", "org-a")).some((reader) => reader.id === "owner-a")).toBe(false)
    expect(await visible("owner-a")).toEqual([])
  })
})
