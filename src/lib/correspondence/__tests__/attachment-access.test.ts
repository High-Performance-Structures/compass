import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  correspondenceContext: vi.fn(),
  authorizedConversation: vi.fn(),
  currentParticipants: vi.fn(),
  getOrganizationDriveContext: vi.fn(),
  getFile: vi.fn(),
  downloadFile: vi.fn(),
  trashFile: vi.fn(),
}))

vi.mock("@/lib/correspondence/access", () => ({
  correspondenceContext: mocks.correspondenceContext,
  authorizedConversation: mocks.authorizedConversation,
  currentParticipants: mocks.currentParticipants,
}))
vi.mock("@/lib/google/organization-drive", () => ({
  getOrganizationDriveContext: mocks.getOrganizationDriveContext,
}))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: vi.fn() }))

import {
  deleteStagedCorrespondenceAttachment,
  downloadCorrespondenceAttachment,
} from "@/lib/correspondence/attachment-storage"

const privateFolder = {
  id: "folder-1",
  name: "Correspondence staging",
  mimeType: "application/vnd.google-apps.folder",
  trashed: false,
  shared: false,
  permissions: [
    { id: "permission-1", type: "user", role: "owner", emailAddress: "mailbox@example.com" },
  ],
}

const attachment = {
  id: "attachment-1",
  ownerUserId: "user-1",
  messageId: "message-1",
  name: "plans.pdf",
  contentType: "application/pdf",
  size: 12,
  driveFileId: "drive-file-1",
  retiredAt: null,
  conversationId: "conversation-1",
  retractedAt: null,
}

function dbFor(rows: readonly unknown[]) {
  let index = 0
  return {
    select() {
      const row = rows[index] ?? null
      index += 1
      const chain = {
        from() { return chain },
        leftJoin() { return chain },
        where() { return chain },
        get() { return Promise.resolve(row) },
      }
      return chain
    },
  }
}

function setup(input: {
  readonly rows: readonly unknown[]
  readonly attachmentParticipants?: readonly { readonly userId: string }[]
}) {
  mocks.correspondenceContext.mockResolvedValue({
    db: dbFor(input.rows),
    env: {
      COMPASS_CORRESPONDENCE_STAGING_FOLDERS: JSON.stringify({ "org-1": "folder-1" }),
      COMPASS_CORRESPONDENCE_DRIVE_USER: "mailbox@example.com",
    },
    user: {
      id: "user-1",
      email: "member@example.com",
      displayName: "Member",
      firstName: null,
      lastName: null,
      role: "member",
    },
    organizationId: "org-1",
    projectId: "project-1",
  })
  mocks.authorizedConversation.mockResolvedValue({ id: "conversation-1" })
  mocks.currentParticipants.mockResolvedValue(
    input.attachmentParticipants ?? [{ userId: "user-1" }]
  )
  mocks.getOrganizationDriveContext.mockResolvedValue({
    client: {
      getFile: mocks.getFile,
      downloadFile: mocks.downloadFile,
      trashFile: mocks.trashFile,
    },
    userEmail: "member@example.com",
  })
  mocks.getFile.mockResolvedValueOnce(privateFolder).mockResolvedValueOnce({
    id: "drive-file-1",
    name: "plans.pdf",
    mimeType: "application/pdf",
    parents: ["folder-1"],
    trashed: false,
  })
  mocks.downloadFile.mockResolvedValue(new Response("file-bytes", { status: 200 }))
}

function dbForDelete(input: {
  readonly row: unknown
  readonly claim: readonly { readonly id: string }[]
}) {
  const select = vi.fn().mockReturnValue({
    from() { return this },
    leftJoin() { return this },
    where() { return this },
    get() { return Promise.resolve(input.row) },
  })
  const returning = vi.fn().mockResolvedValue(input.claim)
  const where = vi.fn().mockReturnValue({ returning })
  const set = vi.fn().mockReturnValue({ where })
  const update = vi.fn().mockReturnValue({ set })
  return { select, update, set, where, returning }
}

describe("correspondence attachment access", () => {
  beforeEach(() => {
    mocks.correspondenceContext.mockReset()
    mocks.authorizedConversation.mockReset()
    mocks.currentParticipants.mockReset()
    mocks.getOrganizationDriveContext.mockReset()
    mocks.getFile.mockReset()
    mocks.downloadFile.mockReset()
    mocks.trashFile.mockReset()
  })

  it("requires the message recipient record and current active conversation grant", async () => {
    setup({ rows: [attachment, { id: "recipient-1" }] })

    const result = await downloadCorrespondenceAttachment({
      projectId: "project-1",
      attachmentId: "attachment-1",
    })

    expect(await result.body.text()).toBe("file-bytes")
    expect(mocks.authorizedConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conversation-1"
    )
    expect(mocks.currentParticipants).toHaveBeenCalledWith(
      expect.anything(),
      "conversation-1"
    )
  })

  it("denies a sent attachment without a message-recipient grant before Drive access", async () => {
    setup({ rows: [attachment, null] })

    await expect(
      downloadCorrespondenceAttachment({ projectId: "project-1", attachmentId: "attachment-1" })
    ).rejects.toMatchObject({ status: 404 })
    expect(mocks.getOrganizationDriveContext).not.toHaveBeenCalled()
  })

  it("denies retracted messages and another user's staged attachment before Drive access", async () => {
    setup({ rows: [{ ...attachment, retractedAt: "2026-09-05T00:00:00.000Z" }] })
    await expect(
      downloadCorrespondenceAttachment({ projectId: "project-1", attachmentId: "attachment-1" })
    ).rejects.toMatchObject({ status: 404 })

    setup({ rows: [{ ...attachment, messageId: null, ownerUserId: "user-2", conversationId: null }] })
    await expect(
      downloadCorrespondenceAttachment({ projectId: "project-1", attachmentId: "attachment-1" })
    ).rejects.toMatchObject({ status: 404 })
    expect(mocks.getOrganizationDriveContext).not.toHaveBeenCalled()
  })

  it("does not trash when a concurrent send attaches the staging row first", async () => {
    const db = dbForDelete({
      row: { ...attachment, messageId: null, conversationId: null },
      claim: [],
    })
    setup({ rows: [] })
    mocks.correspondenceContext.mockResolvedValue({
      db,
      env: {},
      user: { id: "user-1", email: "member@example.com" },
      organizationId: "org-1",
      projectId: "project-1",
    })

    await expect(
      deleteStagedCorrespondenceAttachment({ projectId: "project-1", attachmentId: "attachment-1" })
    ).rejects.toMatchObject({ status: 404 })

    expect(mocks.getOrganizationDriveContext).not.toHaveBeenCalled()
    expect(mocks.trashFile).not.toHaveBeenCalled()
  })

  it("trashes only after the durable retirement compare-and-set wins", async () => {
    const db = dbForDelete({
      row: { ...attachment, messageId: null, conversationId: null },
      claim: [{ id: "attachment-1" }],
    })
    setup({ rows: [] })
    mocks.correspondenceContext.mockResolvedValue({
      db,
      env: {
        COMPASS_CORRESPONDENCE_STAGING_FOLDERS: JSON.stringify({ "org-1": "folder-1" }),
        COMPASS_CORRESPONDENCE_DRIVE_USER: "mailbox@example.com",
      },
      user: { id: "user-1", email: "member@example.com" },
      organizationId: "org-1",
      projectId: "project-1",
    })
    mocks.getOrganizationDriveContext.mockResolvedValue({
      client: { getFile: mocks.getFile, trashFile: mocks.trashFile },
      userEmail: "member@example.com",
    })
    mocks.getFile.mockResolvedValue(privateFolder)
    mocks.trashFile.mockResolvedValue({ id: "drive-file-1" })

    await deleteStagedCorrespondenceAttachment({
      projectId: "project-1",
      attachmentId: "attachment-1",
    })

    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ retiredAt: expect.any(String) })
    )
    expect(mocks.trashFile).toHaveBeenCalledWith("mailbox@example.com", "drive-file-1")
  })

  it("retries a previously retired staging locator without another compare-and-set", async () => {
    const db = dbFor([{ ...attachment, messageId: null, conversationId: null, retiredAt: "2026-09-05T00:00:00.000Z" }])
    setup({ rows: [] })
    mocks.correspondenceContext.mockResolvedValue({
      db,
      env: {
        COMPASS_CORRESPONDENCE_STAGING_FOLDERS: JSON.stringify({ "org-1": "folder-1" }),
        COMPASS_CORRESPONDENCE_DRIVE_USER: "mailbox@example.com",
      },
      user: { id: "user-1", email: "member@example.com" },
      organizationId: "org-1",
      projectId: "project-1",
    })
    mocks.getOrganizationDriveContext.mockResolvedValue({
      client: { getFile: mocks.getFile, trashFile: mocks.trashFile },
      userEmail: "member@example.com",
    })
    mocks.getFile.mockResolvedValue(privateFolder)
    mocks.trashFile.mockResolvedValue({ id: "drive-file-1" })

    await deleteStagedCorrespondenceAttachment({
      projectId: "project-1",
      attachmentId: "attachment-1",
    })

    expect(mocks.trashFile).toHaveBeenCalledWith("mailbox@example.com", "drive-file-1")
  })
})
