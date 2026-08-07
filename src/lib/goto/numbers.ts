const DEFAULT_GOTO_ORC_FROM_NUMBER = "+17196308767"
const DEFAULT_GOTO_NUTECH_FROM_NUMBER = "+17196860770"
const DEFAULT_GOTO_HPS_FROM_NUMBER = "+17199008850"

function envString(env: unknown, key: string): string | null {
  if (typeof env !== "object" || env === null) return process.env[key] ?? null
  const value = Reflect.get(env, key)
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : process.env[key] ?? null
}

export function normalizeSmsPhoneNumber(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith("+")) return `+${trimmed.replace(/\D/g, "")}`

  const digits = trimmed.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return `+${digits}`
}

export function gotoSmsOwnerNumbers(env: unknown): readonly string[] {
  const configured = [
    envString(env, "GOTO_SMS_FROM_NUMBER") ?? DEFAULT_GOTO_ORC_FROM_NUMBER,
    envString(env, "GOTO_SMS_ORC_FROM_NUMBER") ?? DEFAULT_GOTO_ORC_FROM_NUMBER,
    envString(env, "GOTO_SMS_NUTECH_FROM_NUMBER") ?? DEFAULT_GOTO_NUTECH_FROM_NUMBER,
    envString(env, "GOTO_SMS_HPS_FROM_NUMBER") ?? DEFAULT_GOTO_HPS_FROM_NUMBER,
  ].map(normalizeSmsPhoneNumber)

  return [...new Set(configured)]
}

export function gotoSenderNumberForProject(
  env: unknown,
  projectNumber: string | null
): string {
  const prefix = projectNumber?.trim().charAt(0).toUpperCase()
  if (prefix === "N") {
    return normalizeSmsPhoneNumber(
      envString(env, "GOTO_SMS_NUTECH_FROM_NUMBER") ??
        DEFAULT_GOTO_NUTECH_FROM_NUMBER
    )
  }
  if (prefix === "H") {
    return normalizeSmsPhoneNumber(
      envString(env, "GOTO_SMS_HPS_FROM_NUMBER") ?? DEFAULT_GOTO_HPS_FROM_NUMBER
    )
  }
  if (prefix === "O" || prefix === "D") {
    return normalizeSmsPhoneNumber(
      envString(env, "GOTO_SMS_ORC_FROM_NUMBER") ?? DEFAULT_GOTO_ORC_FROM_NUMBER
    )
  }
  return normalizeSmsPhoneNumber(
    envString(env, "GOTO_SMS_FROM_NUMBER") ?? DEFAULT_GOTO_ORC_FROM_NUMBER
  )
}
