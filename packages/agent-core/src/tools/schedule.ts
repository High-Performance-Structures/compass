import { z } from "zod"
import type { DataSource } from "../types"
import type { ToolDef } from "./data"
import { zodToJsonSchema } from "./data"

const getScheduleSchema = z.object({
  projectId: z.string().describe("The project UUID"),
})

const createTaskSchema = z.object({
  projectId: z.string().describe("The project UUID"),
  title: z.string().describe("Task title"),
  startDate: z
    .string()
    .describe("Start date in YYYY-MM-DD format"),
  workdays: z.number().describe("Duration in working days"),
  phase: z
    .string()
    .describe(
      "Construction phase (preconstruction, sitework, " +
        "foundation, framing, roofing, electrical, plumbing, " +
        "hvac, insulation, drywall, finish, landscaping, " +
        "closeout)"
    ),
  isMilestone: z
    .boolean()
    .optional()
    .describe("Whether this is a milestone (0 workdays)"),
  percentComplete: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Initial percent complete (0-100)"),
  assignedTo: z
    .string()
    .optional()
    .describe("Name of the person assigned"),
})

const updateTaskSchema = z.object({
  taskId: z.string().describe("The task UUID"),
  title: z.string().optional().describe("New title"),
  startDate: z
    .string()
    .optional()
    .describe("New start date (YYYY-MM-DD)"),
  workdays: z
    .number()
    .optional()
    .describe("New duration in working days"),
  phase: z.string().optional().describe("New phase"),
  status: z
    .enum(["PENDING", "IN_PROGRESS", "COMPLETE", "BLOCKED"])
    .optional()
    .describe("New status"),
  isMilestone: z
    .boolean()
    .optional()
    .describe("Set milestone flag"),
  percentComplete: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("New percent complete (0-100)"),
  assignedTo: z
    .string()
    .nullable()
    .optional()
    .describe("New assignee (null to unassign)"),
})

const deleteTaskSchema = z.object({
  taskId: z.string().describe("The task UUID to delete"),
})

const createDepSchema = z.object({
  projectId: z.string().describe("The project UUID"),
  predecessorId: z
    .string()
    .describe("UUID of the predecessor task"),
  successorId: z
    .string()
    .describe("UUID of the successor task"),
  type: z
    .enum(["FS", "SS", "FF", "SF"])
    .describe(
      "Dependency type: FS (finish-to-start), " +
        "SS (start-to-start), FF (finish-to-finish), " +
        "SF (start-to-finish)"
    ),
  lagDays: z
    .number()
    .optional()
    .describe("Lag in working days (default 0)"),
})

const deleteDepSchema = z.object({
  dependencyId: z
    .string()
    .describe("The dependency UUID to delete"),
  projectId: z
    .string()
    .describe("The project UUID (for revalidation)"),
})

const addExceptionSchema = z.object({
  projectId: z.string().describe("The project UUID"),
  date: z
    .string()
    .describe("Exception date in YYYY-MM-DD format"),
  category: z
    .enum(["holiday", "non_working", "extra_working"])
    .describe("Exception category"),
  recurrence: z
    .enum(["none", "annual", "weekly"])
    .optional()
    .describe("Recurrence pattern (default none)"),
  description: z
    .string()
    .optional()
    .describe("Description of the exception"),
})

const removeExceptionSchema = z.object({
  exceptionId: z
    .string()
    .describe("The exception UUID to remove"),
  projectId: z.string().describe("The project UUID"),
})

export function scheduleTools(
  dataSource: DataSource
): ToolDef[] {
  return [
    {
      name: "getProjectSchedule",
      description:
        "Get the full schedule for a project including tasks, " +
        "dependencies, workday exceptions, and a computed " +
        "summary (counts, overall %, critical path). Always " +
        "call this before making schedule mutations to resolve " +
        "task names to IDs.",
      input_schema: zodToJsonSchema(getScheduleSchema),
      run: async (input: unknown): Promise<string> => {
        const args = getScheduleSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/schedule/get",
          args
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "createScheduleTask",
      description:
        "Create a new task on a project schedule. Returns a " +
        "toast confirmation. Dates are ISO format (YYYY-MM-DD).",
      input_schema: zodToJsonSchema(createTaskSchema),
      run: async (input: unknown): Promise<string> => {
        const args = createTaskSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/schedule/create",
          args
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "updateScheduleTask",
      description:
        "Update an existing schedule task. Provide only the " +
        "fields to change. Use getProjectSchedule first to " +
        "resolve task names to IDs.",
      input_schema: zodToJsonSchema(updateTaskSchema),
      run: async (input: unknown): Promise<string> => {
        const args = updateTaskSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/schedule/update",
          args
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "deleteScheduleTask",
      description:
        "Delete a schedule task. Always confirm with the user " +
        "before deleting. This also removes any dependencies " +
        "involving the task.",
      input_schema: zodToJsonSchema(deleteTaskSchema),
      run: async (input: unknown): Promise<string> => {
        const args = deleteTaskSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/schedule/delete",
          args
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "createScheduleDependency",
      description:
        "Create a dependency between two tasks. Has built-in " +
        "cycle detection. Use getProjectSchedule first to " +
        "resolve task names to IDs.",
      input_schema: zodToJsonSchema(createDepSchema),
      run: async (input: unknown): Promise<string> => {
        const args = createDepSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/schedule/create-dependency",
          args
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "deleteScheduleDependency",
      description:
        "Delete a dependency between tasks. Use " +
        "getProjectSchedule first to find the dependency ID.",
      input_schema: zodToJsonSchema(deleteDepSchema),
      run: async (input: unknown): Promise<string> => {
        const args = deleteDepSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/schedule/delete-dependency",
          args
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "addWorkdayException",
      description:
        "Add a workday exception to a project (holiday, " +
        "non-working day, or extra working day).",
      input_schema: zodToJsonSchema(addExceptionSchema),
      run: async (input: unknown): Promise<string> => {
        const args = addExceptionSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/schedule/add-exception",
          args
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "removeWorkdayException",
      description:
        "Remove a workday exception from a project.",
      input_schema: zodToJsonSchema(removeExceptionSchema),
      run: async (input: unknown): Promise<string> => {
        const args = removeExceptionSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/schedule/remove-exception",
          args
        )
        return JSON.stringify(result)
      },
    },
  ]
}
