/**
 * Pure rules for access requests (architecture standard, section 1): what a
 * request must say, which companies can be asked, who decides, and which
 * role an approval gives. No database or network access, so the request
 * form, the server and the tests share them.
 */
import { z } from "zod/v4"

import { USER_ROLE_OPTIONS, canManageUserAccessRole } from "@/lib/user-roles"
import type { UserRole } from "@/lib/domain/identity/statuses"

import { ACCESS_REQUEST_KINDS, type AccessRequestKind } from "./statuses"

/** "I am a …" choices, in the order the form lists them. */
export const ACCESS_REQUEST_KIND_LABELS: { readonly [K in AccessRequestKind]: string } = {
  client: "Client",
  vendor: "Trade partner or vendor",
  employee: "Employee",
}

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((value) => (value.length > 0 ? value : null))

/** What the person fills in. Their email comes from their signed-in account. */
export const accessRequestInputSchema = z
  .object({
    organizationId: z.string().trim().min(1, "Choose a company."),
    kind: z.enum(ACCESS_REQUEST_KINDS, { message: "Choose who you are." }),
    companyName: optionalText(160),
    phone: z.string().trim().min(7, "Enter a phone number.").max(40),
    jobReference: optionalText(200),
    note: optionalText(1000),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "vendor" && !value.companyName) {
      ctx.addIssue({ code: "custom", path: ["companyName"], message: "Enter your company name." })
    }
    if (value.kind !== "employee" && !value.jobReference) {
      ctx.addIssue({ code: "custom", path: ["jobReference"], message: "Enter the job name or address." })
    }
  })

export type AccessRequestInput = z.input<typeof accessRequestInputSchema>

/**
 * A company appears on the Request access page only when it is an active
 * staff company (never someone's personal workspace or the demo company)
 * and its admins turned on "Allow access requests".
 */
export function isRequestableOrganization(org: {
  readonly type: string
  readonly isActive: boolean
  readonly allowRequests: boolean
}): boolean {
  return org.type === "internal" && org.isActive && org.allowRequests
}

/** The people who manage accounts and invitations decide access requests. */
export function canDecideAccessRequests(role: string | null | undefined): boolean {
  return canManageUserAccessRole(role)
}

/** Vendor roles an approval can give. */
export const ACCESS_REQUEST_VENDOR_ROLES = ["subcontractor", "supplier"] as const
export type AccessRequestVendorRole = (typeof ACCESS_REQUEST_VENDOR_ROLES)[number]

/**
 * Staff roles an employee request can be approved with. Administrator and
 * developer roles are never granted from a request; give those in People.
 */
export const ACCESS_REQUEST_STAFF_ROLES: readonly UserRole[] = USER_ROLE_OPTIONS
  .filter((option) => option.group === "Internal Staff")
  .map((option) => option.value)

function isAccessRequestStaffRole(role: string): role is UserRole {
  return ACCESS_REQUEST_STAFF_ROLES.some((value) => value === role)
}

/** What the admin chose when approving. */
export const approveAccessRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("client"), requestId: z.string().trim().min(1), customerContactId: z.string().trim().min(1, "Link the request to a client contact.") }),
  z.object({
    kind: z.literal("vendor"),
    requestId: z.string().trim().min(1),
    vendorContactId: z.string().trim().min(1, "Link the request to a vendor contact."),
    role: z.enum(ACCESS_REQUEST_VENDOR_ROLES),
  }),
  z.object({
    kind: z.literal("employee"),
    requestId: z.string().trim().min(1),
    role: z.string().refine(isAccessRequestStaffRole, "Choose a staff role."),
  }),
])

export type ApproveAccessRequestInput = z.input<typeof approveAccessRequestSchema>

/** The company role an approval gives: clients join as "client". */
export function approvedOrganizationRole(choice: z.output<typeof approveAccessRequestSchema>): UserRole {
  if (choice.kind === "client") return "client"
  if (choice.kind === "vendor") return choice.role
  return isAccessRequestStaffRole(choice.role) ? choice.role : "office"
}

/** A job contact's portal role, as the project invitation uses it. */
export function projectRoleForContactType(contactType: string): "owner" | "subcontractor" | "supplier" | null {
  if (contactType === "owner") return "owner"
  if (contactType === "subcontractor") return "subcontractor"
  if (contactType === "supplier") return "supplier"
  return null
}
