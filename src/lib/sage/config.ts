export type SageConnectionMode = "sql-server"

export type SageBridgeStatus = {
  readonly configured: boolean
  readonly readOnly: boolean
  readonly mode: SageConnectionMode
  readonly missingConfigKeys: readonly string[]
  readonly requiredConfigKeys: readonly string[]
  readonly message: string
}

const REQUIRED_SAGE_CONFIG_KEYS = [
  "SAGE_SQL_SERVER",
  "SAGE_SQL_DATABASE",
  "SAGE_SQL_USER",
  "SAGE_SQL_PASSWORD",
] as const

function readEnv(
  env: Record<string, string | undefined>,
  key: string
): string | undefined {
  const value = env[key] ?? process.env[key]
  return value && value.trim().length > 0 ? value : undefined
}

export function getSageBridgeStatus(
  env: Record<string, string | undefined>
): SageBridgeStatus {
  const missingConfigKeys = REQUIRED_SAGE_CONFIG_KEYS.filter(
    (key) => !readEnv(env, key)
  )
  const readOnly = readEnv(env, "SAGE_READ_ONLY") !== "false"
  const configured = missingConfigKeys.length === 0

  return {
    configured,
    readOnly,
    mode: "sql-server",
    missingConfigKeys,
    requiredConfigKeys: REQUIRED_SAGE_CONFIG_KEYS,
    message: configured
      ? readOnly
        ? "Sage bridge is configured for read-only sync."
        : "Sage bridge is configured; writes still require explicit Compass confirmation."
      : "Sage bridge is waiting on server/database credentials.",
  }
}
