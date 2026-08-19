import {
  normalizedSmsPhoneKey,
  normalizeSmsPhoneNumber,
} from "@/lib/goto/numbers"

function validPhone(value: string): string | null {
  return normalizedSmsPhoneKey(value) === null
    ? null
    : normalizeSmsPhoneNumber(value)
}

export function gotoConversationDeleteUrl(input: {
  readonly ownerPhoneNumber: string
  readonly contactPhoneNumber: string
}): URL | null {
  const ownerPhoneNumber = validPhone(input.ownerPhoneNumber)
  const contactPhoneNumber = validPhone(input.contactPhoneNumber)
  if (!ownerPhoneNumber || !contactPhoneNumber) return null

  const url = new URL("https://api.goto.com/messaging/v1/conversations")
  url.searchParams.set("ownerPhoneNumber", ownerPhoneNumber)
  url.searchParams.set("contactPhoneNumber", contactPhoneNumber)
  return url
}
