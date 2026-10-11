import { z } from "zod/v4"
import type { DataSource } from "../types"
import type { ToolDef } from "./data"
import { zodToJsonSchema } from "./data"

const listConversationsSchema = z.object({
  unreadOnly: z
    .boolean()
    .optional()
    .describe("Only return conversations with unread messages"),
})

const searchMessagesSchema = z.object({
  search: z
    .string()
    .optional()
    .describe("Text to look for in message content. Omit for the newest messages."),
  channelId: z
    .string()
    .optional()
    .describe("Limit to one conversation (ID from listConversations)"),
  sinceDays: z
    .number()
    .optional()
    .describe("Only messages from the last N days"),
  limit: z
    .number()
    .optional()
    .describe("Max messages to return (default 20, max 50)"),
})

export function messageTools(dataSource: DataSource): ToolDef[] {
  return [
    {
      name: "listConversations",
      description:
        "List the Compass conversations (channels) the user can see, with " +
        "each one's unread message count for this user. Use it to answer " +
        "whether the user has new or unread messages. Results include href " +
        "links to open each conversation.",
      input_schema: zodToJsonSchema(listConversationsSchema),
      run: async (input: unknown): Promise<string> => {
        const args = listConversationsSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/messages",
          { action: "channels", ...args }
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "searchMessages",
      description:
        "Read recent messages, or search message text, across the Compass " +
        "conversations the user can see, newest first. Read-only. Results " +
        "include the conversation name, author, time, and an href link.",
      input_schema: zodToJsonSchema(searchMessagesSchema),
      run: async (input: unknown): Promise<string> => {
        const args = searchMessagesSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/messages",
          { action: "search", ...args }
        )
        return JSON.stringify(result)
      },
    },
  ]
}
