export const SMS_OPT_IN_DISCLOSURE_URL =
  "https://highperformancestructures.com/sms-opt-in-disclosure/"

export const SMS_OPT_IN_DISCLOSURE_VERSION = "2026-06-30"

export const SMS_OPT_IN_CONSENT_LABEL =
  "I agree to receive customer care and account notification text messages from High Performance Structures, Inc. related to my active projects or account. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help."

export function hasCurrentSmsConsent(input: {
  readonly accepted: boolean
  readonly phoneNumber: string | null
  readonly consentPhoneNumber: string | null
  readonly disclosureVersion: string | null
}): boolean {
  const phoneNumber = input.phoneNumber?.trim() ?? ""
  return (
    input.accepted &&
    phoneNumber.length > 0 &&
    input.consentPhoneNumber === phoneNumber &&
    input.disclosureVersion === SMS_OPT_IN_DISCLOSURE_VERSION
  )
}
