import { z } from "zod/v4"

/*
 * Settings › Contacts › Vendor types: the company's list of vendor types
 * (named as in Sage, so the two match) and the role each one plays on a job.
 * A vendor's directory type is picked from this list, and the job role decides
 * how the company is added to jobs and invited: "subcontractor" (performs
 * work), "supplier" (delivers material) or "none" (listed on the directory
 * only, never invited). Pure and client-safe.
 */
export const VENDOR_JOB_ROLES = ["subcontractor", "supplier", "none"] as const
export type VendorJobRole = (typeof VENDOR_JOB_ROLES)[number]

const vendorTypeSchema = z.object({
  name: z.string().trim().min(1).max(50),
  jobRole: z.enum(VENDOR_JOB_ROLES),
  /** Hidden types stay valid on existing vendors but are not offered. */
  hidden: z.boolean(),
})

const vendorTypesSettingsSchema = z.object({
  types: z
    .array(vendorTypeSchema)
    .max(60)
    .refine(
      (types) => new Set(types.map((type) => type.name.toLowerCase())).size === types.length,
      "Each vendor type name can be used once.",
    ),
})

export type VendorTypeSetting = z.infer<typeof vendorTypeSchema>
export type VendorTypesSettings = z.infer<typeof vendorTypesSettingsSchema>

const DEFAULT_VENDOR_TYPES_SETTINGS: VendorTypesSettings = {
  types: [
    { name: "Subcontractor", jobRole: "subcontractor", hidden: false },
    { name: "Material Supplier", jobRole: "supplier", hidden: false },
    { name: "Professional Services", jobRole: "subcontractor", hidden: false },
    { name: "Equipment and Rental", jobRole: "none", hidden: false },
    { name: "Government Agency", jobRole: "none", hidden: false },
  ],
}

export const VENDOR_TYPES_SETTINGS_GROUP = {
  label: "Vendor types",
  description:
    "The vendor types a company in the directory can have, named as in Sage, and the role each plays on a job: subcontractor (performs work), supplier (delivers material) or none (never invited).",
  defaults: DEFAULT_VENDOR_TYPES_SETTINGS,
  schema: vendorTypesSettingsSchema,
}
