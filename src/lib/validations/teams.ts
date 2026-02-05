import { z } from "zod"
import { uuidSchema, nonEmptyString } from "./common"

// --- Create team ---

export const createTeamSchema = z.object({
  name: nonEmptyString.max(100, "Team name must be 100 characters or less"),
  description: z.string().max(500, "Description must be 500 characters or less").optional(),
})

export type CreateTeamInput = z.infer<typeof createTeamSchema>

// --- Update team ---

export const updateTeamSchema = z.object({
  id: uuidSchema,
  name: nonEmptyString.max(100, "Team name must be 100 characters or less").optional(),
  description: z.string().max(500, "Description must be 500 characters or less").optional(),
})

export type UpdateTeamInput = z.infer<typeof updateTeamSchema>

// --- Delete team ---

export const deleteTeamSchema = z.object({
  id: uuidSchema,
})

export type DeleteTeamInput = z.infer<typeof deleteTeamSchema>

// --- Create group ---

export const createGroupSchema = z.object({
  name: nonEmptyString.max(100, "Group name must be 100 characters or less"),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex code (e.g., #FF5733)")
    .optional(),
})

export type CreateGroupInput = z.infer<typeof createGroupSchema>

// --- Update group ---

export const updateGroupSchema = z.object({
  id: uuidSchema,
  name: nonEmptyString.max(100, "Group name must be 100 characters or less").optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex code (e.g., #FF5733)")
    .optional(),
})

export type UpdateGroupInput = z.infer<typeof updateGroupSchema>

// --- Delete group ---

export const deleteGroupSchema = z.object({
  id: uuidSchema,
})

export type DeleteGroupInput = z.infer<typeof deleteGroupSchema>

// --- Create organization ---

export const createOrganizationSchema = z.object({
  name: nonEmptyString.max(200, "Organization name must be 200 characters or less"),
  type: z.string().optional(),
})

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>

// --- Update organization ---

export const updateOrganizationSchema = z.object({
  id: uuidSchema,
  name: nonEmptyString.max(200, "Organization name must be 200 characters or less").optional(),
  type: z.string().optional(),
})

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>
