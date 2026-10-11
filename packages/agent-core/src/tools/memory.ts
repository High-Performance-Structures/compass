import { z } from "zod/v4"
import type { DataSource } from "../types"
import type { ToolDef } from "./data"
import { zodToJsonSchema } from "./data"

const rememberSchema = z.object({
  content: z
    .string()
    .describe(
      "What to remember (a preference, decision, fact, " +
        "or workflow)"
    ),
  memoryType: z
    .enum(["preference", "workflow", "fact", "decision"])
    .describe("Category of memory"),
  tags: z
    .string()
    .optional()
    .describe("Comma-separated tags for categorization"),
  importance: z
    .number()
    .min(0.3)
    .max(1.0)
    .optional()
    .describe("Importance weight 0.3-1.0 (default 0.7)"),
})

const recallConversationsSchema = z.object({
  conversationId: z
    .string()
    .optional()
    .describe("Open this earlier conversation; omit to list recent ones"),
  limit: z
    .number()
    .optional()
    .describe("How many recent conversations to list (default 10, max 20)"),
})

const recallSchema = z.object({
  query: z
    .string()
    .describe("What to search for in memories"),
  limit: z
    .number()
    .optional()
    .describe("Max results (default 5)"),
})

export function memoryTools(dataSource: DataSource): ToolDef[] {
  return [
    {
      name: "rememberContext",
      description:
        "Save something to persistent memory. Use when the " +
        "user shares a preference, makes a decision, or " +
        "mentions a fact worth remembering across sessions.",
      input_schema: zodToJsonSchema(rememberSchema),
      run: async (input: unknown): Promise<string> => {
        const args = rememberSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/memory",
          { action: "save", ...args }
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "recallConversations",
      description:
        "Look up this user's earlier Ask Jarvis conversations. Each chat " +
        "starts fresh, so use this only when the user asks about a " +
        "previous conversation or asks to pick up where they left off. " +
        "Without conversationId it lists recent conversations with their " +
        "first request; with conversationId it returns that " +
        "conversation's latest messages.",
      input_schema: zodToJsonSchema(recallConversationsSchema),
      run: async (input: unknown): Promise<string> => {
        const args = recallConversationsSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/memory",
          args.conversationId
            ? { action: "conversation", conversationId: args.conversationId }
            : { action: "recentConversations", limit: args.limit ?? 10 }
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "recallMemory",
      description:
        "Search persistent memories for this user. Use when " +
        "the user asks if you remember something or when you " +
        "need to look up a past preference or decision.",
      input_schema: zodToJsonSchema(recallSchema),
      run: async (input: unknown): Promise<string> => {
        const args = recallSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/memory",
          { action: "search", ...args }
        )
        return JSON.stringify(result)
      },
    },
  ]
}
