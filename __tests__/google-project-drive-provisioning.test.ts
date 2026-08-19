import { describe, expect, it } from "vitest"

import type {
  DriveFile,
  DriveFileList,
  ListFilesOptions,
} from "@/lib/google/client/types"
import {
  buildProjectDriveFolderName,
  projectDriveTemplateFolderId,
  provisionProjectDriveFolder,
} from "@/lib/google/project-drive-provisioning"

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

class MemoryDriveClient {
  readonly files = new Map<string, DriveFile>()
  readonly createdNames: string[] = []
  private nextId = 1

  async listFiles(
    _userEmail: string,
    options: ListFilesOptions = {}
  ): Promise<DriveFileList> {
    const exactName = options.query?.match(/name = '(.+)'/)?.[1]
    return {
      files: [...this.files.values()].filter((file) => {
        const inParent = options.folderId
          ? file.parents?.includes(options.folderId) === true
          : true
        return inParent && (!exactName || file.name === exactName)
      }),
    }
  }

  async getFile(_userEmail: string, fileId: string): Promise<DriveFile> {
    const file = this.files.get(fileId)
    if (!file) throw new Error("Missing test file")
    return file
  }

  async createFolder(
    _userEmail: string,
    options: { readonly name: string; readonly parentId?: string }
  ): Promise<DriveFile> {
    const id = `folder-${this.nextId}`
    this.nextId += 1
    const file: DriveFile = {
      id,
      name: options.name,
      mimeType: FOLDER_MIME_TYPE,
      parents: options.parentId ? [options.parentId] : [],
    }
    this.files.set(id, file)
    this.createdNames.push(options.name)
    return file
  }

  async copyFile(
    _userEmail: string,
    fileId: string,
    options: { readonly name: string; readonly parentId: string }
  ): Promise<DriveFile> {
    const source = await this.getFile(_userEmail, fileId)
    const id = `file-${this.nextId}`
    this.nextId += 1
    const file: DriveFile = {
      ...source,
      id,
      name: options.name,
      parents: [options.parentId],
    }
    this.files.set(id, file)
    return file
  }
}

describe("project Drive provisioning", () => {
  it("builds a filesystem-safe project folder name", () => {
    expect(
      buildProjectDriveFolderName({
        projectNumber: "O-214-55",
        projectName: "Smith / Jones Residence",
        streetNumber: "55",
        streetName: "County Rd: 7",
      })
    ).toBe("O-214-55 - 55 County Rd- 7 - Smith - Jones Residence")
  })

  it("creates and verifies the ORC folder set under the canonical department root", async () => {
    const client = new MemoryDriveClient()
    const templateId = projectDriveTemplateFolderId("O")
    client.files.set(templateId, {
      id: templateId,
      name: "O-SequentialNumber-AddressNumber-LastName",
      mimeType: FOLDER_MIME_TYPE,
    })
    for (const name of ["03_PayRequests", "11_ChangeOrders"]) {
      client.files.set(`template-${name}`, {
        id: `template-${name}`,
        name,
        mimeType: FOLDER_MIME_TYPE,
        parents: [templateId],
      })
    }
    const result = await provisionProjectDriveFolder(
      client,
      "martine@hps-colorado.com",
      { department: "O", folderName: "O-214-55 - Smith Residence" }
    )

    expect(result.createdRoot).toBe(true)
    expect(result.createdChildCount).toBe(2)
    expect(client.createdNames).toContain("03_PayRequests")
    expect(client.createdNames).toContain("11_ChangeOrders")
    expect(result.parentFolderId).toBe("0Bzi_pskoDROqd3RCemxpT3Flanc")
  })

  it("reuses a previously created root and only fills missing children", async () => {
    const client = new MemoryDriveClient()
    const templateId = projectDriveTemplateFolderId("H")
    client.files.set(templateId, {
      id: templateId,
      name: "H-SequentialNumber-AddressNumber-LastName",
      mimeType: FOLDER_MIME_TYPE,
    })
    client.files.set("template-plans", {
      id: "template-plans",
      name: "04_PermittedPlansSpecifications",
      mimeType: FOLDER_MIME_TYPE,
      parents: [templateId],
    })
    await client.createFolder("test@example.com", {
      name: "H-432-10 - Example",
      parentId: "0Bzi_pskoDROqcEZZRHhIQ01RMmc",
    })

    const first = await provisionProjectDriveFolder(client, "test@example.com", {
      department: "H",
      folderName: "H-432-10 - Example",
    })
    const createdAfterFirstRun = client.createdNames.length
    const second = await provisionProjectDriveFolder(client, "test@example.com", {
      department: "H",
      folderName: "H-432-10 - Example",
    })

    expect(first.createdRoot).toBe(false)
    expect(second.createdRoot).toBe(false)
    expect(second.createdChildCount).toBe(0)
    expect(client.createdNames).toHaveLength(createdAfterFirstRun)
  })
})
