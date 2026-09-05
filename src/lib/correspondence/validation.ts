import { z } from "zod/v4"

export function parseCorrespondenceSend(value: unknown): { readonly success: true; readonly data: import("./types").SendCorrespondenceInput } | { readonly success: false; readonly error: string } {
  const schema = z.object({
    projectId: z.string().min(1).max(200),
    conversationId: z.string().min(1).max(200).nullable(),
    subject: z.string().trim().min(1).max(200),
    body: z.string().min(1).max(50000).refine((body) => body.trim().length > 0),
    recipientUserIds: z.array(z.string().min(1).max(200)).min(1).max(30),
    attachmentIds: z.array(z.string().min(1).max(200)).max(10),
    idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/),
    participantVersion: z.number().int().positive().nullable(),
  }).strict()
  const result = schema.safeParse(value)
  return result.success ? { success: true, data: result.data } : { success: false, error: "Check the subject, message, recipients, and attachments before sending." }
}
