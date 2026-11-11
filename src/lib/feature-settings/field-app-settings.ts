import { z } from "zod/v4"

import { PORTFOLIO_PHASE_IDS, type PortfolioPhaseId } from "@/lib/portfolio-map/phases"

/*
 * Settings > Workflows > Field app: which jobs appear in the field app on
 * "Automatic", and whether active Sage employees see them without being
 * added to each job. A job's phase comes from the company's job status →
 * phase mapping in Settings > Workflows > Portfolio map, so moving a status
 * into a field app phase there brings its jobs into the field app. Pure and
 * client-safe.
 */
const fieldAppSettingsSchema = z.object({
  /**
   * Staff linked to an active internal contact with a Sage employee record
   * see every field app job without a project membership row. Off: only jobs
   * they are a member of.
   */
  autoAccessForSageEmployees: z.boolean(),
  /** Pipeline phases whose jobs show on Automatic. */
  phases: z.array(z.enum(PORTFOLIO_PHASE_IDS)).max(PORTFOLIO_PHASE_IDS.length),
  /** Departments whose jobs never show on Automatic (a job can still be set to Always show). */
  excludedDepartments: z.array(z.string().regex(/^[A-Z]$/)).max(26),
})

export type FieldAppSettings = z.infer<typeof fieldAppSettingsSchema>

const DEFAULT_FIELD_APP_PHASES: readonly PortfolioPhaseId[] = ["construction", "closeout"]

const DEFAULT_FIELD_APP_SETTINGS: FieldAppSettings = {
  autoAccessForSageEmployees: true,
  phases: [...DEFAULT_FIELD_APP_PHASES],
  excludedDepartments: ["N"],
}

export const FIELD_APP_SETTINGS_GROUP = {
  label: "Field app",
  description:
    "Which jobs appear in the field app on Automatic (by pipeline phase and department), and whether active Sage employees see them without being added to each job. Any job can still be set to Always show or Hide.",
  defaults: DEFAULT_FIELD_APP_SETTINGS,
  schema: fieldAppSettingsSchema,
}
