import type { FileItem } from "@/lib/files-data"

export type ProjectFileSourceKey = "orc" | "hps" | "design" | "nutech"

export type ProjectFileCategoryKey =
  | "customer-info"
  | "contracts"
  | "estimate"
  | "pay-requests"
  | "plans"
  | "selections"
  | "communications"
  | "construction-log"
  | "inspections"
  | "financing"
  | "preconstruction"
  | "schedule"
  | "change-orders"
  | "purchasing"
  | "submittals"
  | "photos"
  | "buildertrend-archive"
  | "archive"
  | "backup"
  | "unknown"

export type ProjectFileSource = {
  readonly key: ProjectFileSourceKey
  readonly label: string
  readonly folderName: string
  readonly folderId: string
  readonly projectPrefix: "O" | "H" | "D" | "N"
}

export type ProjectFolderMatch = {
  readonly source: ProjectFileSource
  readonly projectNumber: string
}

export type ProjectFileCategory = {
  readonly key: ProjectFileCategoryKey
  readonly label: string
  readonly currentNames: readonly string[]
  readonly legacyNames: readonly string[]
  readonly hiddenByDefault?: boolean
}

export const PROJECT_FILE_SOURCES: readonly ProjectFileSource[] = [
  {
    key: "orc",
    label: "ORC Projects",
    folderName: "____ORC Projects",
    folderId: "0Bzi_pskoDROqd3RCemxpT3Flanc",
    projectPrefix: "O",
  },
  {
    key: "hps",
    label: "HPS Projects",
    folderName: "____HPS_PROJECTS",
    folderId: "0Bzi_pskoDROqcEZZRHhIQ01RMmc",
    projectPrefix: "H",
  },
  {
    key: "design",
    label: "Design Projects",
    folderName: "____DESIGN PROJECTS",
    folderId: "1ji7-riK0uK6oeUmkKNAQTrtZ5hrFUvuH",
    projectPrefix: "D",
  },
  {
    key: "nutech",
    label: "Nu-Tech Orders",
    folderName: "____NUTECH_ORDERS",
    folderId: "0B5VqKL3gQWhVMlRxZnZlNnAtTWM",
    projectPrefix: "N",
  },
] as const

export const PROJECT_FILE_CATEGORIES: readonly ProjectFileCategory[] = [
  {
    key: "customer-info",
    label: "Customer Info",
    currentNames: ["00_CustomerInfo"],
    legacyNames: ["05_PropertyInfo"],
  },
  {
    key: "contracts",
    label: "Contracts",
    currentNames: ["01_ActiveContractDocuments"],
    legacyNames: ["00_Contracts", "00_OrderDocs"],
  },
  {
    key: "estimate",
    label: "Estimate",
    currentNames: ["02_WorkingEstimate"],
    legacyNames: ["01_Takeoffs", "02_Estimates", "01_Quotes"],
  },
  {
    key: "pay-requests",
    label: "Pay Requests",
    currentNames: ["03_PayRequests"],
    legacyNames: ["06_PayRequests", "02_Invoices"],
  },
  {
    key: "plans",
    label: "Plans and Specifications",
    currentNames: ["04_PermittedPlansSpecifications"],
    legacyNames: [
      "03_BidDocs",
      "04_PermittedPlans",
      "04_ConstructionDocs",
      "05_PermitSet",
    ],
  },
  {
    key: "selections",
    label: "Selections and Finishes",
    currentNames: ["05_SelectionsFinishes"],
    legacyNames: ["03_SpecsFinishes"],
  },
  {
    key: "communications",
    label: "Communications",
    currentNames: ["06_Communications"],
    legacyNames: ["Correspondence", "Meeting Notes"],
  },
  {
    key: "construction-log",
    label: "Construction Log",
    currentNames: ["07_ConstructionLog"],
    legacyNames: [],
  },
  {
    key: "inspections",
    label: "Inspections and Tests",
    currentNames: ["08_Inspections"],
    legacyNames: ["07_Inspections-Tests"],
  },
  {
    key: "financing",
    label: "Financing",
    currentNames: ["09_Financing"],
    legacyNames: [],
    hiddenByDefault: true,
  },
  {
    key: "preconstruction",
    label: "Preconstruction",
    currentNames: ["10_Preconstruction"],
    legacyNames: [
      "01_ProgramDocs",
      "02_Schematics",
      "03_DesignDevelopment",
      "06_Engineering",
    ],
  },
  {
    key: "schedule",
    label: "Schedule",
    currentNames: ["11_ConstructionSchedule"],
    legacyNames: ["Schedules"],
  },
  {
    key: "change-orders",
    label: "Change Orders",
    currentNames: ["11_ChangeOrders"],
    legacyNames: [],
  },
  {
    key: "purchasing",
    label: "Purchasing",
    currentNames: ["12_Purchasing"],
    legacyNames: ["03_DeliveryDocs"],
  },
  {
    key: "submittals",
    label: "Submittals",
    currentNames: [],
    legacyNames: ["08_Submittals"],
  },
  {
    key: "photos",
    label: "Photos",
    currentNames: ["Pictures", "Photos"],
    legacyNames: ["Photos"],
  },
  {
    key: "buildertrend-archive",
    label: "Buildertrend Archive",
    currentNames: ["Buildertrend Archive"],
    legacyNames: [],
    hiddenByDefault: true,
  },
  {
    key: "archive",
    label: "Archive",
    currentNames: ["99_Archive", "__Archive", "Archive"],
    legacyNames: [],
    hiddenByDefault: true,
  },
  {
    key: "backup",
    label: "Backup",
    currentNames: [
      "_BACKUP_Pre-Restructure_2026-04-04",
      "OldDirectory Structure-Backup",
      "_OLDMASTER FOLDER_DO_NOT_USE",
    ],
    legacyNames: ["_MASTER FOLDER", "OLD - Master List-Do Not Use"],
    hiddenByDefault: true,
  },
] as const

const PROJECT_NUMBER_PATTERN = /^([OHDN])-\d{1,4}(?:-\d{2,5})?/i

function normalizeFolderName(name: string): string {
  return name.trim().toLowerCase()
}

export function getProjectFileSourceById(
  folderId: string
): ProjectFileSource | null {
  return (
    PROJECT_FILE_SOURCES.find(source => source.folderId === folderId) ??
    null
  )
}

export function getProjectFileSourceByKey(
  key: ProjectFileSourceKey
): ProjectFileSource | null {
  return (
    PROJECT_FILE_SOURCES.find(source => source.key === key) ?? null
  )
}

export function getProjectFolderMatch(
  name: string
): ProjectFolderMatch | null {
  const match = name.match(PROJECT_NUMBER_PATTERN)
  if (!match) return null

  const prefix = match[1].toUpperCase()
  const source =
    PROJECT_FILE_SOURCES.find(
      item => item.projectPrefix === prefix
    ) ?? null
  if (!source) return null

  return {
    source,
    projectNumber: match[0],
  }
}

export function isProjectFolderName(name: string): boolean {
  return getProjectFolderMatch(name) !== null
}

export function classifyProjectFolderName(
  name: string
): ProjectFileCategory | null {
  const normalized = normalizeFolderName(name)

  return (
    PROJECT_FILE_CATEGORIES.find(category =>
      [...category.currentNames, ...category.legacyNames].some(
        knownName => normalizeFolderName(knownName) === normalized
      )
    ) ?? null
  )
}

export function isHiddenProjectFolderName(name: string): boolean {
  return classifyProjectFolderName(name)?.hiddenByDefault === true
}

export function withProjectFileSource(
  file: FileItem,
  source: ProjectFileSource
): FileItem {
  return {
    ...file,
    name: source.label,
    projectFile: {
      kind: "source",
      sourceKey: source.key,
      sourceLabel: source.label,
    },
  }
}

export function withProjectFolderMetadata(
  file: FileItem,
  match: ProjectFolderMatch
): FileItem {
  return {
    ...file,
    projectFile: {
      kind: "project",
      sourceKey: match.source.key,
      sourceLabel: match.source.label,
      projectNumber: match.projectNumber,
    },
  }
}

export function withProjectCategoryMetadata(
  file: FileItem
): FileItem {
  const category = classifyProjectFolderName(file.name)
  if (!category) return file

  const isLegacy = category.legacyNames.some(
    name => normalizeFolderName(name) === normalizeFolderName(file.name)
  )

  return {
    ...file,
    projectFile: {
      kind: "category",
      categoryKey: category.key,
      categoryLabel: category.label,
      structureVersion: isLegacy ? "legacy" : "current",
      hiddenByDefault: category.hiddenByDefault === true,
    },
  }
}
