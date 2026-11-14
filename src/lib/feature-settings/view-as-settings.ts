import { z } from "zod/v4"

/*
 * Settings > People > View as: who may open a live, read-only copy of
 * another person's Compass from developer mode (src/lib/view-as/). Admins
 * only by default. A company can turn it off entirely, or add named staff;
 * owners and vendors can never be added (src/lib/view-as/policy.ts checks
 * every listed person is still company staff on each request). Pure and
 * client-safe.
 */
const viewAsSettingsSchema = z.object({
  /** Off: nobody in this company can use View as, admins included. */
  enabled: z.boolean(),
  /** Staff besides admins who may use it; they also get the developer mode switch it needs. */
  extraStaffUserIds: z.array(z.string().min(1).max(200)).max(20),
})

export type ViewAsSettings = z.infer<typeof viewAsSettingsSchema>

export const VIEW_AS_SETTINGS_GROUP = {
  label: "View as",
  description:
    "Lets admins in developer mode open a live, read-only copy of anyone's Compass (staff, owners and vendors) to see exactly what that person sees when they report a problem. Nothing can be saved or sent while viewing, Gmail and Google Calendar contents are not shown, the viewed person is not notified, and each view is recorded in Activity.",
  defaults: { enabled: true, extraStaffUserIds: [] } satisfies ViewAsSettings,
  schema: viewAsSettingsSchema,
  /** Widening who can see anyone's Compass is the full admin's call alone. */
  editorRoles: new Set(["admin"]),
}
