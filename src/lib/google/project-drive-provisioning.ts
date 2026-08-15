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
}

export type ProjectDriveProvisioningInput = {
  readonly department: ProjectIntakeDepartment
  readonly folderName: string
}

export type ProjectDriveProvisioningResult = {
  readonly folderId: string
  readonly folderName: string
  readonly folderUrl: string
  readonly parentFolderId: string
  readonly childFolderNames: readonly string[]
  readonly createdRoot: boolean
  readonly createdChildCount: number
}

const DEPARTMENT_CHILD_FOLDERS: Readonly<
  Record<ProjectIntakeDepartment, readonly string[]>
> = {
  O: [
    "00_CustomerInfo",
    "01_ActiveContractDocuments",
    "02_WorkingEstimate",
    "03_PayRequests",
    "04_PermittedPlansSpecifications",
    "05_SelectionsFinishes",
    "06_Communications",
    "07_ConstructionLog",
    "08_Inspections",
    "09_Financing",
    "10_Preconstruction",
    "11_ConstructionSchedule",
    "11_ChangeOrders",
    "12_Purchasing",
    "Pictures",
    "Owner Uploads",
    "Sub-Supplier Uploads",
    "99_Archive",
  ],
  H: [
    "00_Contracts",
    "01_Takeoffs",
    "02_Estimates",
    "03_BidDocs",
    "04_PermittedPlans",
    "05_PropertyInfo",
    "06_PayRequests",
    "07_Inspections-Tests",
    "08_Submittals",
    "Correspondence",
    "Photos",
    "Owner Uploads",
    "Sub-Supplier Uploads",
    "Schedules",
  ],
  D: [
    "00_Contracts",
    "01_ProgramDocs",
    "02_Schematics",
    "03_DesignDevelopment",
    "04_ConstructionDocs",
    "05_PermitSet",
    "06_Engineering",
    "Correspondence",
    "Photos",
    "Owner Uploads",
    "Sub-Supplier Uploads",
    "99_Archive",
  ],
  N: [
    "00_OrderDocs",
    "01_Quotes",
    "02_Invoices",
    "03_DeliveryDocs",
    "Photos",
    "Owner Uploads",
    "Sub-Supplier Uploads",
  ],
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

export function projectDriveChildFolders(
  department: ProjectIntakeDepartment
): readonly string[] {
  return DEPARTMENT_CHILD_FOLDERS[department]
}

export async function provisionProjectDriveFolder(
  client: ProjectDriveClient,
  userEmail: string,
  input: ProjectDriveProvisioningInput
): Promise<ProjectDriveProvisioningResult> {
  const source = sourceForDepartment(input.department)
  const folderName = cleanFolderPart(input.folderName)
  if (!folderName) throw new Error("Project folder name is required.")

  const existingRoot = await findFolder(
    client,
    userEmail,
    source.folderId,
    folderName
  )
  const root =
    existingRoot ??
    (await client.createFolder(userEmail, {
      name: folderName,
      parentId: source.folderId,
    }))
  const verifiedRoot = await client.getFile(userEmail, root.id)
  verifyFolder(verifiedRoot, folderName, source.folderId)

  const childFolderNames = projectDriveChildFolders(input.department)
  const existingChildren = await client.listFiles(userEmail, {
    folderId: verifiedRoot.id,
    query: `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}'`,
    pageSize: 200,
  })
  const existingNames = new Set(existingChildren.files.map((folder) => folder.name))
  const missingNames = childFolderNames.filter((name) => !existingNames.has(name))
  await Promise.all(
    missingNames.map((name) =>
      client.createFolder(userEmail, { name, parentId: verifiedRoot.id })
    )
  )

  // Read the project folder again after writes so Compass only records a link
  // once every required child landed in the intended parent.
  const verifiedChildren = await client.listFiles(userEmail, {
    folderId: verifiedRoot.id,
    query: `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}'`,
    pageSize: 200,
  })
  const verifiedNames = new Set(verifiedChildren.files.map((folder) => folder.name))
  const missingAfterWrite = childFolderNames.filter(
    (name) => !verifiedNames.has(name)
  )
  if (missingAfterWrite.length > 0) {
    throw new Error(
      `Google Drive did not confirm ${missingAfterWrite.join(", ")}.`
    )
  }

  return {
    folderId: verifiedRoot.id,
    folderName,
    folderUrl: `https://drive.google.com/drive/folders/${verifiedRoot.id}`,
    parentFolderId: source.folderId,
    childFolderNames,
    createdRoot: existingRoot === null,
    createdChildCount: missingNames.length,
  }
}
