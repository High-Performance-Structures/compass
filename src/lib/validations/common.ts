import { z } from "zod"

import { USER_ROLES, type UserRole } from "@/lib/user-roles"

// --- Primitive schemas ---

export const emailSchema = z
  .string()
  .min(1, "Email address is required")
  .email("Please enter a valid email address")

export const uuidSchema = z
  .string()
  .uuid("Invalid identifier format")

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

export const optionalString = z
  .string()
  .optional()
  .transform((val) => val || undefined)

// --- User roles ---

export const userRoles = USER_ROLES

export type { UserRole }

export const userRoleSchema = z.enum(userRoles, {
  message: "Please select a valid role",
})

// --- Pagination ---

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

// --- Date helpers ---

export const dateStringSchema = z
  .string()
  .refine(
    (val) => !Number.isNaN(Date.parse(val)),
    "Please enter a valid date"
  )

export const optionalDateSchema = z
  .string()
  .optional()
  .refine(
    (val) => !val || !Number.isNaN(Date.parse(val)),
    "Please enter a valid date"
  )

// --- Currency ---

export const currencySchema = z
  .number()
  .nonnegative("Amount cannot be negative")
  .multipleOf(0.01, "Amount must have at most 2 decimal places")

export const positiveIntSchema = z
  .number()
  .int("Must be a whole number")
  .positive("Must be greater than zero")
