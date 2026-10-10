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

/** Settings type for each registered feature key. */
type FeatureSettingsTypes = {
  readonly "message-desk": MessageDeskSettings
  readonly "project-aging": ProjectAgingSettings
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
