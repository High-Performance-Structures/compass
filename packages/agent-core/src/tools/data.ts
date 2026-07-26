import { z } from "zod/v4"
import type { DataSource } from "../types"

export interface ToolDef {
  readonly name: string
  readonly description: string
  readonly input_schema: Record<string, unknown>
  readonly run: (input: unknown) => Promise<string>
}

const queryDataSchema = z.object({
  queryType: z.enum([
    "customers",
    "vendors",
    "projects",
    "invoices",
    "vendor_bills",
    "schedule_tasks",
    "project_operations",
    "daily_logs",
    "owner_updates",
    "rfis",
    "project_detail",
    "customer_detail",
    "vendor_detail",
  ]),
  id: z.string().optional().describe("Record ID for detail queries"),
  search: z
    .string()
    .optional()
    .describe("Search term to filter results"),
  limit: z
    .number()
    .optional()
    .describe("Max results to return (default 20)"),
})

export function dataTools(dataSource: DataSource): ToolDef[] {
  return [
    {
      name: "queryData",
      description:
        "Query the application database. Describe what data " +
        "you need in natural language and provide a query type. " +
        "Daily Logs, Owner Updates, RFIs, and projects include " +
        "live Compass links; include relevant links in your answer.",
      input_schema: zodToJsonSchema(queryDataSchema),
      run: async (input: unknown): Promise<string> => {
        const args = queryDataSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/query",
          args
        )
        return JSON.stringify(result)
      },
    },
  ]
}

export function zodToJsonSchema(
  schema: z.ZodObject<z.ZodRawShape>
): Record<string, unknown> {
  return { ...z.toJSONSchema(schema) }
}
