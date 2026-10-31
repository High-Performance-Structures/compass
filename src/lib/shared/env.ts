import { cleanText, field } from "@/lib/shared/guards"

/**
 * Reads a configured string from the Worker environment, then from
 * process.env (local development and tests). Use this instead of casting
 * the Worker env to a string record (architecture standard, section 4).
 */
export function envString(env: unknown, key: string): string | null {
  return cleanText(field(env, key)) ?? cleanText(process.env[key])
}

/** A boolean flag: "1", "true", "yes", or "on" (any case) is true. */
export function envFlag(env: unknown, key: string): boolean {
  const value = envString(env, key)
  return value !== null && ["1", "true", "yes", "on"].includes(value.toLowerCase())
}
