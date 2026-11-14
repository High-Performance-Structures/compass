import { z } from "zod/v4"

/*
 * Settings > Workflows > Email sender verification: whether a job email must
 * pass Gmail's check that it really came from the domain in its From address
 * (SPF, DKIM or DMARC) before its sender is trusted. A trusted sender's
 * subject tags create records and their @names notify people. Pure and
 * client-safe.
 */
export const EMAIL_SENDER_VERIFICATION_MODES = ["off", "record", "enforce"] as const

export type EmailSenderVerificationMode = (typeof EMAIL_SENDER_VERIFICATION_MODES)[number]

const emailSenderVerificationSettingsSchema = z.object({
  mode: z.enum(EMAIL_SENDER_VERIFICATION_MODES),
})

export type EmailSenderVerificationSettings = z.infer<typeof emailSenderVerificationSettingsSchema>

export const EMAIL_SENDER_VERIFICATION_MODE_LABELS: Record<EmailSenderVerificationMode, { readonly label: string; readonly description: string }> = {
  off: { label: "Off", description: "Compass doesn't check senders. A staff member's or contact's address is trusted as written." },
  record: { label: "Record only", description: "Compass notes in Activity whether each job email passed, and changes nothing. Use this to confirm your staff and regular vendors pass before enforcing." },
  enforce: { label: "Enforce", description: "An email that fails the check is still posted to the job's Messages, marked as unverified, but its subject tags don't create records and its @names don't notify anyone." },
}

export const EMAIL_SENDER_VERIFICATION_SETTINGS_GROUP = {
  label: "Email sender verification",
  description: "Whether a job email must pass Gmail's check that it really came from the sender's domain before Compass trusts it. Replies to Compass's own emails are always recognized by their reply code.",
  defaults: { mode: "record" } satisfies EmailSenderVerificationSettings,
  schema: emailSenderVerificationSettingsSchema,
  // Which senders Compass trusts is the owner's to change.
  editorRoles: new Set(["admin"]),
}
