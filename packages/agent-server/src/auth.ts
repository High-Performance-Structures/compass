/**
 * JWT authentication for agent server
 * Validates tokens signed with HS256 and extracts user context
 */

import { jwtVerify } from "jose"
import { config } from "./config"

export interface ProviderConfig {
  type: string // anthropic-oauth | anthropic-key | openrouter | ollama | custom
  apiKey?: string
  baseUrl?: string
  modelOverrides?: Record<string, string> // { sonnet?: string, opus?: string, haiku?: string }
}

export interface AuthContext {
  userId: string
  orgId: string
  role: string
  isDemoUser: boolean
  provider?: ProviderConfig
}

export async function validateAuth(
  request: Request
): Promise<AuthContext | { error: string }> {
  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: "Missing or invalid Authorization header" }
  }

  const token = authHeader.slice(7)

  try {
    const secret = new TextEncoder().encode(config.agentAuthSecret)
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    })

    // Extract claims from JWT payload
    const userId = (payload.sub ?? payload.userId) as string | undefined
    const orgId = payload.orgId as string | undefined
    const role = payload.role as string | undefined
    const isDemoUser = payload.isDemoUser as boolean | undefined
    const provider = payload.provider as ProviderConfig | undefined

    if (!userId || !orgId || !role) {
      return { error: "Invalid token payload: missing required claims" }
    }

    return {
      userId,
      orgId,
      role,
      isDemoUser: isDemoUser ?? false,
      provider,
    }
  } catch (err) {
    return { error: `JWT verification failed: ${err}` }
  }
}
