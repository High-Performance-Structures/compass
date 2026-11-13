import { z } from "zod/v4"

/*
 * Settings > People > Client conversations: whether every client with a
 * Compass login on a job sees all of that job's client conversations
 * (imported threads and shared emails), not only the ones they were part
 * of. Vendors never share: each sees only their own. On by default, since
 * co-owners of one home normally expect to read each other's messages with
 * the builder. Pure and client-safe.
 */
const clientConversationSettingsSchema = z.object({
  /** Clients on the same job join each other's client conversations. */
  shareAmongClients: z.boolean(),
})

export type ClientConversationSettings = z.infer<typeof clientConversationSettingsSchema>

const DEFAULT_CLIENT_CONVERSATION_SETTINGS: ClientConversationSettings = {
  shareAmongClients: true,
}

export const CLIENT_CONVERSATION_SETTINGS_GROUP = {
  label: "Client conversations",
  description:
    "Whether clients on the same job see all of that job's client conversations, including threads and emails that came through another client. Vendor conversations stay with each vendor, and jobs marked staff-only stay closed.",
  defaults: DEFAULT_CLIENT_CONVERSATION_SETTINGS,
  schema: clientConversationSettingsSchema,
}
