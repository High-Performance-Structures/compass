export type ProjectMergeCategoryId =
  | "documents"
  | "activity"
  | "planning"
  | "financial"
  | "access"
  | "other"

export type ProjectMergeCategory = {
  readonly id: ProjectMergeCategoryId
  readonly label: string
  readonly recordCount: number
}

export type ProjectMergeImpact = {
  readonly totalRecordCount: number
  readonly categories: readonly ProjectMergeCategory[]
}

export type ProjectMergeSchemaRow = {
  readonly name: string
  readonly sql: string | null
}

export type ProjectMergeTableCount = {
  readonly tableName: string
  readonly recordCount: number
}

const PROJECT_MERGE_CATEGORY_ORDER: readonly ProjectMergeCategoryId[] = [
  "documents",
  "activity",
  "planning",
  "financial",
  "access",
  "other",
]

const PROJECT_MERGE_CATEGORY_LABELS: Readonly<
  Record<ProjectMergeCategoryId, string>
> = {
  documents: "Documents and media",
  activity: "Activity and communication",
  planning: "Schedule and project records",
  financial: "Estimates and financial records",
  access: "Contacts and access",
  other: "Other linked records",
}

const PROJECT_MERGE_CUSTOM_TABLES: ReadonlySet<string> = new Set([
  "project_external_links",
  "project_members",
  "projects",
])

const SAFE_SQLITE_TABLE_NAME = /^[a-z][a-z0-9_]*$/
const EXACT_PROJECT_ID_COLUMN =
  /(?:[`"[]project_id[`"\]]|\bproject_id\b\s+(?:text|integer|real|blob|numeric))/i

function tableNameIncludes(tableName: string, fragments: readonly string[]): boolean {
  return fragments.some((fragment) => tableName.includes(fragment))
}

export function projectMergeCategoryForTable(
  tableName: string,
): ProjectMergeCategoryId {
  if (
    tableNameIncludes(tableName, [
      "document",
      "attachment",
      "archive_file",
      "staging_file",
      "photo",
      "video",
    ])
  ) {
    return "documents"
  }
  if (
    tableNameIncludes(tableName, [
      "activity",
      "daily_log",
      "correspondence",
      "interaction",
      "note",
      "follow_up",
      "channel",
      "inbound_email",
      "notification_event",
    ])
  ) {
    return "activity"
  }
  if (
    tableNameIncludes(tableName, [
      "schedule",
      "calendar",
      "selection",
      "rfi",
      "change_order",
      "warranty",
      "template_application",
    ])
  ) {
    return "planning"
  }
  if (
    tableNameIncludes(tableName, [
      "estimate",
      "budget",
      "contract",
      "invoice",
      "payment",
      "bill",
      "purchase_order",
      "sage_",
      "nutech_order",
    ])
  ) {
    return "financial"
  }
  if (
    tableNameIncludes(tableName, [
      "contact",
      "access",
      "participant",
      "role_assignment",
    ])
  ) {
    return "access"
  }
  return "other"
}

export function projectMergeDependencyTableNames(
  schemaRows: readonly ProjectMergeSchemaRow[],
): readonly string[] {
  return schemaRows
    .filter(
      (row) =>
        SAFE_SQLITE_TABLE_NAME.test(row.name) &&
        !PROJECT_MERGE_CUSTOM_TABLES.has(row.name) &&
        row.sql !== null &&
        EXACT_PROJECT_ID_COLUMN.test(row.sql),
    )
    .map((row) => row.name)
    .sort((first, second) => first.localeCompare(second))
}

export function projectDeletionDependencyTableNames(schemaRows: readonly ProjectMergeSchemaRow[]): readonly string[] {
  return schemaRows.filter((row) => SAFE_SQLITE_TABLE_NAME.test(row.name) && row.name !== "projects" && row.sql !== null && EXACT_PROJECT_ID_COLUMN.test(row.sql)).map((row) => row.name).sort((first, second) => first.localeCompare(second))
}

export function summarizeProjectMergeImpact(
  tableCounts: readonly ProjectMergeTableCount[],
): ProjectMergeImpact {
  const countsByCategory = new Map<ProjectMergeCategoryId, number>()
  let totalRecordCount = 0

  for (const tableCount of tableCounts) {
    if (tableCount.recordCount <= 0) continue
    const category = projectMergeCategoryForTable(tableCount.tableName)
    countsByCategory.set(
      category,
      (countsByCategory.get(category) ?? 0) + tableCount.recordCount,
    )
    totalRecordCount += tableCount.recordCount
  }

  return {
    totalRecordCount,
    categories: PROJECT_MERGE_CATEGORY_ORDER.flatMap((id) => {
      const recordCount = countsByCategory.get(id) ?? 0
      return recordCount > 0
        ? [{ id, label: PROJECT_MERGE_CATEGORY_LABELS[id], recordCount }]
        : []
    }),
  }
}
