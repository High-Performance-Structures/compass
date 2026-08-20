export const COMPASS_DEPLOYMENT_ID =
  process.env.NEXT_PUBLIC_COMPASS_DEPLOYMENT_ID ?? "development"

export const STALE_DEPLOYMENT_EVENT = "compass:stale-deployment"

export function hasDeploymentChanged(
  clientDeploymentId: string,
  serverDeploymentId: string
): boolean {
  return (
    clientDeploymentId.length > 0 &&
    serverDeploymentId.length > 0 &&
    clientDeploymentId !== serverDeploymentId
  )
}

export function reportStaleDeployment(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(STALE_DEPLOYMENT_EVENT))
}
