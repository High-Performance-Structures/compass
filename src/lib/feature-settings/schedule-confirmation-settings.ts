import { z } from "zod/v4"

/*
 * Settings > Workflows > Schedule confirmations: what happens to a sub's or
 * vendor's answer when a schedule item's dates move. Pure and client-safe.
 */
const scheduleConfirmationSettingsSchema = z.object({
  /**
   * An item whose start date or duration moves (by hand, through a
   * dependency or a calendar change) asks its assignees to confirm the new
   * dates. Off: answers given for the old dates stay.
   */
  reaskOnDateMove: z.boolean(),
})

export type ScheduleConfirmationSettings = z.infer<typeof scheduleConfirmationSettingsSchema>

export const SCHEDULE_CONFIRMATION_SETTINGS_GROUP = {
  label: "Schedule confirmations",
  description: "Whether moving a schedule item's dates asks its subs and vendors to confirm the new dates.",
  defaults: { reaskOnDateMove: true } satisfies ScheduleConfirmationSettings,
  schema: scheduleConfirmationSettingsSchema,
}
