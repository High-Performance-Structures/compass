export type ProjectDocumentCategory =
  | "architectural_plans"
  | "structural_plans"
  | "mechanical_plans"
  | "electrical_plans"
  | "plumbing_plans"
  | "civil_plans"
  | "specifications"
  | "addendum"
  | "approved_sketch"
  | "geotechnical"
  | "other"

export type ProjectDocumentStatus =
  | "draft"
  | "current"
  | "superseded"
  | "archived"

export type ProjectDocumentCategoryOption = {
  readonly value: ProjectDocumentCategory
  readonly label: string
}

export const PROJECT_DOCUMENT_CATEGORIES: readonly ProjectDocumentCategoryOption[] = [
  { value: "architectural_plans", label: "Architectural plans" },
  { value: "structural_plans", label: "Structural plans" },
  { value: "mechanical_plans", label: "Mechanical plans" },
  { value: "electrical_plans", label: "Electrical plans" },
  { value: "plumbing_plans", label: "Plumbing plans" },
  { value: "civil_plans", label: "Civil plans" },
  { value: "specifications", label: "Specifications" },
  { value: "addendum", label: "Addendum" },
  { value: "approved_sketch", label: "Approved sketch" },
  { value: "geotechnical", label: "Geotechnical" },
  { value: "other", label: "Other construction document" },
]

export function isProjectDocumentCategory(
  value: string
): value is ProjectDocumentCategory {
  return PROJECT_DOCUMENT_CATEGORIES.some((option) => option.value === value)
}

export function projectDocumentCategoryLabel(value: string): string {
  return (
    PROJECT_DOCUMENT_CATEGORIES.find((option) => option.value === value)?.label ??
    "Construction document"
  )
}

export function isProjectDocumentStatus(
  value: string
): value is ProjectDocumentStatus {
  return ["draft", "current", "superseded", "archived"].includes(value)
}

export function driveFileIdFromValue(value: string): string | null {
  const cleaned = value.trim()
  if (!cleaned) return null

  const fileMatch = cleaned.match(/\/d\/([^/?#]+)/)
  if (fileMatch?.[1]) return fileMatch[1]
  const folderMatch = cleaned.match(/\/folders\/([^/?#]+)/)
  if (folderMatch?.[1]) return folderMatch[1]
  const queryMatch = cleaned.match(/[?&]id=([^&#]+)/)
  if (queryMatch?.[1]) return queryMatch[1]
  return /^[a-zA-Z0-9_-]+$/.test(cleaned) ? cleaned : null
}

export function isPublishedProjectDocumentStatus(status: string): boolean {
  return status === "current" || status === "superseded"
}
