import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { context, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "./helpers/correspondence-core"
import { listCorrespondenceProjectFiles, stageCorrespondenceProjectFile } from "@/lib/correspondence/project-file-attachments"

const mocks = vi.hoisted(() => ({ context: vi.fn(), drive: vi.fn(), publishedDrive: vi.fn(), stage: vi.fn(), getFile: vi.fn(), listFiles: vi.fn(), download: vi.fn(), export: vi.fn(), permission: vi.fn() }))
vi.mock("@/lib/correspondence/access", () => ({ correspondenceContext: mocks.context }))
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.permission }))
vi.mock("@/lib/google/organization-drive", () => ({ getOrganizationDriveContext: mocks.drive }))
vi.mock("@/lib/google/project-document-drive", () => ({ getProjectDocumentDriveContext: mocks.publishedDrive }))
vi.mock("@/lib/correspondence/attachment-storage", async (original) => {
  const actual = await original<typeof import("@/lib/correspondence/attachment-storage")>()
  return { ...actual, stageCorrespondenceAttachment: mocks.stage }
})
let database: CorrespondenceTestDatabase | undefined
function setup(): CorrespondenceTestDatabase {
  const db = openCorrespondenceTestDatabase(); database = db
  db.sqlite.exec("ALTER TABLE projects ADD COLUMN google_drive_folder_id TEXT; UPDATE projects SET google_drive_folder_id='root-a' WHERE id='project-a'")
  db.sqlite.exec(readFileSync("drizzle/0145_project_documents.sql", "utf8").split("ALTER TABLE")[0].replaceAll("--> statement-breakpoint", ""))
  const client = { getFile: mocks.getFile, listFiles: mocks.listFiles, downloadFile: mocks.download, exportFile: mocks.export }
  mocks.context.mockResolvedValue(context(db, "staff-a", "project-a"))
  mocks.drive.mockResolvedValue({ client, userEmail: "staff-a@example.test" })
  mocks.publishedDrive.mockResolvedValue({ client, googleEmail: "storage@example.test", sharedDriveId: null })
  mocks.getFile.mockImplementation(async (_email: string, id: string) => id === "root-a" ? { id, name: "Project", mimeType: "application/vnd.google-apps.folder" } : { id, name: "Plan.pdf", mimeType: "application/pdf", size: "4", parents: id === "foreign-root" ? [] : [id === "outside" ? "foreign-root" : "root-a"] })
  mocks.download.mockImplementation(async () => new Response(new Uint8Array([0, 255, 1, 2])))
  mocks.export.mockImplementation(async () => new Response("PDF export"))
  mocks.stage.mockResolvedValue({ id: "staged-file", name: "Plan.pdf", size: 4, contentType: "application/pdf" })
  return db
}
beforeEach(() => vi.resetAllMocks())
afterEach(() => database?.close())

describe("project file attachments", () => {
  it("browses only within the mapped project folder, with pagination", async () => {
    setup()
    mocks.listFiles.mockResolvedValue({ files: [{ id: "child", name: "Plans", mimeType: "application/vnd.google-apps.folder" }, { id: "pdf", name: "Plan.pdf", mimeType: "application/pdf", size: "4" }], nextPageToken: "page-2" })
    expect(await listCorrespondenceProjectFiles("project-a", null, null)).toEqual({ files: [{ id: "child", name: "Plans", kind: "folder", contentType: "application/vnd.google-apps.folder", size: null }, { id: "pdf", name: "Plan.pdf", kind: "file", contentType: "application/pdf", size: 4 }], nextPageToken: "page-2" })
    mocks.getFile.mockImplementation(async (_email: string, id: string) => ({ id, name: id, mimeType: "application/vnd.google-apps.folder", parents: [] }))
    await expect(listCorrespondenceProjectFiles("project-a", "foreign-root", null)).rejects.toThrow("not found")
    expect(mocks.listFiles).toHaveBeenCalledTimes(1)
  })
  it("stages an exact private snapshot and never changes the source file", async () => {
    setup()
    await stageCorrespondenceProjectFile("project-a", "plan")
    const call = mocks.stage.mock.calls[0]?.[0]
    expect(call?.projectId).toBe("project-a")
    expect(call?.file).toBeInstanceOf(File)
    expect(new Uint8Array(await call.file.arrayBuffer())).toEqual(new Uint8Array([0, 255, 1, 2]))
    expect(call.file.name).toBe("Plan.pdf")
    expect(mocks.download).toHaveBeenCalledWith("staff-a@example.test", "plan")
  })
  it("rejects files outside this project before downloading or staging", async () => {
    setup()
    await expect(stageCorrespondenceProjectFile("project-a", "outside")).rejects.toThrow("not found")
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.stage).not.toHaveBeenCalled()
  })
  it("exports native Google files to an attachable format", async () => {
    setup()
    mocks.getFile.mockResolvedValue({ id: "native", name: "Plan", mimeType: "application/vnd.google-apps.document", parents: ["root-a"] })
    await stageCorrespondenceProjectFile("project-a", "native")
    expect(mocks.export).toHaveBeenCalledWith("staff-a@example.test", "native", "application/pdf")
    expect(mocks.stage.mock.calls[0]?.[0].file.name).toBe("Plan.pdf")
  })
  it("limits portal users to downloadable published documents and rechecks before staging", async () => {
    const db = setup()
    mocks.context.mockResolvedValue(context(db, "owner-a", "project-a"))
    db.sqlite.exec("INSERT INTO project_documents (id,project_id,category,title,status,audience,downloadable,source_drive_file_id,source_file_name,source_mime_type,published_at,created_at,updated_at) VALUES ('published','project-a','other','Approved plan','current','project_team',1,'plan','Plan.pdf','application/pdf','now','now','now'), ('draft','project-a','other','Private draft','draft','project_team',1,'draft-file','Draft.pdf','application/pdf',NULL,'now','now'), ('other-project','project-b','other','Other project','current','project_team',1,'other-file','Other.pdf','application/pdf','now','now','now')")
    expect((await listCorrespondenceProjectFiles("project-a", null, null)).files.map((file) => file.id)).toEqual(["published"])
    await expect(stageCorrespondenceProjectFile("project-a", "draft")).rejects.toThrow("not found")
    await stageCorrespondenceProjectFile("project-a", "published")
    expect(mocks.publishedDrive).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-a" }))
    db.sqlite.exec("UPDATE project_documents SET downloadable=0 WHERE id='published'")
    await expect(stageCorrespondenceProjectFile("project-a", "published")).rejects.toThrow("not found")
    expect(mocks.stage).toHaveBeenCalledTimes(1)
  })
  it("requires document read permission for browsing staff project files", async () => {
    setup()
    mocks.permission.mockImplementation(() => { throw new Error("Permission denied") })
    await expect(listCorrespondenceProjectFiles("project-a", null, null)).rejects.toThrow("Permission denied")
    expect(mocks.drive).not.toHaveBeenCalled()
  })
})
