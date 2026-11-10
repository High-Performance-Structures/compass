import { z } from "zod/v4"

/*
 * Settings > People > Access requests: whether people who sign up without
 * an invitation can find this company and ask to join it. Off by default,
 * so a company is never listed until an admin turns it on. Pure and
 * client-safe.
 */
const accessRequestSettingsSchema = z.object({
  /** Listed on the Request access page; requests still need staff approval. */
  allowRequests: z.boolean(),
})

export type AccessRequestSettings = z.infer<typeof accessRequestSettingsSchema>

const DEFAULT_ACCESS_REQUEST_SETTINGS: AccessRequestSettings = {
  allowRequests: false,
}

export const ACCESS_REQUEST_SETTINGS_GROUP = {
  label: "Access requests",
  description:
    "Let people who sign up for Compass without an invitation find this company and ask to join it. Admins link each request to the person's directory record before approving; nothing is shared until someone approves.",
  defaults: DEFAULT_ACCESS_REQUEST_SETTINGS,
  schema: accessRequestSettingsSchema,
}
