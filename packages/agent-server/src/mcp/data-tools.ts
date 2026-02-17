import { tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import { compassApi } from "./api-client"

export function dataTools(apiBaseUrl: string, authToken: string) {
  return [
    tool(
      "queryData",
      "Query the application database. Describe what data you need in natural language and provide a query type.",
      {
        queryType: z.enum([
          "customers",
          "vendors",
          "projects",
          "invoices",
          "vendor_bills",
          "schedule_tasks",
          "project_detail",
          "customer_detail",
          "vendor_detail",
        ]),
        id: z.string().optional().describe("Record ID for detail queries"),
        search: z.string().optional().describe("Search term to filter results"),
        limit: z.number().optional().describe("Max results to return (default 20)"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/query",
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
