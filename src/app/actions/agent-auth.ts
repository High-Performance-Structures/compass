"use server"

import { SignJWT } from "jose"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { getProviderConfigForJwt } from "@/lib/agent/provider-config"

const ORG_DEFAULT_USER_ID = "org_default"

/**
 * Generate a JWT for the browser to use when connecting to the agent server
 * Token includes user identity, org context, and role for authorization
 */
export async function getAgentToken(): Promise<
  { token: string } | { error: string }
> {
  const user = await getCurrentUser()
  if (!user) {
    return { error: "Not authenticated" }
  }

  const { env } = await getCloudflareContext()
  const secret = (env as unknown as Record<string, string>)
    .AGENT_AUTH_SECRET

  if (!secret) {
    return { error: "Agent auth not configured" }
  }

  try {
    let providerConfig = await getProviderConfigForJwt(user.id)

    if (!providerConfig) {
      providerConfig = await getProviderConfigForJwt(ORG_DEFAULT_USER_ID)
    }

    // This token is returned to the browser, and a JWT payload is readable by
    // anyone holding it, so the provider's API key must never be included.
    // A standalone agent server supplies its own provider key.
    const token = await new SignJWT({
      sub: user.id,
      orgId: user.organizationId,
      role: user.role,
      isDemoUser: isDemoUser(user.id),
      provider: providerConfig
        ? {
            type: providerConfig.type,
            baseUrl: providerConfig.baseUrl,
            modelOverrides: providerConfig.modelOverrides,
          }
        : undefined,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret))

    return { token }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to generate token",
    }
  }
}
