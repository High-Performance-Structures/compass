import type { DriveFile, DriveFileList, ListFilesOptions } from "@/lib/google/client/types"
import type { EstimateTextTemplateType } from "@/lib/estimates/client-report"
import type { ProjectDepartment } from "@/lib/project-branding"

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
const TEMPLATE_FILE_MIME_TYPE = "text/plain"

// This is the existing ________Developer/Compass folder. The child library is
// created lazily so the authoritative path remains visible to Drive users.
export const COMPASS_DEVELOPER_FOLDER_ID = "13_p_VESOdyETLrD3cZ8XWrAK1Yo-LAyG"
export const ESTIMATE_TEMPLATE_LIBRARY_FOLDER_NAME = "Template Library"

type EstimateTemplateDriveClient = {
  readonly listFiles: (
    userEmail: string,
    options?: ListFilesOptions
  ) => Promise<DriveFileList>
  readonly getFile: (userEmail: string, fileId: string) => Promise<DriveFile>
  readonly createFolder: (
    userEmail: string,
    options: {
      readonly name: string
      readonly parentId?: string
      readonly driveId?: string
    }
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

export type EstimateTextTemplateDriveResult = {
  readonly fileId: string
  readonly fileName: string
  readonly fileUrl: string
  readonly folderId: string
  readonly folderUrl: string
}

function driveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function safeFilePart(value: string): string {
  const cleaned = value
    .replace(/[/:\\]/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "Untitled"
}

function departmentLabel(departmentCode: ProjectDepartment | null): string {
  return departmentCode ?? "All Departments"
}

function templateTypeLabel(templateType: EstimateTextTemplateType): string {
  switch (templateType) {
    case "introduction":
      return "Introduction"
    case "closing":
      return "Closing"
    case "acknowledgement":
      return "Acknowledgement"
    default:
      return "Terms"
  }
}

export function estimateTextTemplateDriveFileName(input: {
  readonly name: string
  readonly departmentCode: ProjectDepartment | null
  readonly templateType: EstimateTextTemplateType
}): string {
  return [
    departmentLabel(input.departmentCode),
    templateTypeLabel(input.templateType),
    safeFilePart(input.name),
  ].join(" - ") + ".txt"
}

async function findLibraryFolder(
  client: EstimateTemplateDriveClient,
  userEmail: string
): Promise<DriveFile | null> {
  const result = await client.listFiles(userEmail, {
    folderId: COMPASS_DEVELOPER_FOLDER_ID,
    query:
      `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and ` +
      `name = '${driveQueryValue(ESTIMATE_TEMPLATE_LIBRARY_FOLDER_NAME)}'`,
    pageSize: 10,
    orderBy: "createdTime",
  })
  return result.files[0] ?? null
}

async function ensureLibraryFolder(
  client: EstimateTemplateDriveClient,
  userEmail: string
): Promise<DriveFile> {
  const existing = await findLibraryFolder(client, userEmail)
  if (existing) return existing
  return client.createFolder(userEmail, {
    name: ESTIMATE_TEMPLATE_LIBRARY_FOLDER_NAME,
    parentId: COMPASS_DEVELOPER_FOLDER_ID,
  })
}

async function fileInsideLibrary(
  client: EstimateTemplateDriveClient,
  userEmail: string,
  fileId: string | null,
  folderId: string
): Promise<DriveFile | null> {
  if (!fileId) return null
  try {
    const file = await client.getFile(userEmail, fileId)
    return file.parents?.includes(folderId) ? file : null
  } catch {
    return null
  }
}

async function findFileByName(
  client: EstimateTemplateDriveClient,
  userEmail: string,
  folderId: string,
  fileName: string
): Promise<DriveFile | null> {
  const result = await client.listFiles(userEmail, {
    folderId,
    query: `name = '${driveQueryValue(fileName)}'`,
    pageSize: 10,
    orderBy: "createdTime",
  })
  return result.files[0] ?? null
}

export async function syncEstimateTextTemplateToDrive(input: {
  readonly client: EstimateTemplateDriveClient
  readonly userEmail: string
  readonly currentFileId: string | null
  readonly name: string
  readonly departmentCode: ProjectDepartment | null
  readonly templateType: EstimateTextTemplateType
  readonly body: string
}): Promise<EstimateTextTemplateDriveResult> {
  const folder = await ensureLibraryFolder(input.client, input.userEmail)
  const fileName = estimateTextTemplateDriveFileName(input)
  const current = await fileInsideLibrary(
    input.client,
    input.userEmail,
    input.currentFileId,
    folder.id
  )
  const existing =
    current ??
    (await findFileByName(
      input.client,
      input.userEmail,
      folder.id,
      fileName
    ))
  const data = new Blob([input.body], { type: TEMPLATE_FILE_MIME_TYPE })
  let saved: DriveFile

  if (existing) {
    if (existing.name !== fileName) {
      await input.client.renameFile(input.userEmail, existing.id, fileName)
    }
    saved = await input.client.updateFileContent(
      input.userEmail,
      existing.id,
      data,
      TEMPLATE_FILE_MIME_TYPE
    )
  } else {
    saved = await input.client.uploadFile(input.userEmail, {
      name: fileName,
      parentId: folder.id,
      mimeType: TEMPLATE_FILE_MIME_TYPE,
      data,
      appProperties: {
        compassContentType: "estimateTextTemplate",
      },
    })
  }

  return {
    fileId: saved.id,
    fileName,
    fileUrl:
      saved.webViewLink ??
      `https://drive.google.com/file/d/${saved.id}/view`,
    folderId: folder.id,
    folderUrl: `https://drive.google.com/drive/folders/${folder.id}`,
  }
}
