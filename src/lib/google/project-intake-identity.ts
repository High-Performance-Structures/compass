export function resolveProjectIntakeIntegrationEmail(input: {
  readonly connectorGoogleEmail: string | null
  readonly connectorEmail: string | null
}): string {
  const email = input.connectorGoogleEmail ?? input.connectorEmail
  const normalized = email?.trim()
  if (!normalized) {
    throw new Error(
      "Google Workspace project-tracker integration has no connector identity."
    )
  }
  return normalized
}
