import type { GotoInboundMessage } from "@/lib/goto/notification-parser"
import {
  gotoSmsOwnerNumbers,
  normalizeSmsPhoneNumber,
} from "@/lib/goto/numbers"

export type GotoWebhookConfig = {
  readonly secret: string
  readonly organizationId: string
  readonly ownerNumbers: readonly string[]
}

function envString(env: unknown, key: string): string | null {
  if (typeof env !== "object" || env === null) return process.env[key] ?? null
  const value = Reflect.get(env, key)
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : process.env[key] ?? null
}

export function gotoWebhookConfig(env: unknown): GotoWebhookConfig | null {
  const secret = envString(env, "GOTO_WEBHOOK_SECRET")
  const organizationId = envString(env, "JARVIS_BRIDGE_ORGANIZATION_ID")
  if (!secret || !organizationId) return null

  return {
    secret,
    organizationId,
    ownerNumbers: gotoSmsOwnerNumbers(env),
  }
}

export function constantTimeSecretMatch(
  expected: string,
  supplied: string | null
): boolean {
  if (supplied === null || expected.length !== supplied.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index)
  }
  return difference === 0
}

export function gotoMessageMatchesConfig(
  message: GotoInboundMessage,
  config: GotoWebhookConfig,
  accountKey: string
): boolean {
  if (message.accountKey !== accountKey) return false
  const ownerNumber = normalizeSmsPhoneNumber(message.ownerTouchpoint)
  return config.ownerNumbers.includes(ownerNumber)
}
