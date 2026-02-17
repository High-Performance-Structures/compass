import { SignJWT, jwtVerify } from "jose"

export type AuthResult =
  | {
      readonly valid: true
      readonly userId: string
      readonly orgId: string
      readonly role: string
      readonly isDemoUser: boolean
    }
  | {
      readonly valid: false
    }

/**
 * Validate JWT from the Authorization header.
 * Uses AGENT_AUTH_SECRET env var (shared secret with agent server).
 * Returns auth context if valid, otherwise { valid: false }.
 */
export async function validateAgentAuth(
  req: Request,
  env: Record<string, string>,
): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization")
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false }
  }

  const token = authHeader.replace("Bearer ", "")
  const secret = env.AGENT_AUTH_SECRET
  if (!secret) {
    console.error("AGENT_AUTH_SECRET not configured")
    return { valid: false }
  }

  try {
    const secretKey = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    })

    const userId = payload.sub
    const orgId = payload.orgId
    const role = payload.role
    const isDemoUser = payload.isDemoUser

    if (
      typeof userId !== "string" ||
      typeof orgId !== "string" ||
      typeof role !== "string" ||
      typeof isDemoUser !== "boolean"
    ) {
      console.error("Invalid JWT claims", { userId, orgId, role, isDemoUser })
      return { valid: false }
    }

    return {
      valid: true,
      userId,
      orgId,
      role,
      isDemoUser,
    }
  } catch (error) {
    console.error("JWT verification failed:", error)
    return { valid: false }
  }
}

/**
 * Generate a JWT for testing/server-to-server auth.
 * Used by the agent server when making requests to the Workers API.
 */
export async function generateAgentToken(
  secret: string,
  userId: string,
  orgId: string,
  role: string,
  isDemoUser: boolean,
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret)
  const token = await new SignJWT({
    sub: userId,
    orgId,
    role,
    isDemoUser,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secretKey)

  return token
}
