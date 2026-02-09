import type { BridgeConfig } from "./config"

interface RegisterUser {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly role: string
}

interface RegisterTool {
  readonly name: string
  readonly description: string
  readonly scope: string
}

export interface RegisterResult {
  readonly user: RegisterUser
  readonly tools: ReadonlyArray<RegisterTool>
  readonly memories: string
  readonly dashboards: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly description: string
  }>
  readonly skills: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly enabled: boolean
  }>
}

export async function registerWithCompass(
  config: BridgeConfig,
): Promise<RegisterResult> {
  const url = `${config.compassUrl}/api/bridge/register`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `Registration failed (${res.status}): ${body}`,
    )
  }

  return res.json() as Promise<RegisterResult>
}

export async function refreshContext(
  config: BridgeConfig,
): Promise<{
  readonly memories: string
  readonly dashboards: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly description: string
  }>
  readonly skills: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly enabled: boolean
  }>
}> {
  const url = `${config.compassUrl}/api/bridge/context`
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  })

  if (!res.ok) {
    throw new Error(
      `Context refresh failed (${res.status})`,
    )
  }

  return res.json()
}
