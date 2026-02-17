import { tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import { compassApi } from "./api-client"

export function scheduleTools(apiBaseUrl: string, authToken: string) {
  return [
    tool(
      "getProjectSchedule",
      "Get the full schedule for a project including tasks, dependencies, workday exceptions, and a computed summary (counts, overall %, critical path). Always call this before making schedule mutations to resolve task names to IDs.",
      {
        projectId: z.string().describe("The project UUID"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/schedule/get",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "createScheduleTask",
      "Create a new task on a project schedule. Returns a toast confirmation. Dates are ISO format (YYYY-MM-DD).",
      {
        projectId: z.string().describe("The project UUID"),
        title: z.string().describe("Task title"),
        startDate: z.string().describe("Start date in YYYY-MM-DD format"),
        workdays: z.number().describe("Duration in working days"),
        phase: z.string().describe(
          "Construction phase (preconstruction, sitework, foundation, framing, roofing, electrical, plumbing, hvac, insulation, drywall, finish, landscaping, closeout)"
        ),
        isMilestone: z.boolean().optional().describe("Whether this is a milestone (0 workdays)"),
        percentComplete: z.number().min(0).max(100).optional().describe("Initial percent complete (0-100)"),
        assignedTo: z.string().optional().describe("Name of the person assigned"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/schedule/create",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "updateScheduleTask",
      "Update an existing schedule task. Provide only the fields to change. Use getProjectSchedule first to resolve task names to IDs.",
      {
        taskId: z.string().describe("The task UUID"),
        title: z.string().optional().describe("New title"),
        startDate: z.string().optional().describe("New start date (YYYY-MM-DD)"),
        workdays: z.number().optional().describe("New duration in working days"),
        phase: z.string().optional().describe("New phase"),
        status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETE", "BLOCKED"]).optional().describe("New status"),
        isMilestone: z.boolean().optional().describe("Set milestone flag"),
        percentComplete: z.number().min(0).max(100).optional().describe("New percent complete (0-100)"),
        assignedTo: z.string().nullable().optional().describe("New assignee (null to unassign)"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/schedule/update",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "deleteScheduleTask",
      "Delete a schedule task. Always confirm with the user before deleting. This also removes any dependencies involving the task.",
      {
        taskId: z.string().describe("The task UUID to delete"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/schedule/delete",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "createScheduleDependency",
      "Create a dependency between two tasks. Has built-in cycle detection. Use getProjectSchedule first to resolve task names to IDs.",
      {
        projectId: z.string().describe("The project UUID"),
        predecessorId: z.string().describe("UUID of the predecessor task"),
        successorId: z.string().describe("UUID of the successor task"),
        type: z.enum(["FS", "SS", "FF", "SF"]).describe(
          "Dependency type: FS (finish-to-start), SS (start-to-start), FF (finish-to-finish), SF (start-to-finish)"
        ),
        lagDays: z.number().optional().describe("Lag in working days (default 0)"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/schedule/create-dependency",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "deleteScheduleDependency",
      "Delete a dependency between tasks. Use getProjectSchedule first to find the dependency ID.",
      {
        dependencyId: z.string().describe("The dependency UUID to delete"),
        projectId: z.string().describe("The project UUID (for revalidation)"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/schedule/delete-dependency",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "addWorkdayException",
      "Add a workday exception to a project (holiday, non-working day, or extra working day).",
      {
        projectId: z.string().describe("The project UUID"),
        date: z.string().describe("Exception date in YYYY-MM-DD format"),
        category: z.enum(["holiday", "non_working", "extra_working"]).describe("Exception category"),
        recurrence: z.enum(["none", "annual", "weekly"]).optional().describe("Recurrence pattern (default none)"),
        description: z.string().optional().describe("Description of the exception"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/schedule/add-exception",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "removeWorkdayException",
      "Remove a workday exception from a project.",
      {
        exceptionId: z.string().describe("The exception UUID to remove"),
        projectId: z.string().describe("The project UUID"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/schedule/remove-exception",
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
