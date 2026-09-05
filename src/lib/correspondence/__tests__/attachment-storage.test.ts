import { describe, expect, it } from "vitest"

import {
  isRestrictedCorrespondenceFolder,
  restrictedCorrespondenceDriveFolder,
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

describe("restricted correspondence attachment storage", () => {
  it("requires a per-organization folder mapping and dedicated Drive user", () => {
    expect(
      restrictedCorrespondenceDriveFolder({
        organizationId: "org-1",
        environment: {
          COMPASS_CORRESPONDENCE_STAGING_FOLDERS: JSON.stringify({ "org-1": "folder-1" }),
          COMPASS_CORRESPONDENCE_DRIVE_USER: "Mailbox@Example.com",
        },
      })
    ).toEqual({ id: "folder-1", userEmail: "mailbox@example.com" })
    expect(
      restrictedCorrespondenceDriveFolder({
        organizationId: "org-2",
        environment: {
          COMPASS_CORRESPONDENCE_STAGING_FOLDERS: JSON.stringify({ "org-1": "folder-1" }),
          COMPASS_CORRESPONDENCE_DRIVE_USER: "mailbox@example.com",
        },
      })
    ).toBeNull()
  })

  it("accepts only an inspectable private regular Drive folder", () => {
    expect(
      isRestrictedCorrespondenceFolder({
        folder: privateFolder,
        expectedFolderId: "folder-1",
        dedicatedUserEmail: "mailbox@example.com",
      })
    ).toBe(true)
  })

  it.each([
    ["a shared drive", { ...privateFolder, driveId: "shared-drive-1" }],
    ["a shared folder", { ...privateFolder, shared: true }],
    ["a domain ACL", { ...privateFolder, permissions: [{ id: "permission-2", type: "domain", role: "reader" }] }],
    ["a group ACL", { ...privateFolder, permissions: [{ id: "permission-3", type: "group", role: "reader", emailAddress: "partners@example.com" }] }],
    ["a different named user", { ...privateFolder, permissions: [{ id: "permission-4", type: "user", role: "reader", emailAddress: "partner@example.com" }] }],
    ["missing ACL inspection", { ...privateFolder, permissions: undefined }],
  ])("fails closed for %s", (_label, folder) => {
    expect(
      isRestrictedCorrespondenceFolder({
        folder,
        expectedFolderId: "folder-1",
        dedicatedUserEmail: "mailbox@example.com",
      })
    ).toBe(false)
  })
})
