import { z } from "zod/v4"

/*
 * Settings › Company › Vendor types: the company's list of vendor types
 * (named as in Sage, so the two match). Each type decides two things for
 * every vendor that has it:
 * - its job role: "subcontractor" (performs work), "supplier" (delivers
 *   material) or "none" (listed on the directory only, never invited);
 * - the paperwork Compass requests: "none", "w9" (W-9 only) or "full"
 *   (trade docs and insurance; which documents is Settings › Trade docs).
 * Pure and client-safe.
 */
export const VENDOR_JOB_ROLES = ["subcontractor", "supplier", "none"] as const
export type VendorJobRole = (typeof VENDOR_JOB_ROLES)[number]

export const VENDOR_PAPERWORK_LEVELS = ["none", "w9", "full"] as const
export type VendorPaperworkLevel = (typeof VENDOR_PAPERWORK_LEVELS)[number]

const vendorTypeSchema = z.object({
  name: z.string().trim().min(1).max(50),
  jobRole: z.enum(VENDOR_JOB_ROLES),
  paperwork: z.enum(VENDOR_PAPERWORK_LEVELS).default("none"),
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
    { name: "Subcontractor", jobRole: "subcontractor", paperwork: "full", hidden: false },
    { name: "Material Supplier", jobRole: "supplier", paperwork: "w9", hidden: false },
    { name: "Professional Services", jobRole: "subcontractor", paperwork: "full", hidden: false },
    { name: "Equipment and Rental", jobRole: "none", paperwork: "w9", hidden: false },
    { name: "Government Agency", jobRole: "none", paperwork: "none", hidden: false },
    { name: "Technology and Software", jobRole: "none", paperwork: "w9", hidden: false },
    { name: "Miscellaneous", jobRole: "none", paperwork: "none", hidden: false },
  ],
}

export const VENDOR_TYPES_SETTINGS_GROUP = {
  label: "Vendor types",
  description:
    "The vendor types a company in the directory can have, named as in Sage. Each type sets its role on jobs (subcontractor, supplier or none) and the paperwork Compass requests (nothing, W-9 only, or trade docs and insurance).",
  defaults: DEFAULT_VENDOR_TYPES_SETTINGS,
  schema: vendorTypesSettingsSchema,
}

/** The listed type with this name (any case), or null for a name not on the list. */
export function vendorTypeNamed(types: readonly VendorTypeSetting[], name: string | null): VendorTypeSetting | null {
  const key = name?.trim().toLowerCase() ?? ""
  return key ? types.find((type) => type.name.trim().toLowerCase() === key) ?? null : null
}
