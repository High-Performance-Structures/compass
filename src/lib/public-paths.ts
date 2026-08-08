const publicPaths = [
  "/",
  "/login",
  "/signup",
  "/reset-password",
  "/verify-email",
  "/invite",
  "/callback",
  "/demo",
  "/privacy",
  "/terms",
  "/manifest.json",
]

const bridgePaths = [
  "/api/bridge/register",
  "/api/bridge/tools",
  "/api/bridge/context",
]

const sageBridgePaths = [
  "/api/integrations/sage/pay-applications/requests",
  "/api/integrations/sage/pay-applications/results",
]

const webhookPaths = ["/api/integrations/goto/inbound"]

export function isPublicPath(pathname: string): boolean {
  return (
    publicPaths.includes(pathname) ||
    bridgePaths.includes(pathname) ||
    sageBridgePaths.includes(pathname) ||
    webhookPaths.includes(pathname) ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/integrations/jarvis/") ||
    pathname.startsWith("/api/netsuite/") ||
    pathname.startsWith("/api/google/")
  )
}
