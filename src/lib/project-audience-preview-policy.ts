import type { ProjectAudience } from "@/lib/project-audience-access"

export function shouldIncludeOwnerUpdateHistory(
  viewerIsInternal: boolean,
  audience: ProjectAudience
): boolean {
  return viewerIsInternal && audience === "owner"
}
