import { z } from "zod"
import { uuidSchema } from "./common"

const inviteCodeRegex = /^[a-z0-9]+-[23456789abcdefghjkmnpqrstuvwxyz]{6}$/

const orgRoles = ["admin", "office", "field", "client"] as const

export const createInviteSchema = z.object({
  role: z.enum(orgRoles, { message: "Please select a valid role" }),
  maxUses: z.number().int().positive().optional(),
  expiresAt: z
    .string()
    .refine(
      (val) => !Number.isNaN(Date.parse(val)),
      "Please enter a valid date"
    )
    .optional(),
})

export type CreateInviteInput = z.infer<typeof createInviteSchema>

export const revokeInviteSchema = z.object({
  inviteId: uuidSchema,
})

export type RevokeInviteInput = z.infer<typeof revokeInviteSchema>

export const acceptInviteSchema = z.object({
  code: z.string().regex(inviteCodeRegex, "Invalid invite code format"),
})

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>
