"use server"

import { and, asc, desc, eq } from "drizzle-orm"
import { z } from "zod/v4"

import { vendorContacts, vendors } from "@/db/schema"
import { actionFailure, type ActionResult } from "@/lib/action-result"
import {
  CUSTOMER_SORT_IDS,
  listCustomerDirectoryPage,
  listVendorDirectoryPage,
  loadDirectorySummary,
  searchCompanyMergeCandidates,
  VENDOR_SORT_IDS,
  type CompanyMergeCandidate,
  type CustomerDirectoryRow,
  type DirectorySummary,
  type VendorDirectoryCompany,
  type VendorDirectoryRow,
} from "@/lib/domain/contacts/directory-page"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { canFeature } from "@/lib/permission-enforcement"
import { parseRecordPageQuery, type RecordPage } from "@/lib/record-page"
import { orgContext } from "@/lib/server/action-context"
import { tradeDocStatusesForVendors, type VendorTradeDocStatus } from "@/lib/trade-docs/directory-status"
import { isInternalStaffRole } from "@/lib/user-roles"

/**
 * The Contacts directory reads one page at a time: the server searches
 * (company and people), sorts and pages, and returns only the visible rows.
 */

export type VendorDirectoryPage = RecordPage<VendorDirectoryRow> & {
  /** Trade doc standing for the rows on this page; null when the viewer is not office staff. */
  readonly tradeDocStatuses: Readonly<Record<string, VendorTradeDocStatus>> | null
}

const categoryInput = z.string().trim().max(100).nullable().catch(null)

export async function getVendorDirectoryPage(
  query: unknown,
  category: string | null,
): Promise<ActionResult<VendorDirectoryPage>> {
  try {
    const context = await orgContext({ feature: "vendors" })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    const showTradeDocs = isInternalStaffRole(user.role)
    const [page, settings] = await Promise.all([
      listVendorDirectoryPage(db, organizationId, parseRecordPageQuery(query, VENDOR_SORT_IDS), categoryInput.parse(category) || null),
      showTradeDocs ? readFeatureSettings(db, organizationId, "trade-docs") : Promise.resolve(null),
    ])
    const tradeDocStatuses = settings
      ? await tradeDocStatusesForVendors({
          db,
          organizationId,
          docTypes: settings.docTypes,
          vendors: page.rows,
          today: new Date().toISOString().slice(0, 10),
        })
      : null
    return { success: true, data: { ...page, tradeDocStatuses } }
  } catch {
    return actionFailure("Could not load vendors.")
  }
}

export async function getCustomerDirectoryPage(query: unknown): Promise<ActionResult<RecordPage<CustomerDirectoryRow>>> {
  try {
    const context = await orgContext({ feature: "customers" })
    if (!context.success) return context
    const { db, organizationId } = context.data
    return { success: true, data: await listCustomerDirectoryPage(db, organizationId, parseRecordPageQuery(query, CUSTOMER_SORT_IDS)) }
  } catch {
    return actionFailure("Could not load clients and leads.")
  }
}

/** One vendor with its active people, read when its dialog opens. */
export async function getVendorDirectoryCompany(vendorId: string): Promise<ActionResult<VendorDirectoryCompany>> {
  try {
    const context = await orgContext({ feature: "vendors" })
    if (!context.success) return context
    const { db, organizationId } = context.data
    const id = z.string().min(1).max(200).parse(vendorId)
    const [vendorRows, people] = await db.batch([
      db.select().from(vendors).where(and(eq(vendors.id, id), eq(vendors.organizationId, organizationId))).limit(1),
      db.select({
        id: vendorContacts.id,
        vendorId: vendorContacts.vendorId,
        name: vendorContacts.name,
        title: vendorContacts.title,
        email: vendorContacts.email,
        phone: vendorContacts.phone,
        isPrimary: vendorContacts.isPrimary,
        active: vendorContacts.active,
        sourceSystem: vendorContacts.sourceSystem,
        userId: vendorContacts.userId,
        sageContactId: vendorContacts.sageContactId,
        sageLineNumber: vendorContacts.sageLineNumber,
      })
        .from(vendorContacts)
        .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
        .where(and(eq(vendorContacts.vendorId, id), eq(vendors.organizationId, organizationId), eq(vendorContacts.active, true)))
        .orderBy(desc(vendorContacts.isPrimary), asc(vendorContacts.name)),
    ])
    const vendor = vendorRows[0]
    if (!vendor) return actionFailure("Vendor not found.")
    return { success: true, data: { ...vendor, contacts: people } }
  } catch {
    return actionFailure("Could not load the vendor.")
  }
}

const mergeSearchInput = z.object({
  kind: z.enum(["vendor", "customer"]),
  search: z.string().trim().max(100),
  excludeId: z.string().min(1).max(200),
})

/** Companies to merge into or from, found by name, people, email or phone. */
export async function findCompanyMergeCandidates(
  raw: z.input<typeof mergeSearchInput>,
): Promise<ActionResult<readonly CompanyMergeCandidate[]>> {
  try {
    const input = mergeSearchInput.parse(raw)
    const context = await orgContext({ feature: input.kind === "vendor" ? "vendors" : "customers" })
    if (!context.success) return context
    const { db, organizationId } = context.data
    return { success: true, data: await searchCompanyMergeCandidates(db, organizationId, input) }
  } catch {
    return actionFailure("Could not search records.")
  }
}

/** Tab counts and vendor categories, refreshed after a create, delete or merge. */
export async function getContactDirectorySummary(): Promise<ActionResult<DirectorySummary>> {
  try {
    const context = await orgContext()
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    const [customers, vendorsGrant, internal] = await Promise.all([
      canFeature(user, "customers", "read"),
      canFeature(user, "vendors", "read"),
      canFeature(user, "internal-directory", "read"),
    ])
    return {
      success: true,
      data: await loadDirectorySummary(db, organizationId, { customers, vendors: vendorsGrant, internal }),
    }
  } catch {
    return actionFailure("Could not load contact counts.")
  }
}
