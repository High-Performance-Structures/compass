import { Suspense } from "react"

import {
  getContactDirectorySummary,
  getCustomerDirectoryPage,
  getVendorDirectoryPage,
} from "@/app/actions/contact-directory"
import { getContactDirectoryAccess } from "@/app/actions/contact-directory-access"
import { getCompanyAssociationProjects } from "@/app/actions/contact-project-associations"
import { getInternalDirectoryContacts } from "@/app/actions/vendors"
import { ContactsPageClient, ContactsSkeleton } from "@/components/contacts/contacts-page"
import type { ContactsBootstrap } from "@/components/contacts/contacts-bootstrap"
import { DEFAULT_RECORD_PAGE_QUERY } from "@/lib/record-page"

const EMPTY_SUMMARY = { customerCount: 0, vendorCount: 0, internalCount: 0, vendorCategories: [] }

/**
 * Everything the first view needs, read once on the server: access, tab
 * counts, and the first page of each list. Later pages, searches and sorts
 * are read one page at a time.
 */
async function loadContacts(): Promise<ContactsBootstrap> {
  try {
    const access = await getContactDirectoryAccess()
    const [summary, associationProjects, vendors, customers, internal] = await Promise.all([
      getContactDirectorySummary(),
      getCompanyAssociationProjects(),
      access.vendors.read ? getVendorDirectoryPage(DEFAULT_RECORD_PAGE_QUERY, null) : null,
      access.customers.read ? getCustomerDirectoryPage(DEFAULT_RECORD_PAGE_QUERY) : null,
      access.internal.read ? getInternalDirectoryContacts() : [],
    ])
    return {
      loadFailed: !summary.success || vendors?.success === false || customers?.success === false,
      access,
      summary: summary.success ? summary.data : EMPTY_SUMMARY,
      associationProjects,
      vendors: vendors?.success ? vendors.data : null,
      customers: customers?.success ? customers.data : null,
      internal,
    }
  } catch {
    return {
      loadFailed: true,
      access: null,
      summary: EMPTY_SUMMARY,
      associationProjects: [],
      vendors: null,
      customers: null,
      internal: [],
    }
  }
}

async function ContactsContent() {
  return <ContactsPageClient bootstrap={await loadContacts()} />
}

export default function ContactsPage() {
  return (
    <Suspense fallback={<ContactsSkeleton />}>
      <ContactsContent />
    </Suspense>
  )
}
