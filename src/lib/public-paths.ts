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
  "/account-deletion",
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
  "/api/integrations/sage/labor-hours/requests",
  "/api/integrations/sage/labor-hours/results",
  "/api/integrations/sage/client-project-writes/requests",
  "/api/integrations/sage/client-project-writes/results",
  "/api/integrations/sage/contact-changes/requests",
  "/api/integrations/sage/contact-changes/results",
  "/api/integrations/sage/client-directory",
  "/api/integrations/sage/square-payments/requests",
  "/api/integrations/sage/square-payments/results",
  "/api/integrations/sage/square-invoice-creators",
  "/api/integrations/sage/vendor-certificates/requests",
  "/api/integrations/sage/vendor-certificates/results",
  "/api/integrations/sage/vendor-certificates/directory",
  "/api/integrations/sage/change-orders/requests",
  "/api/integrations/sage/change-orders/results",
  "/api/integrations/sage/prime-change-orders/requests",
  "/api/integrations/sage/prime-change-orders/results",
  "/api/integrations/sage/estimates/requests",
  "/api/integrations/sage/estimates/results",
  "/api/integrations/sage/ar-invoices/requests",
  "/api/integrations/sage/ar-invoices/results",
  "/api/integrations/sage/cost-codes/requests",
  "/api/integrations/sage/cost-codes/results",
  "/api/integrations/sage/employees/requests",
  "/api/integrations/sage/employees/results",
  "/api/integrations/square/auth-health",
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
  "/api/operations/email/retry-invitations",
  "/api/operations/email/held-backlog",
  "/api/operations/feedback/reconcile",
  "/api/operations/goto/recover-message-bodies",
  "/api/operations/paper-trail/run",
  // Opens only with a single-record pass header; see src/lib/paper-trail/print-token.ts.
  "/print/record-copy",
  "/api/operations/sage/health",
  "/api/operations/sage/square-receipts",
  "/api/operations/square/auth-health",
  "/api/operations/staff-message-desk/stale-reminders",
  "/api/operations/project-follow-up/overdue-reminders",
  "/api/operations/daily-logs/missing-reminders",
  "/api/operations/notifications/digest",
  "/api/operations/my-compass-calendar/sync",
  "/api/operations/morning-plan/sweep",
  "/api/operations/weather/refresh",
  "/api/operations/project-calendars/sync",
  "/api/operations/client-meetings/transcripts",
  "/api/operations/data-health/run",
  // Bearer secret for the regression smoke run, or the signed-in admin's session (checked in the route).
  "/api/operations/data-health/report",
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
    // RFQ price links: the page and its action check the hashed token themselves.
    pathname.startsWith("/quote/") ||
    // Trade docs links: the page, its actions and form downloads check the hashed token themselves.
    pathname.startsWith("/vendor-docs/") ||
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
