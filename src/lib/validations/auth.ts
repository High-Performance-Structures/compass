import { z } from "zod"
import { emailSchema } from "./common"

// --- Login ---

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
})

export type LoginInput = z.infer<typeof loginSchema>

// --- New passwords and accounts ---

/**
 * The rule for every new or reset password. The sign-up, invitation and
 * set-password forms check it in the browser, and the auth API routes check
 * it again on the server, so the two can never disagree.
 */
export const newPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")

export const firstNameSchema = z
  .string()
  .min(1, "First name is required")
  .max(50, "First name must be 50 characters or less")

export const lastNameSchema = z
  .string()
  .min(1, "Last name is required")
  .max(50, "Last name must be 50 characters or less")

/** A password typed twice: the "Confirm password" box must match. */
const passwordsMatch = (data: { readonly password: string; readonly confirmPassword: string }): boolean =>
  data.password === data.confirmPassword
const PASSWORDS_MATCH_ERROR = { message: "Passwords do not match", path: ["confirmPassword"] }

// --- Signup ---

export const signupSchema = z
  .object({
    email: emailSchema,
    firstName: firstNameSchema,
    lastName: lastNameSchema,
    password: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine(passwordsMatch, PASSWORDS_MATCH_ERROR)

export type SignupInput = z.infer<typeof signupSchema>

// --- Accepting an invitation (the email comes from the invitation) ---

export const acceptInviteSchema = z
  .object({
    firstName: firstNameSchema,
    lastName: lastNameSchema,
    password: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine(passwordsMatch, PASSWORDS_MATCH_ERROR)

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>

// --- Setting a new password from a reset link ---

export const setPasswordSchema = z
  .object({ password: newPasswordSchema, confirmPassword: z.string() })
  .refine(passwordsMatch, PASSWORDS_MATCH_ERROR)

export type SetPasswordInput = z.infer<typeof setPasswordSchema>
