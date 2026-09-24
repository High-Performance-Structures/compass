"use server"

import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { customerContacts, customers, internalContacts, vendorContacts, vendors } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import type { SageContactKind } from "@/lib/sage/contact-change-proposal"
import { isInternalStaffRole } from "@/lib/user-roles"

export type MyContactRecord = {
  readonly kind: SageContactKind
  readonly entityId: string
  readonly name: string
  readonly companyName: string | null
  readonly sageLinked: boolean
}

/** Only explicit person-to-login foreign keys qualify for self-service. */
export async function getMyContactRecords(): Promise<readonly MyContactRecord[]> {
  const user = await requireAuth()
  if (!user.isActive) return []
  const orgId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const [clients, vendorsList, employees] = await Promise.all([
    db.select({
      id: customerContacts.id, name: customerContacts.name,
      companyName: customers.name, sageContactId: customerContacts.sageContactId,
      sageLineNumber: customerContacts.sageLineNumber,
    }).from(customerContacts).innerJoin(customers, eq(customers.id, customerContacts.customerId))
      .where(and(eq(customerContacts.userId, user.id), eq(customers.organizationId, orgId), eq(customerContacts.active, true))),
    db.select({
      id: vendorContacts.id, name: vendorContacts.name,
      companyName: vendors.name, sageContactId: vendorContacts.sageContactId,
      sageLineNumber: vendorContacts.sageLineNumber,
    }).from(vendorContacts).innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
      .where(and(eq(vendorContacts.userId, user.id), eq(vendors.organizationId, orgId),
        eq(vendors.directoryStatus, "active"), eq(vendorContacts.active, true))),
    db.select({
      id: internalContacts.id, name: internalContacts.name,
      sageEmployeeId: internalContacts.sageEmployeeId,
      sageEmployeeNumber: internalContacts.sageEmployeeNumber,
    }).from(internalContacts).where(and(
      eq(internalContacts.userId, user.id), eq(internalContacts.organizationId, orgId),
      eq(internalContacts.active, true)
    )),
  ])
  return [
    ...(user.role === "client" ? clients : []).map((record): MyContactRecord => ({
      kind: "client_person", entityId: record.id, name: record.name,
      companyName: record.companyName, sageLinked: Boolean(record.sageContactId),
    })),
    ...(["supplier", "subcontractor"].includes(user.role) ? vendorsList : []).map((record): MyContactRecord => ({
      kind: "vendor_person", entityId: record.id, name: record.name,
      companyName: record.companyName, sageLinked: Boolean(record.sageContactId),
    })),
    ...(isInternalStaffRole(user.role) ? employees : []).map((record): MyContactRecord => ({
      kind: "employee", entityId: record.id, name: record.name,
      companyName: null, sageLinked: Boolean(record.sageEmployeeId),
    })),
  ]
}
