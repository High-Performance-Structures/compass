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
  "/api/mobile/health",
]

const authSessionWritePaths = [
  "/callback",
  "/api/auth/callback",
  "/api/auth/login",
  "/api/auth/mobile/session",
]

const bridgePaths = [
  "/api/bridge/register",
  "/api/bridge/tools",
  "/api/bridge/context",
]

const sageBridgePaths = [
  "/api/integrations/sage/pay-applications/requests",
  "/api/integrations/sage/pay-applications/results",
  "/api/integrations/sage/tax-catalog/results",
  "/api/integrations/sage/client-project-writes/requests",
  "/api/integrations/sage/client-project-writes/results",
  "/api/integrations/sage/square-payments/requests",
  "/api/integrations/sage/square-payments/results",
]

const webhookPaths = [
  "/api/integrations/goto/inbound",
  "/api/integrations/foxit/webhook",
  "/api/integrations/square/webhook",
]

// These routes bypass WorkOS only so their own bearer/HMAC checks can run.
// Keep the allowlist exact: none of the route prefixes are public.
const scheduledMaintenancePaths = [
  "/api/email/gmail-sync",
  "/api/operations/feedback/reconcile",
  "/api/operations/goto/recover-message-bodies",
  "/api/operations/sage/health",
  "/api/operations/sage/square-receipts",
]

export function isPublicPath(pathname: string): boolean {
  return (
    publicPaths.includes(pathname) ||
    bridgePaths.includes(pathname) ||
    sageBridgePaths.includes(pathname) ||
    webhookPaths.includes(pathname) ||
    scheduledMaintenancePaths.includes(pathname) ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/ecard/") ||
    pathname.startsWith("/api/auth/") ||
    // Signed, short-lived URLs let Meta fetch only approved public photos.
    // The route performs its own HMAC and current-visibility checks.
    pathname.startsWith("/api/social/media/") ||
    pathname.startsWith("/api/integrations/jarvis/") ||
    pathname.startsWith("/api/netsuite/") ||
    pathname.startsWith("/api/google/")
  )
}

export function isAuthSessionWritePath(pathname: string): boolean {
  return authSessionWritePaths.includes(pathname)
}
