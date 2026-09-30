import { isValidRecipientEmail, normalizeRecipientEmail } from "./recipient-options"

export type ProjectEmailAudience = {
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly bcc: readonly string[]
}

export type ValidatedProjectEmailAudience =
  | { readonly success: true; readonly data: ProjectEmailAudience }
  | { readonly success: false; readonly error: string }

export function validateProjectEmailAudience(input: ProjectEmailAudience): ValidatedProjectEmailAudience {
  if (!Array.isArray(input.to) || !Array.isArray(input.cc) || !Array.isArray(input.bcc)) {
    return { success: false, error: "Choose the email recipients." }
  }
  const to = input.to.map(normalizeRecipientEmail)
  const cc = input.cc.map(normalizeRecipientEmail)
  const bcc = input.bcc.map(normalizeRecipientEmail)
  const all = [...to, ...cc, ...bcc]
  if (to.length === 0) return { success: false, error: "Choose at least one To recipient." }
  if (all.length > 50) return { success: false, error: "Choose no more than 50 email recipients." }
  if (all.some((email) => email.length > 254 || !isValidRecipientEmail(email))) {
    return { success: false, error: "Review the email addresses; one or more are invalid." }
  }
  if (new Set(all).size !== all.length) {
    return { success: false, error: "Each email address may appear in To, Cc, or Bcc only once." }
  }
  return { success: true, data: { to, cc, bcc } }
}

export function projectReplyAddressHasToken(toAddress: string | null, token: string): boolean {
  if (!toAddress || !/^[a-z0-9-]{15,80}$/.test(token)) return false
  return toAddress.toLowerCase().includes(`+${token.toLowerCase()}@`)
}
