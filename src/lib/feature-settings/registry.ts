import { z } from "zod/v4"

/**
 * Company-editable feature settings. Each feature registers one group with
 * its defaults and validation; stored values are merged over the defaults so
 * new fields get sensible values automatically.
 */

export const messageDeskSettingsSchema = z
  .object({
    firstResponseDays: z.number().min(0.25).max(30),
    agingDays: z.number().min(0.5).max(60),
    staleDays: z.number().min(1).max(90),
    remindOnStale: z.boolean(),
  })
  .refine((value) => value.agingDays < value.staleDays, {
    message: "Stale must be longer than Aging.",
    path: ["staleDays"],
  })

export type MessageDeskSettings = z.infer<typeof messageDeskSettingsSchema>

/** One job status's client follow-up thresholds, in business days since the last client contact. */
export const projectFollowUpThresholdsSchema = z
  .object({
    dueDays: z.number().int().min(1).max(60),
    overdueDays: z.number().int().min(2).max(120),
  })
  .refine((value) => value.dueDays < value.overdueDays, {
    message: "Overdue must be longer than Follow-up due.",
    path: ["overdueDays"],
  })

/**
 * Project aging: per-status follow-up thresholds that replace the status's
 * built-in cadence. Statuses left out use their cadence (due on the cadence
 * day, overdue the day after).
 */
export const projectAgingSettingsSchema = z.object({
  statuses: z.record(z.string().min(1).max(80), projectFollowUpThresholdsSchema),
})

export type ProjectAgingSettings = z.infer<typeof projectAgingSettingsSchema>

const optionalEmail = z.union([z.literal(""), z.email()])

/**
 * Nu-Tech (material sales) emails: the mailbox they are sent from, the outside
 * parties' details the templates fill in, and per-template text that replaces
 * the built-in wording. Blank values leave the matching merge field empty.
 */
export const nuTechEmailSettingsSchema = z.object({
  senderAddress: optionalEmail,
  senderName: z.string().max(80),
  officePhone: z.string().max(40),
  officeHours: z.string().max(80),
  manufacturerOrdersEmail: optionalEmail,
  manufacturerCcEmail: optionalEmail,
  dealerAccountNumber: z.string().max(40),
  warehouseName: z.string().max(80),
  warehouseAddress: z.string().max(160),
  warehousePhone: z.string().max(40),
  warehouseEmail: optionalEmail,
  warehouseDockHours: z.string().max(80),
  templates: z.record(
    z.string().min(1).max(60),
    z.object({ subject: z.string().min(1).max(200), body: z.string().min(1).max(8000) }),
  ),
})

export type NuTechEmailSettings = z.infer<typeof nuTechEmailSettingsSchema>
/**
 * Project paper trail: readable copies of Compass records in each project's
 * Drive folder. "pilot" limits saving to the listed projects while the
 * company checks the results.
 */
export const paperTrailSettingsSchema = z.object({
  mode: z.enum(["off", "pilot", "on"]),
  pilotProjectIds: z.array(z.string().min(1).max(80)).max(50),
  purchaseOrders: z.boolean(),
  estimates: z.boolean(),
  rfis: z.boolean(),
  changeOrders: z.boolean(),
  milestoneCopies: z.boolean(),
  quietMinutes: z.number().int().min(1).max(60),
  /**
   * Email domains, and specific trusted addresses (e.g. an owner's personal
   * Gmail), that count as inside the company when checking whether a Drive
   * folder is shared. The connected Google account's domain always counts.
   */
  internalDomains: z
    .array(z.string().min(3).max(120).regex(/^([a-z0-9._%+-]+@)?[a-z0-9.-]+\.[a-z]{2,}$/))
    .max(60),
})

export type PaperTrailSettings = z.infer<typeof paperTrailSettingsSchema>

/** Settings type for each registered feature key. */
type FeatureSettingsTypes = {
  readonly "message-desk": MessageDeskSettings
  readonly "project-aging": ProjectAgingSettings
  readonly "nutech-emails": NuTechEmailSettings
  readonly "paper-trail": PaperTrailSettings
}

type FeatureSettingsGroup<T> = {
  readonly label: string
  readonly description: string
  readonly defaults: T
  readonly schema: z.ZodType<T>
}

export type FeatureSettingsKey = keyof FeatureSettingsTypes
export type FeatureSettingsValue<K extends FeatureSettingsKey> = FeatureSettingsTypes[K]

export const FEATURE_SETTINGS: { readonly [K in FeatureSettingsKey]: FeatureSettingsGroup<FeatureSettingsTypes[K]> } = {
  "message-desk": {
    label: "Staff Message Desk",
    description: "When open messages are flagged for follow-up, counted in business days.",
    defaults: { firstResponseDays: 1, agingDays: 2, staleDays: 5, remindOnStale: true },
    schema: messageDeskSettingsSchema,
  },
  "project-aging": {
    label: "Project aging",
    description: "When a job's client follow-up is due or overdue, by job status, counted in business days since the last client contact.",
    defaults: { statuses: {} },
    schema: projectAgingSettingsSchema,
  },
  "nutech-emails": {
    label: "Nu-Tech emails",
    description: "The mailbox Nu-Tech order emails are sent from, the manufacturer, warehouse and office details they fill in, and each template's wording.",
    defaults: {
      senderAddress: "",
      senderName: "",
      officePhone: "",
      officeHours: "",
      manufacturerOrdersEmail: "",
      manufacturerCcEmail: "",
      dealerAccountNumber: "",
      warehouseName: "",
      warehouseAddress: "",
      warehousePhone: "",
      warehouseEmail: "",
      warehouseDockHours: "",
      templates: {},
    },
    schema: nuTechEmailSettingsSchema,
  },
  "paper-trail": {
    label: "Project paper trail",
    description: "Which Compass records are saved as PDFs in each project's Google Drive folder, and how long to wait after the last edit.",
    defaults: {
      mode: "off",
      pilotProjectIds: [],
      purchaseOrders: true,
      estimates: true,
      rfis: true,
      changeOrders: true,
      milestoneCopies: true,
      quietMinutes: 3,
      internalDomains: [],
    },
    schema: paperTrailSettingsSchema,
  },
}

export function isFeatureSettingsKey(value: string): value is FeatureSettingsKey {
  return Object.prototype.hasOwnProperty.call(FEATURE_SETTINGS, value)
}

/** Stored JSON merged over the defaults; invalid or missing values fall back. */
export function parseFeatureSettings<K extends FeatureSettingsKey>(key: K, raw: string | null | undefined): FeatureSettingsValue<K> {
  const group = FEATURE_SETTINGS[key]
  if (!raw) return group.defaults
  try {
    const parsed: unknown = JSON.parse(raw)
    const merged = typeof parsed === "object" && parsed !== null ? { ...group.defaults, ...parsed } : group.defaults
    const result = group.schema.safeParse(merged)
    return result.success ? result.data : group.defaults
  } catch {
    return group.defaults
  }
}

/** Roles that may change company settings. */
const FEATURE_SETTINGS_EDITOR_ROLES: ReadonlySet<string> = new Set(["admin", "secondary_admin"])

export function canEditFeatureSettings(role: string): boolean {
  return FEATURE_SETTINGS_EDITOR_ROLES.has(role)
}
