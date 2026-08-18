import { z } from "zod"

/**
 * Schema for identity details managed by the signed-in user.
 */
export const updateProfileSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required")
    .max(100, "First name must be 100 characters or less"),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required")
    .max(100, "Last name must be 100 characters or less"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address")
    .max(320, "Email must be 320 characters or less"),
  phone: z
    .string()
    .max(50, "Phone number must be 50 characters or less")
    .trim(),
  address: z
    .string()
    .max(500, "Address must be 500 characters or less")
    .trim(),
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>

/**
 * Schema for changing password
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(72, "Password must be 72 characters or less"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
