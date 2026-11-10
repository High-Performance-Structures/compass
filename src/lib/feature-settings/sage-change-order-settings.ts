import { z } from "zod/v4"

/*
 * Settings > Workflows > Sage change orders: how Compass names and codes a
 * change order or variance it sends to Sage 100 Contractor as an approved
 * prime change order. Pure and client-safe, so the settings form and the send
 * confirmation share it.
 */

/** Every number format needs the change order's own number: {n} or {n:2}. */
const NUMBER_TOKEN = /\{n(?::\d)?\}/

/** Every description format names the change order: {title} or {name}. */
const DESCRIPTION_TOKEN = /\{(title|name)\}/

const sageRecordNumber = (max: number) => z.number().int().min(0).max(max)

/**
 * Tokens in the number format: {n} the Compass number ("14", "V-006"; {n:3}
 * pads plain digits to three), {project} the project number and {job} the
 * Sage job number. Tokens in the description formats: {name} the Sage name
 * ("14", "V-006") and {title} the change order's title.
 */
export const sageChangeOrderSettingsSchema = z.object({
  numberFormat: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .refine((value) => NUMBER_TOKEN.test(value), "Include {n} for the change order's number."),
  changeOrderDescriptionFormat: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => DESCRIPTION_TOKEN.test(value), "Include {title} or {name}."),
  varianceDescriptionFormat: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => DESCRIPTION_TOKEN.test(value), "Include {title} or {name}."),
  /** Sage cost type for every line (Sage's own list; 5 is Other in the standard setup). */
  costTypeNumber: sageRecordNumber(99),
  /** Sage's PrimeChangeStatus number for an approved change order. */
  approvedStatusNumber: sageRecordNumber(99),
})

export type SageChangeOrderSettings = z.infer<typeof sageChangeOrderSettingsSchema>

export const DEFAULT_SAGE_CHANGE_ORDER_SETTINGS: SageChangeOrderSettings = {
  numberFormat: "{n}",
  changeOrderDescriptionFormat: "{title}",
  varianceDescriptionFormat: "{name} {title}",
  costTypeNumber: 5,
  approvedStatusNumber: 1,
}

export const SAGE_CHANGE_ORDER_SETTINGS_GROUP = {
  label: "Sage change orders",
  description:
    "How executed change orders and variances are numbered, described and coded when staff send them to Sage as approved prime change orders.",
  defaults: DEFAULT_SAGE_CHANGE_ORDER_SETTINGS,
  schema: sageChangeOrderSettingsSchema,
}

/*
 * Settings > Workflows > Sage estimates: what Compass does with an accepted
 * estimate when the company uses Sage.
 */
const sageEstimateSettingsSchema = z.object({
  /** Queue the job (if missing), proposal and optional budget as soon as an estimate is accepted. */
  autoSync: z.boolean(),
  /** Also send the job budget at cost (BudgetAddRq). */
  sendBudget: z.boolean(),
})

export type SageEstimateSettings = z.infer<typeof sageEstimateSettingsSchema>

export const SAGE_ESTIMATE_SETTINGS_GROUP = {
  label: "Sage estimates",
  description:
    "Whether an accepted estimate goes to Sage automatically as the job's proposal, and whether the job budget at cost goes with it.",
  defaults: { autoSync: true, sendBudget: false } satisfies SageEstimateSettings,
  schema: sageEstimateSettingsSchema,
}
