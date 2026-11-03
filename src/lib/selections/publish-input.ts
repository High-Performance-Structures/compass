import { z } from "zod/v4"

/** Validates the staff form that publishes a finish selection to the owner. */
export const publishSelectionSchema = z.object({
  selectionId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  selectionUpdatedAt: z.string(),
  published: z.boolean(),
  decisionDueDate: z.string().max(10),
  allowance: z.string(),
  price: z.string(),
  scheduleImpact: z.string().max(2000),
  ownerNote: z.string().max(4000),
  requiresChangeOrder: z.boolean(),
  changeOrderId: z.string(),
})
export type PublishSelectionInput = z.infer<typeof publishSelectionSchema>
