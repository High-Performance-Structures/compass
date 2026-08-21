import { describe, expect, it } from "vitest"

import type {
  DriveFile,
  DriveFileList,
  ListFilesOptions,
} from "@/lib/google/client/types"
import {
  COMPASS_DEVELOPER_FOLDER_ID,
  estimateTextTemplateDriveFileName,
  syncEstimateTextTemplateToDrive,
} from "@/lib/estimates/text-template-drive-store"

class FakeDriveClient {
  readonly files = new Map<string, DriveFile>()
  readonly contents = new Map<string, string>()
  createFolderCount = 0
  uploadCount = 0
  updateCount = 0

  async listFiles(
    _userEmail: string,
    options: ListFilesOptions = {}
  ): Promise<DriveFileList> {
    const parentId = options.folderId
    const nameMatch = options.query?.match(/name = '([^']+)'/)
    const name = nameMatch?.[1] ?? null
    return {
      files: [...this.files.values()].filter(
        (file) =>
          (!parentId || file.parents?.includes(parentId)) &&
          (!name || file.name === name)
      ),
    }
  }

  async getFile(_userEmail: string, fileId: string): Promise<DriveFile> {
    const file = this.files.get(fileId)
    if (!file) throw new Error("not found")
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
    this.createFolderCount += 1
    const folder: DriveFile = {
      id: `folder-${this.createFolderCount}`,
      name: options.name,
      mimeType: "application/vnd.google-apps.folder",
      parents: options.parentId ? [options.parentId] : [],
    }
    this.files.set(folder.id, folder)
    return folder
  }

  async uploadFile(
    _userEmail: string,
    options: {
      readonly name: string
      readonly parentId?: string
      readonly mimeType: string
      readonly data: Blob
      readonly appProperties?: Readonly<Record<string, string>>
    }
  ): Promise<DriveFile> {
    this.uploadCount += 1
    const file: DriveFile = {
      id: `file-${this.uploadCount}`,
      name: options.name,
      mimeType: options.mimeType,
      parents: options.parentId ? [options.parentId] : [],
      webViewLink: `https://drive.google.com/file/d/file-${this.uploadCount}/view`,
    }
    this.files.set(file.id, file)
    this.contents.set(file.id, await options.data.text())
    return file
  }

  async updateFileContent(
    _userEmail: string,
    fileId: string,
    data: Blob,
    mimeType: string
  ): Promise<DriveFile> {
    const file = await this.getFile("", fileId)
    expect(mimeType).toBe("text/plain")
    this.updateCount += 1
    this.contents.set(fileId, await data.text())
    return file
  }

  async renameFile(
    _userEmail: string,
    fileId: string,
    newName: string
  ): Promise<DriveFile> {
    const current = await this.getFile("", fileId)
    const renamed: DriveFile = { ...current, name: newName }
    this.files.set(fileId, renamed)
    return renamed
  }
}

describe("estimate text template Drive storage", () => {
  it("builds readable and filesystem-safe names", () => {
    expect(
      estimateTextTemplateDriveFileName({
        name: "Standard / Owner: Introduction",
        departmentCode: "O",
        templateType: "introduction",
      })
    ).toBe("O - Introduction - Standard - Owner- Introduction.txt")
  })

  it("creates the Template Library once and updates the same file", async () => {
    const client = new FakeDriveClient()
    const first = await syncEstimateTextTemplateToDrive({
      client,
      userEmail: "estimator@example.com",
      currentFileId: null,
      name: "Default Introductory Text",
      departmentCode: null,
      templateType: "introduction",
      body: "First version",
    })
    const second = await syncEstimateTextTemplateToDrive({
      client,
      userEmail: "estimator@example.com",
      currentFileId: first.fileId,
      name: "Default Introductory Text",
      departmentCode: null,
      templateType: "introduction",
      body: "Edited version",
    })

    expect(first.folderUrl).toBe(
      "https://drive.google.com/drive/folders/folder-1"
    )
    expect(second.fileId).toBe(first.fileId)
    expect(client.createFolderCount).toBe(1)
    expect(client.uploadCount).toBe(1)
    expect(client.updateCount).toBe(1)
    expect(client.contents.get(first.fileId)).toBe("Edited version")
    expect(
      [...client.files.values()].find(
        (file) => file.id === "folder-1"
      )?.parents
    ).toContain(COMPASS_DEVELOPER_FOLDER_ID)
  })
})
