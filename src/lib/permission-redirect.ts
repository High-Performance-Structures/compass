import "server-only"

import {
  isFeaturePermissionDeniedError,
  type FeaturePermissionDeniedError,
} from "@/lib/permission-enforcement"

function restrictedAccessUrl(error: FeaturePermissionDeniedError): string {
  const params = new URLSearchParams({
    feature: error.featureId,
    action: error.action,
  })

  return `/dashboard/access-restricted?${params.toString()}`
}

/**
 * Where to send someone a feature permission check turned away, or null for
 * any other error. Dashboard pages return `<ClientRedirect href={…} />` with
 * it; see that component for why they don't call `redirect()`.
 */
export function permissionDeniedRedirectHref(error: unknown): string | null {
  return isFeaturePermissionDeniedError(error) ? restrictedAccessUrl(error) : null
}
