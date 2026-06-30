import { z } from "zod"
import { emailSchema, userRoleSchema, nonEmptyString } from "./common"

const textIdSchema = nonEmptyString

// --- Update user role ---

export const updateUserRoleSchema = z.object({
  userId: textIdSchema,
  role: userRoleSchema,
})

export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>

// --- Deactivate user ---

export const deactivateUserSchema = z.object({
  userId: textIdSchema,
})

export type DeactivateUserInput = z.infer<typeof deactivateUserSchema>

// --- Invite user ---

export const inviteUserSchema = z.object({
  email: emailSchema,
  role: userRoleSchema,
  organizationId: textIdSchema.optional(),
})

export type InviteUserInput = z.infer<typeof inviteUserSchema>

// --- Assign user to project ---

export const assignUserToProjectSchema = z.object({
  userId: textIdSchema,
  projectId: textIdSchema,
  role: nonEmptyString,
})

export type AssignUserToProjectInput = z.infer<typeof assignUserToProjectSchema>

// --- Assign user to team ---

export const assignUserToTeamSchema = z.object({
  userId: textIdSchema,
  teamId: textIdSchema,
})

export type AssignUserToTeamInput = z.infer<typeof assignUserToTeamSchema>

// --- Assign user to group ---

export const assignUserToGroupSchema = z.object({
  userId: textIdSchema,
  groupId: textIdSchema,
})

export type AssignUserToGroupInput = z.infer<typeof assignUserToGroupSchema>

// --- Remove user from team ---

export const removeUserFromTeamSchema = z.object({
  userId: textIdSchema,
  teamId: textIdSchema,
})

export type RemoveUserFromTeamInput = z.infer<typeof removeUserFromTeamSchema>

// --- Remove user from group ---

export const removeUserFromGroupSchema = z.object({
  userId: textIdSchema,
  groupId: textIdSchema,
})

export type RemoveUserFromGroupInput = z.infer<typeof removeUserFromGroupSchema>
