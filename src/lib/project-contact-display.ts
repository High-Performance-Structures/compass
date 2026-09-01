import type {
  ProjectContactDirectoryOption,
  ProjectContactItem,
  ProjectContactType,
} from "@/app/actions/project-contacts"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ProjectContactDisplayGroupId = "owners" | "vendors" | "internal"

export type ProjectContactDisplayGroup = {
  readonly id: ProjectContactDisplayGroupId
  readonly label: string
  readonly contacts: readonly ProjectContactItem[]
}

export function canViewHistoricalProjectContacts(
  role: string | null | undefined
): boolean {
  return role !== null && role !== undefined && isInternalStaffRole(role)
}

export function projectContactCanEdit(
  contact: Pick<ProjectContactItem, "active">,
  directoryOptions: readonly ProjectContactDirectoryOption[] | undefined
): boolean {
  return contact.active && directoryOptions !== undefined
}

export function buildProjectContactDisplayGroups(
  contacts: readonly ProjectContactItem[]
): readonly ProjectContactDisplayGroup[] {
  const byType = (contactType: ProjectContactType): readonly ProjectContactItem[] =>
    contacts.filter((contact) => contact.contactType === contactType)

  return [
    { id: "owners", label: "Owners", contacts: byType("owner") },
    {
      id: "vendors",
      label: "Vendors",
      contacts: contacts.filter(
        (contact) =>
          contact.contactType === "supplier" ||
          contact.contactType === "subcontractor"
      ),
    },
    { id: "internal", label: "Internal", contacts: byType("internal") },
  ]
}
