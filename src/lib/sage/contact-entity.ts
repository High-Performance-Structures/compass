import "server-only"

import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import {
  customerContacts,
  customers,
  internalContacts,
  vendorContacts,
  vendors,
} from "@/db/schema"
import type { SageContactKind } from "@/lib/sage/contact-change-proposal"

export type SageContactEntityIdentity = {
  readonly sageRecordId: string | null
  readonly sageRecordNumber: string | null
  readonly parentSageRecordId: string | null
  readonly linkedUserId: string | null
}

export async function getSageContactEntityIdentity(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  kind: SageContactKind,
  entityId: string
): Promise<SageContactEntityIdentity | null> {
  if (kind === "client_company") {
    const row = await db.select({
      sageRecordId: customers.sageClientId,
      sageRecordNumber: customers.sageClientNumber,
    }).from(customers).where(and(
      eq(customers.organizationId, organizationId), eq(customers.id, entityId)
    )).get()
    return row ? { ...row, parentSageRecordId: null, linkedUserId: null } : null
  }
  if (kind === "client_person") {
    const row = await db.select({
      sageRecordId: customerContacts.sageContactId,
      sageRecordNumber: customerContacts.sageLineNumber,
      parentSageRecordId: customers.sageClientId,
      linkedUserId: customerContacts.userId,
    }).from(customerContacts).innerJoin(customers, eq(customerContacts.customerId, customers.id))
      .where(and(eq(customers.organizationId, organizationId), eq(customerContacts.id, entityId))).get()
    return row ? {
      sageRecordId: row.sageRecordId,
      sageRecordNumber: row.sageRecordNumber === null ? null : String(row.sageRecordNumber),
      parentSageRecordId: row.parentSageRecordId,
      linkedUserId: row.linkedUserId,
    } : null
  }
  if (kind === "vendor_company") {
    const row = await db.select({
      sageRecordId: vendors.sageVendorId,
      sageRecordNumber: vendors.sageVendorNumber,
    }).from(vendors).where(and(
      eq(vendors.organizationId, organizationId), eq(vendors.id, entityId)
    )).get()
    return row ? { ...row, parentSageRecordId: null, linkedUserId: null } : null
  }
  if (kind === "vendor_person") {
    const row = await db.select({
      sageRecordId: vendorContacts.sageContactId,
      sageRecordNumber: vendorContacts.sageLineNumber,
      parentSageRecordId: vendors.sageVendorId,
      linkedUserId: vendorContacts.userId,
    }).from(vendorContacts).innerJoin(vendors, eq(vendorContacts.vendorId, vendors.id))
      .where(and(eq(vendors.organizationId, organizationId), eq(vendorContacts.id, entityId))).get()
    return row ? {
      sageRecordId: row.sageRecordId,
      sageRecordNumber: row.sageRecordNumber === null ? null : String(row.sageRecordNumber),
      parentSageRecordId: row.parentSageRecordId,
      linkedUserId: row.linkedUserId,
    } : null
  }
  const row = await db.select({
    sageRecordId: internalContacts.sageEmployeeId,
    sageRecordNumber: internalContacts.sageEmployeeNumber,
    linkedUserId: internalContacts.userId,
  }).from(internalContacts).where(and(
    eq(internalContacts.organizationId, organizationId), eq(internalContacts.id, entityId)
  )).get()
  return row ? { ...row, parentSageRecordId: null } : null
}
