import type { ProjectDepartment } from "@/lib/project-branding"

export const SOCIAL_PLATFORMS = ["facebook", "instagram", "x"] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

export type FacebookAlbumMode = "none" | "project_album"

export type SocialDraftSuggestion = {
  readonly heading: string
  readonly body: string
  readonly hashtags: readonly string[]
}

export type SocialAccountSummary = {
  readonly id: string
  readonly department: ProjectDepartment
  readonly platform: SocialPlatform
  readonly accountName: string
  readonly status: string
  readonly connectedAt: string
  readonly lastPublishedAt: string | null
  readonly lastError: string | null
}

export function socialPlatform(value: string): SocialPlatform | null {
  if (value === "facebook" || value === "instagram" || value === "x") {
    return value
  }
  return null
}

export function socialDepartment(value: string): ProjectDepartment | null {
  if (value === "O" || value === "H" || value === "N" || value === "D") {
    return value
  }
  return null
}

export function socialPlatformLabel(platform: SocialPlatform): string {
  if (platform === "x") return "X"
  if (platform === "instagram") return "Instagram"
  return "Facebook"
}
