import "server-only"

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm"

import { customerContacts, customers, vendorContacts, vendors } from "@/db/schema"
import { sageClientDirectoryEntries, sageDirectoryAddRequests, sageVendorDirectoryEntries } from "@/db/schema-sage"
import type { Vendor1099Status } from "@/lib/domain/contacts/statuses"
import type { SageDirectoryAddKind, SageDirectoryAddStatus } from "@/lib/domain/sage-bridge/statuses"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { isCompanyKind, type DirectoryCandidate } from "@/lib/sage/directory-add-duplicates"
import {
  OPEN_SAGE_ADD_STATUSES,
  defaultSageVendorType,
  personKindParent,
  type SageCompanyAddFields,
  type SagePersonAddFields,
} from "@/lib/sage/directory-add-request"
import type { Db } from "@/lib/server/action-context"

/*
 * Reads for "Request add to Sage": the record being requested (with what
 * Compass already knows about it) and every company or person it could
 * duplicate, in Compass and in Sage's own vendor and client lists.
 */

type OpenSageAddRequest = { readonly id: string; readonly status: SageDirectoryAddStatus }

type TargetBase = {
  readonly entityId: string
  readonly name: string
  readonly inSage: boolean
  readonly openRequest: OpenSageAddRequest | null
}

type SageAddCompanyTarget = TargetBase & {
  readonly kind: "vendor_company" | "client_company"
  readonly fields: SageCompanyAddFields
  /** Vendors: category, 1099 and Sage's vendor types to choose from. */
  readonly vendor: {
    readonly category: string
    readonly form1099: Vendor1099Status
    readonly vendorTypes: readonly string[]
    readonly defaultVendorType: string | null
  } | null
  /** Clients: the company line Sage keeps beside the name. */
  readonly clientCompany: string | null
  readonly clientStatusId: number | null
}

type SageAddPersonTarget = TargetBase & {
  readonly kind: "vendor_person" | "client_person"
  readonly fields: SagePersonAddFields
  readonly parent: {
    readonly kind: "vendor_company" | "client_company"
    readonly id: string
    readonly name: string
    /** Sage's stable id is known, so a person can be added under it. */
    readonly inSage: boolean
    readonly openRequest: OpenSageAddRequest | null
  }
}

export type SageAddTarget = SageAddCompanyTarget | SageAddPersonTarget

async function openSageAddRequest(
  db: Db,
  organizationId: string,
  kind: SageDirectoryAddKind,
  entityId: string
): Promise<OpenSageAddRequest | null> {
  const row = await db.select({ id: sageDirectoryAddRequests.id, status: sageDirectoryAddRequests.status })
    .from(sageDirectoryAddRequests)
    .where(and(
      eq(sageDirectoryAddRequests.organizationId, organizationId),
      eq(sageDirectoryAddRequests.kind, kind),
      eq(sageDirectoryAddRequests.entityId, entityId),
      inArray(sageDirectoryAddRequests.status, [...OPEN_SAGE_ADD_STATUSES]),
    ))
    .get()
  return row ?? null
}

async function sageVendorTypes(db: Db, organizationId: string): Promise<readonly string[]> {
  const rows = await db.selectDistinct({ type: sageVendorDirectoryEntries.vendorType })
    .from(sageVendorDirectoryEntries)
    .where(and(eq(sageVendorDirectoryEntries.organizationId, organizationId), isNotNull(sageVendorDirectoryEntries.vendorType)))
  return rows.flatMap((row) => (row.type?.trim() ? [row.type.trim()] : [])).sort((a, b) => a.localeCompare(b))
}

const blankToNull = (value: string | null | undefined): string | null => value?.trim() || null

/** The record as Compass knows it, or null when it is not in this company. */
export async function loadSageAddTarget(
  db: Db,
  organizationId: string,
  kind: SageDirectoryAddKind,
  entityId: string
): Promise<SageAddTarget | null> {
  const openRequest = await openSageAddRequest(db, organizationId, kind, entityId)
  if (kind === "vendor_company") {
    const vendor = await db.select().from(vendors).where(and(
      eq(vendors.id, entityId), eq(vendors.organizationId, organizationId), eq(vendors.directoryStatus, "active"),
    )).get()
    if (!vendor) return null
    const [types, tradeDocs] = await Promise.all([sageVendorTypes(db, organizationId), readFeatureSettings(db, organizationId, "trade-docs")])
    return {
      kind, entityId, name: vendor.name, openRequest,
      inSage: Boolean(vendor.sageVendorId || vendor.sageVendorNumber),
      fields: {
        name: vendor.name,
        addressLine1: blankToNull(vendor.addressLine1) ?? blankToNull(vendor.address),
        addressLine2: blankToNull(vendor.addressLine2),
        city: blankToNull(vendor.city), state: blankToNull(vendor.state), postalCode: blankToNull(vendor.postalCode),
        phone: blankToNull(vendor.phone), email: blankToNull(vendor.primaryEmail) ?? blankToNull(vendor.email),
      },
      vendor: {
        category: vendor.category, form1099: vendor.form1099Status, vendorTypes: types,
        defaultVendorType: defaultSageVendorType(vendor.category, tradeDocs.sage.vendorTypes, types),
      },
      clientCompany: null, clientStatusId: null,
    }
  }
  if (kind === "client_company") {
    const customer = await db.select().from(customers).where(and(
      eq(customers.id, entityId), eq(customers.organizationId, organizationId), isNull(customers.mergedIntoCustomerId),
    )).get()
    if (!customer) return null
    return {
      kind, entityId, name: customer.name, openRequest,
      inSage: Boolean(customer.sageClientId || customer.sageClientNumber),
      fields: {
        name: customer.name,
        addressLine1: blankToNull(customer.addressLine1) ?? blankToNull(customer.address),
        addressLine2: blankToNull(customer.addressLine2),
        city: blankToNull(customer.city), state: blankToNull(customer.state), postalCode: blankToNull(customer.postalCode),
        phone: blankToNull(customer.phone), email: blankToNull(customer.primaryEmail) ?? blankToNull(customer.email),
      },
      vendor: null, clientCompany: blankToNull(customer.company), clientStatusId: customer.sageClientStatusId,
    }
  }
  const parentKind = personKindParent(kind)
  const person = kind === "vendor_person"
    ? await db.select({
      name: vendorContacts.name, title: vendorContacts.title, email: vendorContacts.email, phone: vendorContacts.phone,
      cellPhone: vendorContacts.cellPhone, sageContactId: vendorContacts.sageContactId,
      parentId: vendors.id, parentName: vendors.name, parentSageId: vendors.sageVendorId,
    }).from(vendorContacts).innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId)).where(and(
      eq(vendorContacts.id, entityId), eq(vendorContacts.active, true), eq(vendors.organizationId, organizationId), eq(vendors.directoryStatus, "active"),
    )).get()
    : await db.select({
      name: customerContacts.name, title: customerContacts.title, email: customerContacts.email, phone: customerContacts.phone,
      cellPhone: customerContacts.cellPhone, sageContactId: customerContacts.sageContactId,
      parentId: customers.id, parentName: customers.name, parentSageId: customers.sageClientId,
    }).from(customerContacts).innerJoin(customers, eq(customers.id, customerContacts.customerId)).where(and(
      eq(customerContacts.id, entityId), eq(customerContacts.active, true), eq(customers.organizationId, organizationId),
    )).get()
  if (!person) return null
  return {
    kind, entityId, name: person.name, openRequest, inSage: Boolean(person.sageContactId),
    fields: {
      name: person.name, title: blankToNull(person.title), phone: blankToNull(person.phone),
      cellPhone: blankToNull(person.cellPhone), email: blankToNull(person.email),
    },
    parent: {
      kind: parentKind, id: person.parentId, name: person.parentName, inSage: Boolean(person.parentSageId?.trim()),
      openRequest: await openSageAddRequest(db, organizationId, parentKind, person.parentId),
    },
  }
}

/** Every company (or every person) the requested record could duplicate. */
export async function loadDirectoryCandidates(
  db: Db,
  organizationId: string,
  kind: SageDirectoryAddKind
): Promise<readonly DirectoryCandidate[]> {
  if (isCompanyKind(kind)) {
    const [vendorRows, customerRows, sageVendors, sageClients] = await Promise.all([
      db.select({ id: vendors.id, name: vendors.name, email: vendors.email, primaryEmail: vendors.primaryEmail, phone: vendors.phone, sageNumber: vendors.sageVendorNumber })
        .from(vendors).where(and(eq(vendors.organizationId, organizationId), eq(vendors.directoryStatus, "active"))),
      db.select({ id: customers.id, name: customers.name, company: customers.company, email: customers.email, phone: customers.phone, sageNumber: customers.sageClientNumber })
        .from(customers).where(and(eq(customers.organizationId, organizationId), isNull(customers.mergedIntoCustomerId))),
      db.select({ id: sageVendorDirectoryEntries.sageRecordId, name: sageVendorDirectoryEntries.name, email: sageVendorDirectoryEntries.email, phone: sageVendorDirectoryEntries.phone, sageNumber: sageVendorDirectoryEntries.sageVendorNumber })
        .from(sageVendorDirectoryEntries).where(eq(sageVendorDirectoryEntries.organizationId, organizationId)),
      db.select({ id: sageClientDirectoryEntries.sageRecordId, name: sageClientDirectoryEntries.name, email: sageClientDirectoryEntries.email, sageNumber: sageClientDirectoryEntries.sageClientNumber })
        .from(sageClientDirectoryEntries).where(eq(sageClientDirectoryEntries.organizationId, organizationId)),
    ])
    const company = { parentId: null, parentName: null }
    return [
      ...vendorRows.map((row): DirectoryCandidate => ({
        ...company, id: row.id, source: "compass", kind: "vendor_company", name: row.name,
        email: row.primaryEmail ?? row.email, phone: row.phone, sageNumber: row.sageNumber,
      })),
      ...customerRows.flatMap((row): DirectoryCandidate[] => {
        const base = { ...company, id: row.id, source: "compass" as const, kind: "client_company" as const, email: row.email, phone: row.phone, sageNumber: row.sageNumber }
        // A client is often a person's name with their company beside it; both are names to match.
        const names = [row.name, ...(row.company && row.company !== row.name ? [row.company] : [])]
        return names.map((name) => ({ ...base, name }))
      }),
      ...sageVendors.map((row): DirectoryCandidate => ({
        ...company, id: row.id, source: "sage", kind: "vendor_company", name: row.name, email: row.email, phone: row.phone, sageNumber: row.sageNumber,
      })),
      ...sageClients.map((row): DirectoryCandidate => ({
        ...company, id: row.id, source: "sage", kind: "client_company", name: row.name, email: row.email, phone: null, sageNumber: row.sageNumber,
      })),
    ]
  }
  const [vendorPeople, customerPeople] = await Promise.all([
    db.select({ id: vendorContacts.id, name: vendorContacts.name, email: vendorContacts.email, phone: vendorContacts.phone, sageLine: vendorContacts.sageLineNumber, parentId: vendors.id, parentName: vendors.name })
      .from(vendorContacts).innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
      .where(and(eq(vendors.organizationId, organizationId), eq(vendorContacts.active, true), eq(vendors.directoryStatus, "active"))),
    db.select({ id: customerContacts.id, name: customerContacts.name, email: customerContacts.email, phone: customerContacts.phone, sageLine: customerContacts.sageLineNumber, parentId: customers.id, parentName: customers.name })
      .from(customerContacts).innerJoin(customers, eq(customers.id, customerContacts.customerId))
      .where(and(eq(customers.organizationId, organizationId), eq(customerContacts.active, true))),
  ])
  return [
    ...vendorPeople.map((row): DirectoryCandidate => ({
      id: row.id, source: "compass", kind: "vendor_person", name: row.name, email: row.email, phone: row.phone,
      parentId: row.parentId, parentName: row.parentName, sageNumber: row.sageLine === null ? null : String(row.sageLine),
    })),
    ...customerPeople.map((row): DirectoryCandidate => ({
      id: row.id, source: "compass", kind: "client_person", name: row.name, email: row.email, phone: row.phone,
      parentId: row.parentId, parentName: row.parentName, sageNumber: row.sageLine === null ? null : String(row.sageLine),
    })),
  ]
}
