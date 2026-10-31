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

// --- Deactivate user ---

export const deactivateUserSchema = z.object({
  userId: databaseIdSchema,
})

// --- Invite user ---

export const inviteUserSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120, "Name is too long")
    .optional(),
  email: emailSchema,
  role: userRoleSchema,
  organizationId: databaseIdSchema.optional(),
})

// --- Assign user to project ---

export const assignUserToProjectSchema = z.object({
  userId: databaseIdSchema,
  projectId: databaseIdSchema,
  role: nonEmptyString,
})
