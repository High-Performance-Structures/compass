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

export function redirectIfFeaturePermissionDenied(error: unknown): void {
  if (!isFeaturePermissionDeniedError(error)) return
  redirect(restrictedAccessUrl(error))
}
