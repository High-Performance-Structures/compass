import { z } from "zod"
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
          "/api/compass/memory/save",
          args
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
          "/api/compass/memory/recall",
          args
        )
        return JSON.stringify(result)
      },
    },
  ]
}
