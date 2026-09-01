import "server-only"

export type HandwryttenConfig = {
  readonly apiKey: string
  readonly fontLabel: string
  readonly sender: {
    readonly firstName: string
    readonly lastName: string
    readonly businessName: string
    readonly address1: string
    readonly address2: string
    readonly city: string
    readonly state: string
    readonly postalCode: string
    readonly country: "United States"
  }
}

export type HandwryttenConfigResult =
  | { readonly success: true; readonly data: HandwryttenConfig }
  | { readonly success: false; readonly missingKeys: readonly string[] }

const REQUIRED_CONFIG_KEYS = [
  "HANDWRYTTEN_API_KEY",
  "HANDWRYTTEN_SENDER_BUSINESS_NAME",
  "HANDWRYTTEN_SENDER_ADDRESS1",
  "HANDWRYTTEN_SENDER_CITY",
  "HANDWRYTTEN_SENDER_STATE",
  "HANDWRYTTEN_SENDER_POSTAL_CODE",
] as const

function environmentString(env: object, key: string): string | null {
  const value: unknown = Reflect.get(env, key)
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim()
  }

  const processValue = process.env[key]
  return typeof processValue === "string" && processValue.trim().length > 0
    ? processValue.trim()
    : null
}

export function getHandwryttenConfig(env: object): HandwryttenConfigResult {
  const values = new Map<string, string>()
  const missingKeys: string[] = []

  for (const key of REQUIRED_CONFIG_KEYS) {
    const value = environmentString(env, key)
    if (value) values.set(key, value)
    else missingKeys.push(key)
  }

  if (missingKeys.length > 0) {
    return { success: false, missingKeys }
  }

  function requiredValue(key: (typeof REQUIRED_CONFIG_KEYS)[number]): string {
    return values.get(key) ?? ""
  }

  return {
    success: true,
    data: {
      apiKey: requiredValue("HANDWRYTTEN_API_KEY"),
      fontLabel:
        environmentString(env, "HANDWRYTTEN_FONT_LABEL") ?? "Casual David",
      sender: {
        firstName:
          environmentString(env, "HANDWRYTTEN_SENDER_FIRST_NAME") ?? "",
        lastName:
          environmentString(env, "HANDWRYTTEN_SENDER_LAST_NAME") ?? "",
        businessName: requiredValue("HANDWRYTTEN_SENDER_BUSINESS_NAME"),
        address1: requiredValue("HANDWRYTTEN_SENDER_ADDRESS1"),
        address2:
          environmentString(env, "HANDWRYTTEN_SENDER_ADDRESS2") ?? "",
        city: requiredValue("HANDWRYTTEN_SENDER_CITY"),
        state: requiredValue("HANDWRYTTEN_SENDER_STATE").toUpperCase(),
        postalCode: requiredValue("HANDWRYTTEN_SENDER_POSTAL_CODE"),
        country: "United States",
      },
    },
  }
}
