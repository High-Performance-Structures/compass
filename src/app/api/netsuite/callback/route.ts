import { getDb } from "@/lib/db-universal"
import { getNetSuiteConfig } from "@/lib/netsuite/config"
import { exchangeCodeForTokens } from "@/lib/netsuite/auth/oauth-client"
import { TokenManager } from "@/lib/netsuite/auth/token-manager"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user || !can(user, "organization", "update")) {
    return Response.redirect(
      new URL("/dashboard?error=unauthorized", request.url)
    )
  }

  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const error = url.searchParams.get("error")

  if (error) {
    const desc = url.searchParams.get("error_description") ?? error
    return redirectToSettings(`error=${encodeURIComponent(desc)}`)
  }

  if (!code || !state) {
    return redirectToSettings("error=Missing+code+or+state")
  }

  // validate state matches what we stored in the cookie
  const cookies = parseCookies(request.headers.get("cookie") ?? "")
  const expectedState = cookies["netsuite_oauth_state"]
  if (!expectedState || state !== expectedState) {
    return redirectToSettings("error=Invalid+state+parameter")
  }

  try {
    const { env } = { env: { DB: null } }
    const envRecord = env as unknown as Record<string, string>
    const config = getNetSuiteConfig(envRecord)
    const db = getDb(db)

    const tokens = await exchangeCodeForTokens(config, code)
    const tokenManager = new TokenManager(config, db as never)
    await tokenManager.storeTokens(tokens)

    return redirectToSettings("connected=true", true)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return redirectToSettings(
      `error=${encodeURIComponent(message)}`
    )
  }
}

function redirectToSettings(
  params: string,
  clearCookie = false
): Response {
  const headers = new Headers({
    Location: `/dashboard?netsuite=${params}`,
  })

  if (clearCookie) {
    headers.set(
      "Set-Cookie",
      "netsuite_oauth_state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"
    )
  }

  return new Response(null, { status: 302, headers })
}

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const pair of header.split(";")) {
    const [key, ...rest] = pair.trim().split("=")
    if (key) cookies[key] = rest.join("=")
  }
  return cookies
}
