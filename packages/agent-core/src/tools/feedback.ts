import { z } from "zod/v4"
import type { DataSource } from "../types"
import type { ToolDef } from "./data"
import { zodToJsonSchema } from "./data"

const fileSchema = z.object({
  kind: z
    .enum(["bug", "feature", "question", "general", "assistance"])
    .describe(
      "bug: something in Compass is broken or wrong; feature: a new " +
        "capability or change; question: how something works; " +
        "assistance: the person needs help from staff; general: anything else"
    ),
  title: z
    .string()
    .max(160)
    .describe("Short summary in the person's terms, under 160 characters"),
  description: z
    .string()
    .max(2000)
    .describe(
      "What the person reported, in their words: what they did, what they " +
        "expected and what happened, plus the page or record if known. " +
        "No passwords, codes or other secrets."
    ),
  page: z
    .string()
    .optional()
    .describe("The Compass page the person was on, if relevant"),
})

export function feedbackTools(dataSource: DataSource): ToolDef[] {
  return [
    {
      name: "fileFeedback",
      description:
        "File a problem report, feature request or question with the " +
        "Compass Feedback Desk for the signed-in person. Use it when they " +
        "report something wrong or missing in Compass, ask for a change, or " +
        "ask you to file or report something. Offer to file it if they " +
        "haven't asked. The person must press Confirm in the chat before " +
        "it's filed; after that they can follow it in My Requests.",
      input_schema: zodToJsonSchema(fileSchema),
      run: async (input: unknown): Promise<string> => {
        const args = fileSchema.parse(input)
        const result = await dataSource.fetch("/api/compass/feedback", {
          action: "file",
          ...args,
        })
        return JSON.stringify(result)
      },
    },
  ]
}
