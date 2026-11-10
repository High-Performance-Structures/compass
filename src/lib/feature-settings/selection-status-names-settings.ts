import { z } from "zod/v4"

import { PROJECT_SELECTION_STATUSES } from "@/lib/domain/selections/statuses"
import { SELECTION_STATUS_NAME_MAX_LENGTH, selectionStatusNameProblems } from "@/lib/domain/selections/status-labels"

/*
 * Settings > Workflows > Selections > Status names: the company's own
 * names for the ten selection statuses. Only renamed statuses are stored;
 * the rest keep their default label. Statuses can't be added or removed,
 * and the stored keys never change. Kept as its own settings group (not a
 * field on "selections") so the Status names list saves on its own without
 * touching the rest of the Selections settings. Pure and client-safe.
 */

export const selectionStatusNamesSettingsSchema = z
  .object({
    names: z.partialRecord(z.enum(PROJECT_SELECTION_STATUSES), z.string().trim().max(SELECTION_STATUS_NAME_MAX_LENGTH)),
  })
  .superRefine((value, ctx) => {
    for (const [status, message] of Object.entries(selectionStatusNameProblems(value.names))) {
      ctx.addIssue({ code: "custom", path: ["names", status], message })
    }
  })

export type SelectionStatusNamesSettings = z.infer<typeof selectionStatusNamesSettingsSchema>

export const SELECTION_STATUS_NAMES_SETTINGS_GROUP = {
  label: "Selection status names",
  description: "What each selection status is called on the Selections sheet, forms, owner portal, print views, RFQs and Activity.",
  defaults: { names: {} } satisfies SelectionStatusNamesSettings,
  schema: selectionStatusNamesSettingsSchema,
}
