import { z } from "zod"
import { emailSchema } from "./common"

// --- Login ---

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
})

export type LoginInput = z.infer<typeof loginSchema>

// --- Signup ---

export const signupSchema = z
  .object({
    email: emailSchema,
    firstName: z
      .string()
      .min(1, "First name is required")
      .max(50, "First name must be 50 characters or less"),
    lastName: z
      .string()
      .min(1, "Last name is required")
      .max(50, "Last name must be 50 characters or less"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

export type SignupInput = z.infer<typeof signupSchema>

// --- Password reset request ---

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
})

export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>

// --- Set new password ---

export const setPasswordSchema = z
  .object({
    token: z.string().min(1, "Reset token is required"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

export type SetPasswordInput = z.infer<typeof setPasswordSchema>

// --- Email verification ---

export const verifyEmailSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .min(1, "Verification code is required")
    .max(10, "Invalid verification code"),
})

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>

// --- Passwordless (magic link) ---

export const passwordlessSendSchema = z.object({
  email: emailSchema,
})

export const passwordlessVerifySchema = z.object({
  email: emailSchema,
  code: z.string().min(1, "Code is required"),
})

export type PasswordlessSendInput = z.infer<typeof passwordlessSendSchema>
export type PasswordlessVerifyInput = z.infer<typeof passwordlessVerifySchema>
