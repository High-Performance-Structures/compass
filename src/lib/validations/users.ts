import { z } from "zod"
import { emailSchema, uuidSchema, userRoleSchema, nonEmptyString } from "./common"

// --- Update user role ---

export const updateUserRoleSchema = z.object({
  userId: uuidSchema,
  role: userRoleSchema,
})

export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>

// --- Deactivate user ---

export const deactivateUserSchema = z.object({
  userId: uuidSchema,
})

export type DeactivateUserInput = z.infer<typeof deactivateUserSchema>

// --- Invite user ---

export const inviteUserSchema = z.object({
  email: emailSchema,
  role: userRoleSchema,
  organizationId: uuidSchema.optional(),
})

export type InviteUserInput = z.infer<typeof inviteUserSchema>

// --- Assign user to project ---

export const assignUserToProjectSchema = z.object({
  userId: uuidSchema,
  projectId: uuidSchema,
  role: nonEmptyString,
})

export type AssignUserToProjectInput = z.infer<typeof assignUserToProjectSchema>

// --- Assign user to team ---

export const assignUserToTeamSchema = z.object({
  userId: uuidSchema,
  teamId: uuidSchema,
})

export type AssignUserToTeamInput = z.infer<typeof assignUserToTeamSchema>

// --- Assign user to group ---

export const assignUserToGroupSchema = z.object({
  userId: uuidSchema,
  groupId: uuidSchema,
})

export type AssignUserToGroupInput = z.infer<typeof assignUserToGroupSchema>

// --- Remove user from team ---

export const removeUserFromTeamSchema = z.object({
  userId: uuidSchema,
  teamId: uuidSchema,
})

export type RemoveUserFromTeamInput = z.infer<typeof removeUserFromTeamSchema>

// --- Remove user from group ---

export const removeUserFromGroupSchema = z.object({
  userId: uuidSchema,
  groupId: uuidSchema,
})

export type RemoveUserFromGroupInput = z.infer<typeof removeUserFromGroupSchema>
