import "server-only"

import { redirect } from "next/navigation"

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

export function redirectIfFeaturePermissionDenied(error: unknown): void {
  const href = permissionDeniedRedirectHref(error)
  if (href) redirect(href)
}
