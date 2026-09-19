import { normalizedSmsPhoneKey } from "@/lib/goto/numbers"
import { hasCurrentSmsConsent } from "@/lib/notifications/sms-consent"
import { isInternalStaffRole } from "@/lib/user-roles"

export type InternalSmsSenderCandidate = Readonly<{
  readonly role: string
  readonly smsEnabled: boolean | null
  readonly smsPhoneNumber: string | null
  readonly smsConsentAccepted: boolean | null
  readonly smsConsentDisclosureVersion: string | null
  readonly smsConsentPhoneNumber: string | null
}>

export function isKnownInternalSmsSender(
  senderPhone: string,
  candidates: readonly InternalSmsSenderCandidate[]
): boolean {
  const senderKey = normalizedSmsPhoneKey(senderPhone)
  if (senderKey === null) return false

  return candidates.some((candidate) => {
    if (!isInternalStaffRole(candidate.role)) return false
    if (candidate.smsEnabled !== true) return false
    if (
      !hasCurrentSmsConsent({
        accepted: candidate.smsConsentAccepted === true,
        phoneNumber: candidate.smsPhoneNumber,
        consentPhoneNumber: candidate.smsConsentPhoneNumber,
        disclosureVersion: candidate.smsConsentDisclosureVersion,
      })
    ) {
      return false
    }
    return normalizedSmsPhoneKey(candidate.smsPhoneNumber ?? "") === senderKey
  })
}
