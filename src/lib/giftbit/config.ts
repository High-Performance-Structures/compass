import "server-only"

export type GiftbitEnvironment = "testbed" | "production"

export type GiftbitConfig = {
  readonly apiKey: string
  readonly environment: GiftbitEnvironment
  readonly baseUrl: string
  readonly orderingEnabled: boolean
}

export type GiftbitConfigResult =
  | { readonly success: true; readonly data: GiftbitConfig }
  | { readonly success: false; readonly error: string }

const GIFTBIT_BASE_URLS: Readonly<Record<GiftbitEnvironment, string>> = {
  testbed: "https://api-testbed.giftbit.com/papi/v1",
  production: "https://api.giftbit.com/papi/v1",
}

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

export function getGiftbitConfig(env: object): GiftbitConfigResult {
  const apiKey = environmentString(env, "GIFTBIT_API_KEY")
  if (!apiKey) {
    return {
      success: false,
      error: "Giftbit is not configured. Missing: GIFTBIT_API_KEY.",
    }
  }

  const configuredEnvironment =
    environmentString(env, "GIFTBIT_ENVIRONMENT") ?? "testbed"
  if (
    configuredEnvironment !== "testbed" &&
    configuredEnvironment !== "production"
  ) {
    return {
      success: false,
      error: "GIFTBIT_ENVIRONMENT must be testbed or production.",
    }
  }

  return {
    success: true,
    data: {
      apiKey,
      environment: configuredEnvironment,
      baseUrl: GIFTBIT_BASE_URLS[configuredEnvironment],
      orderingEnabled:
        environmentString(env, "GIFTBIT_ORDERING_ENABLED") === "true",
    },
  }
}
