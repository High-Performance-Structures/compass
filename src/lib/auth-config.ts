export function isWorkOSConfigured(): boolean {
  const apiKey = process.env.WORKOS_API_KEY ?? ""
  const clientId = process.env.WORKOS_CLIENT_ID ?? ""

  return (
    apiKey.length > 0 &&
    clientId.length > 0 &&
    !apiKey.includes("placeholder") &&
    !clientId.includes("placeholder")
  )
}

export function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV === "development"
}

export function isE2ETest(): boolean {
  return process.env.COMPASS_E2E === "true"
}

export function isDevAuthFallbackAllowed(): boolean {
  return (
    (isLocalDevelopment() || isE2ETest()) &&
    !isWorkOSConfigured()
  )
}
