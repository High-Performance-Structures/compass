"use server"

import { and, eq, isNull } from "drizzle-orm"

import { getDb } from "@/db"
import {
  customerContacts,
  customers,
  internalContacts,
  organizationMembers,
  users,
  vendorContacts,
  vendors,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  buildGreetingCardRecipientOption,
  type GreetingCardRecipientOption,
} from "@/lib/greeting-cards/recipient-directory"
import { requireOrg } from "@/lib/org-scope"
import {
  canPrepareGreetingCards,
} from "@/lib/permissions"
import { canFeature } from "@/lib/permission-enforcement"
import { isInternalStaffRole } from "@/lib/user-roles"

export type { GreetingCardRecipientOption } from "@/lib/greeting-cards/recipient-directory"

type RecipientResult =
  | {
      readonly success: true
      readonly data: readonly GreetingCardRecipientOption[]
    }
  | { readonly success: false; readonly error: string }

export async function getGreetingCardRecipientOptions(): Promise<RecipientResult> {
  try {
    const user = await requireAuth()
    if (!canPrepareGreetingCards(user) && !(await canFeature(user, "greeting-card-approval", "read"))) {
      return {
        success: false,
        error: "Employee greeting-card access is required.",
      }
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return {
        success: false,
        error: "Compass storage is not available right now.",
      }
    }
    const db = getDb(env.DB)

    // The same people as the Contacts directory: clients and their people,
    // trade partners and their people, and employees.
    const [customerRows, vendorRows, vendorContactRows, teamRows, clientPeopleRows, employeeContactRows] =
      await Promise.all([
        db
          .select({
            id: customers.id,
            name: customers.name,
            company: customers.company,
            email: customers.email,
            address: customers.address,
          })
          .from(customers)
          .where(and(eq(customers.organizationId, organizationId), isNull(customers.mergedIntoCustomerId))),
        db
          .select({
            id: vendors.id,
            name: vendors.name,
            category: vendors.category,
            email: vendors.email,
            address: vendors.address,
          })
          .from(vendors)
          .where(
            and(
              eq(vendors.organizationId, organizationId),
              eq(vendors.directoryStatus, "active"),
            ),
          ),
        db
          .select({
            id: vendorContacts.id,
            name: vendorContacts.name,
            email: vendorContacts.email,
            vendorName: vendors.name,
            vendorCategory: vendors.category,
            vendorAddress: vendors.address,
          })
          .from(vendorContacts)
          .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
          .where(
            and(
              eq(vendors.organizationId, organizationId),
              eq(vendors.directoryStatus, "active"),
              eq(vendorContacts.active, true),
            ),
          ),
        db
          .select({
            id: users.id,
            displayName: users.displayName,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            role: organizationMembers.role,
          })
          .from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(users.isActive, true),
            ),
          ),
        db
          .select({
            id: customerContacts.id,
            name: customerContacts.name,
            email: customerContacts.email,
            customerName: customers.name,
            customerCompany: customers.company,
            customerAddress: customers.address,
          })
          .from(customerContacts)
          .innerJoin(customers, eq(customers.id, customerContacts.customerId))
          .where(
            and(
              eq(customers.organizationId, organizationId),
              isNull(customers.mergedIntoCustomerId),
              eq(customerContacts.active, true),
              isNull(customerContacts.mergedIntoPersonId),
            ),
          ),
        db
          .select({
            id: internalContacts.id,
            userId: internalContacts.userId,
            name: internalContacts.name,
            email: internalContacts.email,
          })
          .from(internalContacts)
          .where(
            and(
              eq(internalContacts.organizationId, organizationId),
              eq(internalContacts.active, true),
            ),
          ),
      ])

    const options: GreetingCardRecipientOption[] = []
    for (const row of customerRows) {
      options.push(
        buildGreetingCardRecipientOption({
          id: row.id,
          sourceType: "customer",
          displayName: row.name,
          companyName: row.company,
          email: row.email,
          address: row.address,
          recipientType: "client",
          personName: true,
        }),
      )
    }
    for (const row of vendorRows) {
      if (row.category.toLowerCase().includes("internal")) continue
      options.push(
        buildGreetingCardRecipientOption({
          id: row.id,
          sourceType: "vendor",
          displayName: row.name,
          companyName: row.name,
          email: row.email,
          address: row.address,
          recipientType: vendorRecipientType(row.category),
          personName: false,
        }),
      )
    }
    for (const row of vendorContactRows) {
      if (row.vendorCategory.toLowerCase().includes("internal")) continue
      options.push(
        buildGreetingCardRecipientOption({
          id: row.id,
          sourceType: "vendor_contact",
          displayName: row.name,
          companyName: row.vendorName,
          email: row.email,
          address: row.vendorAddress,
          recipientType: vendorRecipientType(row.vendorCategory),
          personName: true,
        }),
      )
    }
    for (const row of clientPeopleRows) {
      options.push(
        buildGreetingCardRecipientOption({
          id: row.id,
          sourceType: "customer_contact",
          displayName: row.name,
          companyName: row.customerCompany ?? row.customerName,
          email: row.email,
          address: row.customerAddress,
          recipientType: "client",
          personName: true,
        }),
      )
    }
    // Employees with a Compass login come from their account; the directory
    // adds employees without one. Logins that aren't staff stay off the list.
    const memberIds = new Set(teamRows.map((row) => row.id))
    for (const row of employeeContactRows) {
      if (row.userId && memberIds.has(row.userId)) continue
      options.push(
        buildGreetingCardRecipientOption({
          id: row.id,
          sourceType: "team",
          displayName: row.name,
          companyName: null,
          email: row.email,
          // Residential addresses require a private permissioned workflow.
          address: null,
          recipientType: "employee",
          personName: true,
        }),
      )
    }
    for (const row of teamRows) {
      if (!isInternalStaffRole(row.role)) continue
      const fullName = [row.firstName, row.lastName]
        .filter((part): part is string => Boolean(part?.trim()))
        .join(" ")
      options.push(
        buildGreetingCardRecipientOption({
          id: row.id,
          sourceType: "team",
          displayName: row.displayName?.trim() || fullName || row.email,
          companyName: null,
          email: row.email,
          // Residential addresses require a private permissioned workflow.
          address: null,
          recipientType: "employee",
          personName: true,
          firstName: row.firstName,
          lastName: row.lastName,
        }),
      )
    }

    return {
      success: true,
      data: options.sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      ),
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to load saved greeting-card recipients.",
    }
  }
}

function vendorRecipientType(category: string): "subcontractor" | "supplier" {
  return category.toLowerCase().includes("subcontractor")
    ? "subcontractor"
    : "supplier"
}
