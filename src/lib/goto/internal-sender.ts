import { normalizedSmsPhoneKey } from "@/lib/goto/numbers"
import { isInternalStaffRole } from "@/lib/user-roles"

export type InternalSmsSenderCandidate = Readonly<{
  readonly role: string
  readonly profilePhone: string | null
  readonly smsPhoneNumber: string | null
}>

export function isKnownInternalSmsSender(
  senderPhone: string,
  candidates: readonly InternalSmsSenderCandidate[]
): boolean {
  const senderKey = normalizedSmsPhoneKey(senderPhone)
  if (senderKey === null) return false

  return candidates.some((candidate) => {
    if (!isInternalStaffRole(candidate.role)) return false
    return [candidate.profilePhone, candidate.smsPhoneNumber].some(
      (phoneNumber) =>
        phoneNumber !== null &&
        normalizedSmsPhoneKey(phoneNumber) === senderKey
    )
  })
}
