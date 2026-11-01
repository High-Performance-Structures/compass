import type { VendorDirectoryPage } from "@/app/actions/contact-directory"
import type { getContactDirectoryAccess } from "@/app/actions/contact-directory-access"
import type { InternalDirectoryContact } from "@/app/actions/vendors"
import type { CustomerDirectoryRow, DirectorySummary } from "@/lib/domain/contacts/directory-page"
import type { RecordPage } from "@/lib/record-page"

export type ContactsTab = "customers" | "vendors" | "internal"

type DirectoryCapabilities = Awaited<ReturnType<typeof getContactDirectoryAccess>>

export type AssociationProjectOption = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
}

/** What the Contacts page reads on the server before it renders. */
export type ContactsBootstrap = {
  readonly loadFailed: boolean
  readonly access: DirectoryCapabilities | null
  readonly summary: DirectorySummary
  readonly associationProjects: readonly AssociationProjectOption[]
  /** First page of each company list, so switching tabs needs no wait. */
  readonly vendors: VendorDirectoryPage | null
  readonly customers: RecordPage<CustomerDirectoryRow> | null
  readonly internal: readonly InternalDirectoryContact[]
}

export function toContactsTab(value: string | null | undefined): ContactsTab {
  if (value === "vendors") return "vendors"
  if (value === "internal") return "internal"
  return "customers"
}
