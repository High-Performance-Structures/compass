import { z } from "zod/v4"

/**
 * The company's own email domains, current and old (for example a domain
 * used before a rename). An address on one of them is the company's own:
 * it never matches a vendor by domain, and imported participants on it are
 * matched to the staff member with the same name before the @.
 */
export const companyEmailDomainsSettingsSchema = z.object({
  domains: z.array(z.string().trim().toLowerCase().regex(/^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/, "Enter a domain such as example.com.")).max(20),
})

export type CompanyEmailDomainsSettings = z.infer<typeof companyEmailDomainsSettingsSchema>

export const COMPANY_EMAIL_DOMAINS_SETTINGS_GROUP = {
  label: "Company email domains",
  description: "Your company's own email domains, including old ones. Addresses on them are never matched to a vendor, and imported messages from them are matched to the staff member with the same name before the @.",
  defaults: { domains: [] },
  schema: companyEmailDomainsSettingsSchema,
}
