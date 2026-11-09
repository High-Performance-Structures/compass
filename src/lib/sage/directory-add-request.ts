import { z } from "zod/v4"

import { VENDOR_1099_STATUSES, type Vendor1099Status } from "@/lib/domain/contacts/statuses"
import {
  SAGE_DIRECTORY_ADD_KINDS,
  type SageDirectoryAddKind,
  type SageDirectoryAddStatus,
} from "@/lib/domain/sage-bridge/statuses"
import { sageShortName } from "@/lib/sage/client-project-write"

/*
 * "Request add to Sage": what staff send and what the Sage writer receives.
 * Pure and client-safe. Sage numbers new records itself, so only the name,
 * address, phone and email (and a vendor's type and 1099 flag) go.
 */

export const sageDirectoryAddKindSchema = z.enum(SAGE_DIRECTORY_ADD_KINDS)
const vendor1099Schema = z.enum(VENDOR_1099_STATUSES)

const text = (max: number) => z.string().trim().max(max).nullable().transform((value) => value || null)
const requiredName = (max: number) => z.string().trim().min(1, "Name is required").max(max)

/** Sage's vendor and client field sizes (actpay / reccln, in characters). */
export const sageCompanyAddFieldsSchema = z.object({
  name: requiredName(75),
  addressLine1: text(50),
  addressLine2: text(50),
  city: text(50),
  state: text(2),
  postalCode: text(10),
  phone: text(14),
  email: z.union([z.literal(""), z.null(), z.email().max(75)]).transform((value) => value || null),
})
export type SageCompanyAddFields = z.infer<typeof sageCompanyAddFieldsSchema>

export const sagePersonAddFieldsSchema = z.object({
  name: requiredName(50),
  title: text(50),
  phone: text(20),
  cellPhone: text(20),
  email: z.union([z.literal(""), z.null(), z.email().max(75)]).transform((value) => value || null),
})
export type SagePersonAddFields = z.infer<typeof sagePersonAddFieldsSchema>

export const sageDirectoryAddInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("vendor_company"),
    entityId: z.string().min(1),
    fields: sageCompanyAddFieldsSchema,
    vendorType: z.string().trim().min(1, "Choose the Sage vendor type").max(50),
    form1099: vendor1099Schema,
  }),
  z.object({ kind: z.literal("client_company"), entityId: z.string().min(1), fields: sageCompanyAddFieldsSchema }),
  // A person's company must be in Sage or already asked for; the dialog offers that request first.
  z.object({ kind: z.enum(["vendor_person", "client_person"]), entityId: z.string().min(1), fields: sagePersonAddFieldsSchema }),
])


/** Statuses that still hold the record (one open request per record). */
export const OPEN_SAGE_ADD_STATUSES: readonly SageDirectoryAddStatus[] = ["pending", "approved", "sent"]

export function isOpenSageAddStatus(status: string): boolean {
  return OPEN_SAGE_ADD_STATUSES.some((open) => open === status)
}

export const SAGE_ADD_KIND_LABELS: Readonly<Record<SageDirectoryAddKind, string>> = {
  vendor_company: "Vendor",
  client_company: "Client",
  vendor_person: "Vendor contact",
  client_person: "Client contact",
}

export const SAGE_ADD_STATUS_LABELS: Readonly<Record<SageDirectoryAddStatus, string>> = {
  pending: "Waiting for approval",
  approved: "Approved, waiting for its company",
  sent: "Approved, with the Sage writer",
  succeeded: "Added to Sage",
  failed: "Sage didn't add it",
  rejected: "Not approved",
  cancelled: "Withdrawn",
}

export const VENDOR_1099_LABELS: Readonly<Record<Vendor1099Status, string>> = {
  yes: "Gets a 1099",
  no: "No 1099",
  unknown: "Not known yet (W-9 needed)",
}

export function personKindParent(kind: "vendor_person" | "client_person"): "vendor_company" | "client_company" {
  return kind === "vendor_person" ? "vendor_company" : "client_company"
}

/** The company's address as one line, the way Compass shows it. */
export function companyAddressLine(fields: SageCompanyAddFields): string | null {
  const region = [fields.state, fields.postalCode].filter(Boolean).join(" ")
  const place = [fields.city, region || null].filter(Boolean).join(", ")
  return [fields.addressLine1, fields.addressLine2, place || null].filter(Boolean).join(", ") || null
}

/**
 * The Sage vendor type a Compass category most likely means: the company's
 * Sage type → category mapping read backwards, else a type of the same name.
 */
export function defaultSageVendorType(
  category: string,
  mapping: Readonly<Record<string, string>>,
  sageTypes: readonly string[]
): string | null {
  const wanted = category.trim().toLowerCase()
  for (const [type, mapped] of Object.entries(mapping)) {
    if (mapped.trim().toLowerCase() === wanted) return type
  }
  return sageTypes.find((type) => type.trim().toLowerCase() === wanted) ?? null
}

export type SageVendorAddPayload = {
  readonly operationType: "ensure_vendor"
  readonly company: "High Performance Structures Inc"
  readonly vendor: {
    readonly compassVendorId: string
    readonly name: string
    readonly shortName: string
    readonly addressLine1: string | null
    readonly addressLine2: string | null
    readonly city: string | null
    readonly state: string | null
    readonly postalCode: string | null
    readonly phone: string | null
    readonly email: string | null
    readonly vendorType: string
    readonly print1099: boolean
  }
}

export function sageVendorAddPayload(
  vendorId: string,
  fields: SageCompanyAddFields,
  vendorType: string,
  form1099: Vendor1099Status
): SageVendorAddPayload {
  return {
    operationType: "ensure_vendor",
    company: "High Performance Structures Inc",
    vendor: {
      compassVendorId: vendorId,
      name: fields.name,
      shortName: sageShortName(fields.name),
      addressLine1: fields.addressLine1,
      addressLine2: fields.addressLine2,
      city: fields.city,
      state: fields.state ? fields.state.toUpperCase() : null,
      postalCode: fields.postalCode,
      phone: fields.phone,
      email: fields.email,
      vendorType,
      // Unknown stays off until the W-9 says otherwise; it never holds up the add.
      print1099: form1099 === "yes",
    },
  }
}

export type SageClientAddPayload = {
  readonly operationType: "ensure_client"
  readonly company: "High Performance Structures Inc"
  readonly client: {
    readonly compassCustomerId: string
    readonly name: string
    readonly shortName: string
    readonly company: string | null
    readonly email: string | null
    readonly phone: string | null
    readonly address: string | null
    readonly billingAddress: string | null
    readonly notes: string | null
    readonly status: { readonly expectedNumber: number; readonly name: string }
  }
}

export function sageClientAddPayload(
  customerId: string,
  fields: SageCompanyAddFields,
  company: string | null,
  status: { readonly expectedNumber: number; readonly name: string }
): SageClientAddPayload {
  const address = companyAddressLine(fields)
  return {
    operationType: "ensure_client",
    company: "High Performance Structures Inc",
    client: {
      compassCustomerId: customerId,
      name: fields.name,
      shortName: sageShortName(company || fields.name),
      company,
      email: fields.email,
      phone: fields.phone,
      address,
      billingAddress: address,
      notes: null,
      status,
    },
  }
}
