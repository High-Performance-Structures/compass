import { z } from "zod"

import { USER_ROLES } from "@/lib/domain/identity/statuses"

// --- Primitive schemas ---

export const emailSchema = z
  .string()
  .min(1, "Email address is required")
  .email("Please enter a valid email address")

// Compass contains both UUIDs and stable legacy/source identifiers such as
// `org-1` and WorkOS-style `user_...` values. Use this schema when validating
// an existing database record ID rather than a value that must be a UUID.
export const databaseIdSchema = z
  .string()
  .trim()
  .min(1, "Identifier is required")
  .max(255, "Identifier is too long")
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Invalid identifier format")

export const nonEmptyString = z
  .string()
  .min(1, "This field is required")

// --- User roles ---

const userRoles = USER_ROLES

export const userRoleSchema = z.enum(userRoles, {
  message: "Please select a valid role",
})
