import { Suspense } from "react"

import {
  getContactDirectorySummary,
  getCustomerDirectoryPage,
  getVendorDirectoryPage,
} from "@/app/actions/contact-directory"
import { getContactDirectoryAccess } from "@/app/actions/contact-directory-access"
import { getCompanyAssociationProjects } from "@/app/actions/contact-project-associations"
import { getInternalDirectoryContacts } from "@/app/actions/vendors"
import { getUnassignedPeople } from "@/app/actions/unassigned-people"
import { getImportedParticipantReviewPage } from "@/app/actions/imported-participant-review"
import { ContactsPageClient, ContactsSkeleton } from "@/components/contacts/contacts-page"
import type { ContactsBootstrap } from "@/components/contacts/contacts-bootstrap"
import { DEFAULT_RECORD_PAGE_QUERY } from "@/lib/record-page"
import { listSheetFirstPageQuery } from "@/lib/domain/settings/list-sheets"

const EMPTY_SUMMARY = { customerCount: 0, vendorCount: 0, internalCount: 0, vendorCategories: [] }

/**
 * Everything the first view needs, read once on the server: access, tab
 * counts, and the first page of each list. Later pages, searches and sorts
 * are read one page at a time.
 */
async function loadContacts(): Promise<ContactsBootstrap> {
  try {
    // Each first page is read in its sheet's opening sort (Settings > Lists).
    const [access, vendorQuery, customerQuery, reviewQuery] = await Promise.all([
      getContactDirectoryAccess(),
      listSheetFirstPageQuery("vendors"),
      listSheetFirstPageQuery("customers"),
      listSheetFirstPageQuery("contacts.review"),
    ])
    const [summary, associationProjects, vendors, customers, internal, unassigned, participantReview] = await Promise.all([
      getContactDirectorySummary(),
      getCompanyAssociationProjects(),
      access.vendors.read ? getVendorDirectoryPage(vendorQuery, null) : null,
      access.customers.read ? getCustomerDirectoryPage(customerQuery) : null,
      access.internal.read ? getInternalDirectoryContacts() : [],
      access.vendors.read ? getUnassignedPeople() : [],
      // Staff only: the action refuses everyone else, and the tab is hidden.
      getImportedParticipantReviewPage(reviewQuery),
    ])
    return {
      loadFailed: !summary.success || vendors?.success === false || customers?.success === false,
      access,
      summary: summary.success ? summary.data : EMPTY_SUMMARY,
      associationProjects,
      vendors: vendors?.success ? vendors.data : null,
      customers: customers?.success ? customers.data : null,
      internal,
      unassigned,
      participantReview: participantReview.success ? participantReview.data : null,
      firstPageQueries: { vendors: vendorQuery, customers: customerQuery, participantReview: reviewQuery },
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
      unassigned: [],
      participantReview: null,
      firstPageQueries: { vendors: DEFAULT_RECORD_PAGE_QUERY, customers: DEFAULT_RECORD_PAGE_QUERY, participantReview: DEFAULT_RECORD_PAGE_QUERY },
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
