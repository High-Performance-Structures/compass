const publicPaths = [
  "/",
  "/login",
  "/signup",
  "/reset-password",
  "/verify-email",
  "/invite",
  "/callback",
  "/demo",
  "/manifest.json",
]

const bridgePaths = [
  "/api/bridge/register",
  "/api/bridge/tools",
  "/api/bridge/context",
]

export function isPublicPath(pathname: string): boolean {
  return (
    publicPaths.includes(pathname) ||
    bridgePaths.includes(pathname) ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/integrations/jarvis/") ||
    pathname.startsWith("/api/netsuite/") ||
    pathname.startsWith("/api/google/")
  )
}
