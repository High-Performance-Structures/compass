import { z } from "zod/v4"

/** Staff Message Desk: when open messages are flagged for follow-up, in business days. */
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
