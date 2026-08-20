import { z } from "zod"
import {
  databaseIdSchema,
  emailSchema,
  userRoleSchema,
  nonEmptyString,
} from "./common"

// --- Update user role ---

export const updateUserRoleSchema = z.object({
  userId: databaseIdSchema,
  role: userRoleSchema,
})

export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>

// --- Deactivate user ---

export const deactivateUserSchema = z.object({
  userId: databaseIdSchema,
})

export type DeactivateUserInput = z.infer<typeof deactivateUserSchema>

// --- Invite user ---

export const inviteUserSchema = z.object({
  email: emailSchema,
  role: userRoleSchema,
  organizationId: databaseIdSchema.optional(),
})

export type InviteUserInput = z.infer<typeof inviteUserSchema>

// --- Assign user to project ---

export const assignUserToProjectSchema = z.object({
  userId: databaseIdSchema,
  projectId: databaseIdSchema,
  role: nonEmptyString,
})

export type AssignUserToProjectInput = z.infer<typeof assignUserToProjectSchema>

// --- Assign user to team ---

export const assignUserToTeamSchema = z.object({
  userId: databaseIdSchema,
  teamId: databaseIdSchema,
})

export type AssignUserToTeamInput = z.infer<typeof assignUserToTeamSchema>

// --- Assign user to group ---

export const assignUserToGroupSchema = z.object({
  userId: databaseIdSchema,
  groupId: databaseIdSchema,
})

export type AssignUserToGroupInput = z.infer<typeof assignUserToGroupSchema>

// --- Remove user from team ---

export const removeUserFromTeamSchema = z.object({
  userId: databaseIdSchema,
  teamId: databaseIdSchema,
})

export type RemoveUserFromTeamInput = z.infer<typeof removeUserFromTeamSchema>

// --- Remove user from group ---

export const removeUserFromGroupSchema = z.object({
  userId: databaseIdSchema,
  groupId: databaseIdSchema,
})

export type RemoveUserFromGroupInput = z.infer<typeof removeUserFromGroupSchema>
