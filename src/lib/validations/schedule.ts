import { z } from "zod"
import { uuidSchema, nonEmptyString, dateStringSchema, positiveIntSchema } from "./common"

// --- Task status ---

export const taskStatuses = [
  "not_started",
  "in_progress",
  "completed",
  "on_hold",
  "cancelled",
] as const

export type TaskStatus = (typeof taskStatuses)[number]

export const taskStatusSchema = z.enum(taskStatuses, {
  message: "Please select a valid task status",
})

// --- Create task ---

export const createTaskSchema = z.object({
  projectId: uuidSchema,
  name: nonEmptyString.max(200, "Task name must be 200 characters or less"),
  description: z.string().max(2000, "Description must be 2000 characters or less").optional(),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  status: taskStatusSchema.default("not_started"),
  assigneeId: uuidSchema.optional(),
  parentTaskId: uuidSchema.optional(),
  sortOrder: z.number().int().nonnegative().optional(),
}).refine(
  (data) => new Date(data.startDate) <= new Date(data.endDate),
  {
    message: "End date must be on or after start date",
    path: ["endDate"],
  }
)

export type CreateTaskInput = z.infer<typeof createTaskSchema>

// --- Update task ---

export const updateTaskSchema = z.object({
  id: uuidSchema,
  name: nonEmptyString.max(200, "Task name must be 200 characters or less").optional(),
  description: z.string().max(2000, "Description must be 2000 characters or less").optional(),
  startDate: dateStringSchema.optional(),
  endDate: dateStringSchema.optional(),
  status: taskStatusSchema.optional(),
  assigneeId: uuidSchema.nullable().optional(),
  parentTaskId: uuidSchema.nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
})

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>

// --- Delete task ---

export const deleteTaskSchema = z.object({
  id: uuidSchema,
})

export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>

// --- Bulk update tasks ---

export const bulkUpdateTasksSchema = z.object({
  projectId: uuidSchema,
  tasks: z.array(z.object({
    id: uuidSchema,
    startDate: dateStringSchema.optional(),
    endDate: dateStringSchema.optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  })),
})

export type BulkUpdateTasksInput = z.infer<typeof bulkUpdateTasksSchema>

// --- Create baseline ---

export const createBaselineSchema = z.object({
  projectId: uuidSchema,
  name: nonEmptyString.max(100, "Baseline name must be 100 characters or less"),
  description: z.string().max(500, "Description must be 500 characters or less").optional(),
})

export type CreateBaselineInput = z.infer<typeof createBaselineSchema>

// --- Delete baseline ---

export const deleteBaselineSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
})

export type DeleteBaselineInput = z.infer<typeof deleteBaselineSchema>

// --- Workday exception ---

export const workdayExceptionTypes = ["holiday", "non_working", "working"] as const

export type WorkdayExceptionType = (typeof workdayExceptionTypes)[number]

export const createWorkdayExceptionSchema = z.object({
  projectId: uuidSchema,
  date: dateStringSchema,
  type: z.enum(workdayExceptionTypes, {
    message: "Please select a valid exception type",
  }),
  name: nonEmptyString.max(100, "Name must be 100 characters or less").optional(),
})

export type CreateWorkdayExceptionInput = z.infer<typeof createWorkdayExceptionSchema>

export const deleteWorkdayExceptionSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
})

export type DeleteWorkdayExceptionInput = z.infer<typeof deleteWorkdayExceptionSchema>
