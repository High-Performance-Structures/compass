import { tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import { compassApi } from "./api-client"

export function dashboardTools(apiBaseUrl: string, authToken: string) {
  return [
    tool(
      "saveDashboard",
      "Save the currently rendered UI as a named dashboard. The client captures the current spec and data context automatically. Returns an action for the client to handle the save.",
      {
        name: z.string().describe("Dashboard display name"),
        description: z.string().optional().describe(
          "Brief description of the dashboard"
        ),
        dashboardId: z.string().optional().describe(
          "Existing dashboard ID to update (for edits)"
        ),
      },
      async (args) => {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              action: "save_dashboard",
              name: args.name,
              description: args.description ?? "",
              dashboardId: args.dashboardId,
            })
          }]
        }
      }
    ),

    tool(
      "listDashboards",
      "List the user's saved custom dashboards.",
      {},
      async () => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/dashboards/list",
          authToken
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "editDashboard",
      "Load a saved dashboard for editing. The client injects the spec into the render context and navigates to /dashboard. Optionally pass an editPrompt to trigger immediate re-generation.",
      {
        dashboardId: z.string().describe("ID of the dashboard to edit"),
        editPrompt: z.string().optional().describe("Description of changes to make"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/dashboards/get",
          authToken,
          { dashboardId: args.dashboardId }
        )
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              action: "load_dashboard",
              dashboardId: args.dashboardId,
              spec: result,
              editPrompt: args.editPrompt,
            })
          }]
        }
      }
    ),

    tool(
      "deleteDashboard",
      "Delete a saved dashboard. Always confirm with the user before deleting.",
      {
        dashboardId: z.string().describe("ID of the dashboard to delete"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/dashboards/delete",
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
