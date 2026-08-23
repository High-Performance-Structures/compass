import type { DriveFile, DriveFileList, ListFilesOptions } from "@/lib/google/client/types"
import {
  COMPASS_DEVELOPER_FOLDER_ID,
  ESTIMATE_TEMPLATE_LIBRARY_FOLDER_NAME,
} from "@/lib/estimates/text-template-drive-store"

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
const CONTRACT_LIBRARY_FOLDER_NAME = "Contracts"
const MARKDOWN_MIME_TYPE = "text/markdown"

type ContractTemplateDriveClient = {
  readonly listFiles: (
    userEmail: string,
    options?: ListFilesOptions
  ) => Promise<DriveFileList>
  readonly getFile: (userEmail: string, fileId: string) => Promise<DriveFile>
  readonly createFolder: (
    userEmail: string,
    options: { readonly name: string; readonly parentId?: string }
  ) => Promise<DriveFile>
  readonly uploadFile: (
    userEmail: string,
    options: {
      readonly name: string
      readonly parentId?: string
      readonly mimeType: string
      readonly data: Blob
      readonly appProperties?: Readonly<Record<string, string>>
    }
  ) => Promise<DriveFile>
  readonly updateFileContent: (
    userEmail: string,
    fileId: string,
    data: Blob,
    mimeType: string
  ) => Promise<DriveFile>
  readonly renameFile: (
    userEmail: string,
    fileId: string,
    newName: string
  ) => Promise<DriveFile>
}

function queryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function safeFilePart(value: string): string {
  return (
    value
      .replace(/[/:\\]/g, "-")
      .replace(/[\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Untitled"
  )
}

async function findFolder(
  client: ContractTemplateDriveClient,
  userEmail: string,
  parentId: string,
  name: string
): Promise<DriveFile | null> {
  const result = await client.listFiles(userEmail, {
    folderId: parentId,
    query:
      `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and ` +
      `name = '${queryValue(name)}'`,
    pageSize: 10,
    orderBy: "createdTime",
  })
  return result.files[0] ?? null
}

async function ensureFolder(
  client: ContractTemplateDriveClient,
  userEmail: string,
  parentId: string,
  name: string
): Promise<DriveFile> {
  return (
    (await findFolder(client, userEmail, parentId, name)) ??
    client.createFolder(userEmail, { name, parentId })
  )
}

async function existingFile(
  client: ContractTemplateDriveClient,
  userEmail: string,
  fileId: string | null,
  folderId: string,
  fileName: string
): Promise<DriveFile | null> {
  if (fileId) {
    try {
      const file = await client.getFile(userEmail, fileId)
      if (file.parents?.includes(folderId)) return file
    } catch {
      // A deleted or moved Drive copy is recreated below.
    }
  }
  const result = await client.listFiles(userEmail, {
    folderId,
    query: `name = '${queryValue(fileName)}'`,
    pageSize: 10,
    orderBy: "createdTime",
  })
  return result.files[0] ?? null
}

export function contractTemplateDriveFileName(input: {
  readonly code: string
  readonly name: string
  readonly versionNumber: number
}): string {
  return `${safeFilePart(input.code)} - ${safeFilePart(input.name)} - v${input.versionNumber}.md`
}

export async function syncContractTemplateVersionToDrive(input: {
  readonly client: ContractTemplateDriveClient
  readonly userEmail: string
  readonly currentFileId: string | null
  readonly code: string
  readonly name: string
  readonly versionNumber: number
  readonly contentMarkdown: string
}): Promise<{ readonly fileId: string; readonly fileUrl: string }> {
  const templateLibrary = await ensureFolder(
    input.client,
    input.userEmail,
    COMPASS_DEVELOPER_FOLDER_ID,
    ESTIMATE_TEMPLATE_LIBRARY_FOLDER_NAME
  )
  const contractLibrary = await ensureFolder(
    input.client,
    input.userEmail,
    templateLibrary.id,
    CONTRACT_LIBRARY_FOLDER_NAME
  )
  const fileName = contractTemplateDriveFileName(input)
  const current = await existingFile(
    input.client,
    input.userEmail,
    input.currentFileId,
    contractLibrary.id,
    fileName
  )
  const data = new Blob([input.contentMarkdown], { type: MARKDOWN_MIME_TYPE })
  const saved = current
    ? await (async (): Promise<DriveFile> => {
        if (current.name !== fileName) {
          await input.client.renameFile(input.userEmail, current.id, fileName)
        }
        return input.client.updateFileContent(
          input.userEmail,
          current.id,
          data,
          MARKDOWN_MIME_TYPE
        )
      })()
    : await input.client.uploadFile(input.userEmail, {
        name: fileName,
        parentId: contractLibrary.id,
        mimeType: MARKDOWN_MIME_TYPE,
        data,
        appProperties: { compassContentType: "contractTemplateVersion" },
      })
  return {
    fileId: saved.id,
    fileUrl:
      saved.webViewLink ?? `https://drive.google.com/file/d/${saved.id}/view`,
  }
}
