import { tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import { compassApi } from "./api-client"

export function memoryTools(apiBaseUrl: string, authToken: string) {
  return [
    tool(
      "rememberContext",
      "Save something to persistent memory. Use when the user shares a preference, makes a decision, or mentions a fact worth remembering across sessions.",
      {
        content: z.string().describe(
          "What to remember (a preference, decision, fact, or workflow)"
        ),
        memoryType: z.enum([
          "preference",
          "workflow",
          "fact",
          "decision",
        ]).describe("Category of memory"),
        tags: z.string().optional().describe("Comma-separated tags for categorization"),
        importance: z.number().min(0.3).max(1.0).optional().describe(
          "Importance weight 0.3-1.0 (default 0.7)"
        ),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/memory/save",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "recallMemory",
      "Search persistent memories for this user. Use when the user asks if you remember something or when you need to look up a past preference or decision.",
      {
        query: z.string().describe("What to search for in memories"),
        limit: z.number().optional().describe("Max results (default 5)"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/memory/recall",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    )
  ]
}
