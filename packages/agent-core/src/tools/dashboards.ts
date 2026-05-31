import { z } from "zod/v4"
import type { DataSource } from "../types"
import type { ToolDef } from "./data"
import { zodToJsonSchema } from "./data"

const saveSchema = z.object({
  name: z.string().describe("Dashboard display name"),
  description: z
    .string()
    .optional()
    .describe("Brief description of the dashboard"),
  dashboardId: z
    .string()
    .optional()
    .describe("Existing dashboard ID to update (for edits)"),
})

const listSchema = z.object({})

const editSchema = z.object({
  dashboardId: z
    .string()
    .describe("ID of the dashboard to edit"),
  editPrompt: z
    .string()
    .optional()
    .describe("Description of changes to make"),
})

const deleteSchema = z.object({
  dashboardId: z
    .string()
    .describe("ID of the dashboard to delete"),
})

export function dashboardTools(
  dataSource: DataSource
): ToolDef[] {
  return [
    {
      name: "saveDashboard",
      description:
        "Save the currently rendered UI as a named dashboard. " +
        "The client captures the current spec and data context " +
        "automatically. Returns an action for the client to " +
        "handle the save.",
      input_schema: zodToJsonSchema(saveSchema),
      run: async (input: unknown): Promise<string> => {
        const args = saveSchema.parse(input)
        return JSON.stringify({
          action: "save_dashboard",
          name: args.name,
          description: args.description ?? "",
          dashboardId: args.dashboardId,
        })
      },
    },

    {
      name: "listDashboards",
      description: "List the user's saved custom dashboards.",
      input_schema: zodToJsonSchema(listSchema),
      run: async (): Promise<string> => {
        const result = await dataSource.fetch(
          "/api/compass/dashboards/list"
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "editDashboard",
      description:
        "Load a saved dashboard for editing. The client " +
        "injects the spec into the render context and " +
        "navigates to /dashboard. Optionally pass an " +
        "editPrompt to trigger immediate re-generation.",
      input_schema: zodToJsonSchema(editSchema),
      run: async (input: unknown): Promise<string> => {
        const args = editSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/dashboards/get",
          { dashboardId: args.dashboardId }
        )
        return JSON.stringify({
          action: "load_dashboard",
          dashboardId: args.dashboardId,
          spec: result,
          editPrompt: args.editPrompt,
        })
      },
    },

    {
      name: "deleteDashboard",
      description:
        "Delete a saved dashboard. Always confirm with the " +
        "user before deleting.",
      input_schema: zodToJsonSchema(deleteSchema),
      run: async (input: unknown): Promise<string> => {
        const args = deleteSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/dashboards/delete",
          args
        )
        return JSON.stringify(result)
      },
    },
  ]
}
