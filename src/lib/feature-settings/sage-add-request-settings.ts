import { z } from "zod/v4"

/*
 * Settings > Workflows > Adding to Sage: who decides staff requests to add a
 * vendor, client, or one of their people to Sage. Pure and client-safe.
 */
export const sageAddRequestSettingsSchema = z.object({
  /** The one staff member who approves; null: any active admin. */
  approverUserId: z.string().min(1).max(200).nullable(),
})

export type SageAddRequestSettings = z.infer<typeof sageAddRequestSettingsSchema>

const DEFAULT_SAGE_ADD_REQUEST_SETTINGS: SageAddRequestSettings = {
  approverUserId: null,
}

export const SAGE_ADD_REQUEST_SETTINGS_GROUP = {
  label: "Adding to Sage",
  description:
    "Who approves staff requests to add a new vendor, client, or contact to Sage. Compass checks for duplicates before a request reaches them.",
  defaults: DEFAULT_SAGE_ADD_REQUEST_SETTINGS,
  schema: sageAddRequestSettingsSchema,
}

/**
 * True when this user decides add requests: the chosen approver, or (with
 * none chosen, or one who is no longer an active admin-level user) any
 * active admin.
 */
export function isSageAddApprover(
  settings: SageAddRequestSettings,
  user: { readonly id: string; readonly isAdmin: boolean },
  approverStillActive: boolean
): boolean {
  if (settings.approverUserId && approverStillActive) return settings.approverUserId === user.id
  return user.isAdmin
}
