import { z } from "zod"

// --- Primitive schemas ---

export const emailSchema = z
  .string()
  .min(1, "Email address is required")
  .email("Please enter a valid email address")

export const uuidSchema = z
  .string()
  .uuid("Invalid identifier format")

export const nonEmptyString = z
  .string()
  .min(1, "This field is required")

export const optionalString = z
  .string()
  .optional()
  .transform((val) => val || undefined)

// --- User roles ---

export const userRoles = [
  "admin",
  "executive",
  "accounting",
  "project_manager",
  "coordinator",
  "office",
] as const

export type UserRole = (typeof userRoles)[number]

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
