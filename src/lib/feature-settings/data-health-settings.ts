import { z } from "zod/v4"

/*
 * Settings > Workflows > Data health: whether the daily, read-only data
 * health check notifies this company, and who. Pure and client-safe.
 */
const dataHealthSettingsSchema = z.object({
  /** Send a notice when the check finds drift, when the drift changes, and when it clears. */
  notices: z.boolean(),
  /** Who gets the notice; empty means the company's administrators. */
  recipientUserIds: z.array(z.string().min(1).max(200)).max(20),
})

export type DataHealthSettings = z.infer<typeof dataHealthSettingsSchema>

export const DATA_HEALTH_SETTINGS_GROUP = {
  label: "Data health",
  description:
    "A daily, read-only check that every record's status is one Compass allows and that the database has exactly the tables and columns Compass expects. Staff are told only when it finds a problem, the problem changes, or it clears.",
  defaults: { notices: true, recipientUserIds: [] } satisfies DataHealthSettings,
  schema: dataHealthSettingsSchema,
}
