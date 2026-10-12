import { describe, expect, it } from "vitest"

import type {
  DriveFile,
  DriveFileList,
  ListFilesOptions,
} from "@/lib/google/client/types"
import {
  projectDriveTemplateFolderId,
  provisionProjectDriveFolder,
} from "@/lib/google/project-drive-provisioning"
import { PROJECT_FILE_SOURCES } from "@/lib/project-files"

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

class FakeDriveClient {
  private readonly files = new Map<string, DriveFile>()
  private sequence = 0

  add(file: DriveFile): void {
    this.files.set(file.id, file)
  }

  async listFiles(
    _userEmail: string,
    options: ListFilesOptions = {}
  ): Promise<DriveFileList> {
    let files = [...this.files.values()].filter((file) =>
      options.folderId ? file.parents?.includes(options.folderId) : true
    )
    const nameMatch = options.query?.match(/name = '([^']+)'/)
    const requiredName = nameMatch?.[1] ?? null
    if (requiredName) files = files.filter((file) => file.name === requiredName)
    return { files }
  }

  async getFile(_userEmail: string, fileId: string): Promise<DriveFile> {
    const file = this.files.get(fileId)
    if (!file) throw new Error(`Missing fake Drive file ${fileId}`)
    return file
  }

  async createFolder(
    _userEmail: string,
    options: {
      readonly name: string
      readonly parentId?: string
      readonly driveId?: string
    }
  ): Promise<DriveFile> {
    this.sequence += 1
    const folder: DriveFile = {
      id: `created-folder-${this.sequence}`,
      name: options.name,
      mimeType: FOLDER_MIME_TYPE,
      parents: [options.parentId ?? options.driveId ?? "root"],
    }
    this.add(folder)
    return folder
  }

  async copyFile(
    _userEmail: string,
    fileId: string,
    options: { readonly name: string; readonly parentId: string }
  ): Promise<DriveFile> {
    const source = await this.getFile(_userEmail, fileId)
    this.sequence += 1
    const copied: DriveFile = {
      ...source,
      id: `copied-file-${this.sequence}`,
      name: options.name,
      parents: [options.parentId],
    }
    this.add(copied)
    return copied
  }
}

describe("project Drive provisioning", () => {
  it("uses the department templates stored in the Developer folder", () => {
    expect(projectDriveTemplateFolderId("O")).toBe(
      "1MKrmHWS0gjhRDzcLmv4quz-NvqCJEei9"
    )
    expect(projectDriveTemplateFolderId("H")).toBe(
      "11sUheLU_sXpr6uS7v_MaswmdRtMNSokH"
    )
    expect(projectDriveTemplateFolderId("D")).toBe(
      "1-0QvQBQrF52ytwUltkt9qBAzAtxdFAQT"
    )
    expect(projectDriveTemplateFolderId("N")).toBe(
      "1S0A0AtLKNLp-sLvIwqRLaK2BoyLvmKdm"
    )
  })

  it("recursively copies template folders and files without duplicating retries", async () => {
    const client = new FakeDriveClient()
    const templateId = projectDriveTemplateFolderId("H")
    const source = PROJECT_FILE_SOURCES.find(
      (candidate) => candidate.projectPrefix === "H"
    )
    if (!source) throw new Error("HPS project source is not configured")

    client.add({
      id: templateId,
      name: "H-SequentialNumber-AddressNumber-LastName",
      mimeType: FOLDER_MIME_TYPE,
    })
    client.add({
      id: "template-plans",
      name: "04_PermittedPlansSpecifications",
      mimeType: FOLDER_MIME_TYPE,
      parents: [templateId],
    })
    client.add({
      id: "template-plan-file",
      name: "Plan Review Checklist",
      mimeType: "application/vnd.google-apps.document",
      parents: ["template-plans"],
    })

    const first = await provisionProjectDriveFolder(
      client,
      "projects@hps-colorado.com",
      { department: "H", folderName: "H-999 - Test Project", templateEmail: "integration@example.com" }
    )
    expect(first.parentFolderId).toBe(source.folderId)
    expect(first.childFolderNames).toEqual([
      "04_PermittedPlansSpecifications",
    ])
    expect(first.createdChildCount).toBe(1)
    expect(first.copiedFileCount).toBe(1)

    const second = await provisionProjectDriveFolder(
      client,
      "projects@hps-colorado.com",
      { department: "H", folderName: "H-999 - Test Project", templateEmail: "integration@example.com" }
    )
    expect(second.folderId).toBe(first.folderId)
    expect(second.createdChildCount).toBe(0)
    expect(second.copiedFileCount).toBe(0)
  })

  it("provisions a phase folder under an existing family parent", async () => {
    const client = new FakeDriveClient()
    const templateId = projectDriveTemplateFolderId("H")
    client.add({
      id: templateId,
      name: "H-SequentialNumber-AddressNumber-LastName",
      mimeType: FOLDER_MIME_TYPE,
    })
    client.add({
      id: "family-parent",
      name: "H-999 - Existing project",
      mimeType: FOLDER_MIME_TYPE,
      parents: ["department-root"],
    })

    const result = await provisionProjectDriveFolder(
      client,
      "projects@hps-colorado.com",
      {
        department: "H",
        templateEmail: "integration@example.com",
        folderName: "H-999-1 - Phase 1",
        parentFolderId: "family-parent",
      },
    )

    expect(result.parentFolderId).toBe("family-parent")
    const phaseFolder = await client.getFile(
      "projects@hps-colorado.com",
      result.folderId,
    )
    expect(phaseFolder.parents).toEqual(["family-parent"])
  })

  it("copies the template as the integration account when the submitter cannot open it", async () => {
    const templateId = projectDriveTemplateFolderId("N")
    const restricted = new Set([templateId, "template-quotes"])
    // Staff can create folders in the department root but are not shared on
    // the Developer templates, which only the integration account can read.
    class SharedOnlyWithIntegration extends FakeDriveClient {
      async listFiles(userEmail: string, options: ListFilesOptions = {}): Promise<DriveFileList> {
        if (userEmail !== "integration@example.com" && options.folderId && restricted.has(options.folderId)) {
          throw new Error("File not found")
        }
        return super.listFiles(userEmail, options)
      }

      async getFile(userEmail: string, fileId: string): Promise<DriveFile> {
        if (userEmail !== "integration@example.com" && restricted.has(fileId)) {
          throw new Error("File not found")
        }
        return super.getFile(userEmail, fileId)
      }
    }
    const client = new SharedOnlyWithIntegration()
    client.add({ id: templateId, name: "N-SequentialNumber-AddressNumber-LastName", mimeType: FOLDER_MIME_TYPE })
    client.add({ id: "template-quotes", name: "01_Quotes", mimeType: FOLDER_MIME_TYPE, parents: [templateId] })

    const result = await provisionProjectDriveFolder(client, "staff@example.com", {
      department: "N",
      folderName: "N-1009-12 - Test Fox Blocks",
      templateEmail: "integration@example.com",
    })

    expect(result.createdRoot).toBe(true)
    expect(result.childFolderNames).toEqual(["01_Quotes"])
    expect(result.createdChildCount).toBe(1)
  })
})
