export const SESSION_COOKIE = "wos-session"

export function decodeJwtPayload(
  token: string
): Record<string, unknown> | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    const base64 = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
    const padded =
      base64 + "=".repeat((4 - (base64.length % 4)) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token)
  if (!payload?.exp) return true
  return (payload.exp as number) * 1000 < Date.now()
}
