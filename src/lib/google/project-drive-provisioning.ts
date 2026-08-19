import type {
  DriveFile,
  DriveFileList,
  ListFilesOptions,
} from "@/lib/google/client/types"
import {
  PROJECT_FILE_SOURCES,
  type ProjectFileSource,
} from "@/lib/project-files"
import type { ProjectIntakeDepartment } from "./project-intake-tracker"

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

type ProjectDriveClient = {
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
  readonly copyFile: (
    userEmail: string,
    fileId: string,
    options: {
      readonly name: string
      readonly parentId: string
    }
  ) => Promise<DriveFile>
}

export type ProjectDriveProvisioningInput = {
  readonly department: ProjectIntakeDepartment
  readonly folderName: string
  readonly existingFolderId?: string
}

export type ProjectDriveProvisioningResult = {
  readonly folderId: string
  readonly folderName: string
  readonly folderUrl: string
  readonly parentFolderId: string
  readonly childFolderNames: readonly string[]
  readonly createdRoot: boolean
  readonly createdChildCount: number
  readonly copiedFileCount: number
}

// These stable Drive IDs point to the department templates under
// ________Developer/00-Directories. The live templates are the source of truth;
// folder names and template files must not be duplicated in application code.
const DEPARTMENT_TEMPLATE_FOLDER_IDS: Readonly<
  Record<ProjectIntakeDepartment, string>
> = {
  O: "1MKrmHWS0gjhRDzcLmv4quz-NvqCJEei9",
  H: "11sUheLU_sXpr6uS7v_MaswmdRtMNSokH",
  D: "1-0QvQBQrF52ytwUltkt9qBAzAtxdFAQT",
  N: "1S0A0AtLKNLp-sLvIwqRLaK2BoyLvmKdm",
}

type TemplateCopyCounts = {
  readonly createdFolderCount: number
  readonly copiedFileCount: number
}

function cleanFolderPart(value: string | null): string | null {
  const cleaned = value?.replace(/[/:\\]/g, "-").replace(/\s+/g, " ").trim() ?? ""
  return cleaned.length > 0 ? cleaned : null
}

function driveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function sourceForDepartment(
  department: ProjectIntakeDepartment
): ProjectFileSource {
  const source = PROJECT_FILE_SOURCES.find(
    (candidate) => candidate.projectPrefix === department
  )
  if (!source) {
    throw new Error(`No Google Drive project root is configured for ${department}.`)
  }
  return source
}

function folderQuery(name: string): string {
  return (
    `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and ` +
    `name = '${driveQueryValue(name)}'`
  )
}

async function findFolder(
  client: ProjectDriveClient,
  userEmail: string,
  parentId: string,
  name: string
): Promise<DriveFile | null> {
  const result = await client.listFiles(userEmail, {
    folderId: parentId,
    query: folderQuery(name),
    pageSize: 10,
    orderBy: "createdTime",
  })
  return result.files[0] ?? null
}

function verifyFolder(
  folder: DriveFile,
  expectedName: string,
  expectedParentId: string
): void {
  if (folder.mimeType !== GOOGLE_FOLDER_MIME_TYPE) {
    throw new Error(`Google created ${expectedName}, but it is not a folder.`)
  }
  if (folder.name !== expectedName) {
    throw new Error(`Google returned the wrong folder for ${expectedName}.`)
  }
  if (!folder.parents?.includes(expectedParentId)) {
    throw new Error(`Google created ${expectedName} outside the expected project location.`)
  }
}

export function buildProjectDriveFolderName(input: {
  readonly projectNumber: string
  readonly projectName: string
  readonly streetNumber: string | null
  readonly streetName: string | null
}): string {
  const projectNumber = cleanFolderPart(input.projectNumber)
  const projectName = cleanFolderPart(input.projectName)
  if (!projectNumber || !projectName) {
    throw new Error("Project number and name are required for Drive provisioning.")
  }
  const address = [
    cleanFolderPart(input.streetNumber),
    cleanFolderPart(input.streetName),
  ]
    .filter((value) => value !== null)
    .join(" ")
  return [projectNumber, address || null, projectName]
    .filter((value) => value !== null)
    .join(" - ")
}

export function projectDriveTemplateFolderId(
  department: ProjectIntakeDepartment
): string {
  return DEPARTMENT_TEMPLATE_FOLDER_IDS[department]
}

async function listAllChildren(
  client: ProjectDriveClient,
  userEmail: string,
  folderId: string
): Promise<readonly DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken: string | undefined

  do {
    const page = await client.listFiles(userEmail, {
      folderId,
      pageSize: 200,
      pageToken,
      orderBy: "folder,name",
    })
    files.push(...page.files)
    pageToken = page.nextPageToken
  } while (pageToken)

  return files
}

function templateItemKey(file: DriveFile): string {
  return `${file.mimeType}\u0000${file.name}`
}

async function copyTemplateContents(
  client: ProjectDriveClient,
  userEmail: string,
  templateFolderId: string,
  destinationFolderId: string
): Promise<TemplateCopyCounts> {
  const [templateItems, destinationItems] = await Promise.all([
    listAllChildren(client, userEmail, templateFolderId),
    listAllChildren(client, userEmail, destinationFolderId),
  ])
  const destinationByKey = new Map(
    destinationItems.map((item) => [templateItemKey(item), item])
  )
  let createdFolderCount = 0
  let copiedFileCount = 0

  for (const templateItem of templateItems) {
    const key = templateItemKey(templateItem)
    const existing = destinationByKey.get(key) ?? null

    if (templateItem.mimeType === GOOGLE_FOLDER_MIME_TYPE) {
      const destinationFolder =
        existing ??
        (await client.createFolder(userEmail, {
          name: templateItem.name,
          parentId: destinationFolderId,
        }))
      if (!existing) {
        destinationByKey.set(key, destinationFolder)
        createdFolderCount += 1
      }
      const nested = await copyTemplateContents(
        client,
        userEmail,
        templateItem.id,
        destinationFolder.id
      )
      createdFolderCount += nested.createdFolderCount
      copiedFileCount += nested.copiedFileCount
      continue
    }

    if (!existing) {
      const copied = await client.copyFile(userEmail, templateItem.id, {
        name: templateItem.name,
        parentId: destinationFolderId,
      })
      destinationByKey.set(key, copied)
      copiedFileCount += 1
    }
  }

  return { createdFolderCount, copiedFileCount }
}

export async function provisionProjectDriveFolder(
  client: ProjectDriveClient,
  userEmail: string,
  input: ProjectDriveProvisioningInput
): Promise<ProjectDriveProvisioningResult> {
  const source = sourceForDepartment(input.department)
  const folderName = cleanFolderPart(input.folderName)
  if (!folderName) throw new Error("Project folder name is required.")

  const existingRoot = input.existingFolderId
    ? await client.getFile(userEmail, input.existingFolderId)
    : await findFolder(client, userEmail, source.folderId, folderName)
  const root =
    existingRoot ??
    (await client.createFolder(userEmail, {
      name: folderName,
      parentId: source.folderId,
    }))
  const verifiedRoot = await client.getFile(userEmail, root.id)
  verifyFolder(
    verifiedRoot,
    input.existingFolderId ? verifiedRoot.name : folderName,
    source.folderId
  )

  const templateFolderId = projectDriveTemplateFolderId(input.department)
  const template = await client.getFile(userEmail, templateFolderId)
  if (template.mimeType !== GOOGLE_FOLDER_MIME_TYPE) {
    throw new Error("The configured Developer project template is not a folder.")
  }
  const copied = await copyTemplateContents(
    client,
    userEmail,
    templateFolderId,
    verifiedRoot.id
  )
  const childFolderNames = (await listAllChildren(
    client,
    userEmail,
    templateFolderId
  ))
    .filter((item) => item.mimeType === GOOGLE_FOLDER_MIME_TYPE)
    .map((item) => item.name)

  return {
    folderId: verifiedRoot.id,
    folderName: verifiedRoot.name,
    folderUrl: `https://drive.google.com/drive/folders/${verifiedRoot.id}`,
    parentFolderId: source.folderId,
    childFolderNames,
    createdRoot: existingRoot === null,
    createdChildCount: copied.createdFolderCount,
    copiedFileCount: copied.copiedFileCount,
  }
}
