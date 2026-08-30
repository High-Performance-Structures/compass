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

type SocialDepartmentDestination = {
  readonly facebookPageName: string
  readonly instagramUsername: string
  readonly xHandle: string
}

const SOCIAL_DEPARTMENT_DESTINATIONS: Readonly<
  Record<ProjectDepartment, SocialDepartmentDestination>
> = {
  O: {
    facebookPageName: "Open Range Custom Builders",
    instagramUsername: "orconstructionltd",
    xHandle: "@ORConstruction",
  },
  D: {
    facebookPageName: "Open Range Custom Builders",
    instagramUsername: "orconstructionltd",
    xHandle: "@ORConstruction",
  },
  H: {
    facebookPageName: "High Performance Structures, Inc.",
    instagramUsername: "hpscolorado",
    xHandle: "@HPSColorado",
  },
  N: {
    facebookPageName: "Nu-Tech Systems",
    instagramUsername: "nutechcolorado",
    xHandle: "@NutechColorado",
  },
}

function normalizedAccountName(value: string): string {
  return value.trim().replace(/^@/, "").toLocaleLowerCase("en-US")
}

export function socialDepartmentDestination(
  department: ProjectDepartment,
): SocialDepartmentDestination {
  return SOCIAL_DEPARTMENT_DESTINATIONS[department]
}

export function isExpectedFacebookPage(
  department: ProjectDepartment,
  pageName: string,
): boolean {
  return normalizedAccountName(pageName) === normalizedAccountName(
    socialDepartmentDestination(department).facebookPageName,
  )
}

export function isExpectedInstagramProfile(
  department: ProjectDepartment,
  username: string | null,
): boolean {
  return username !== null && normalizedAccountName(username) === normalizedAccountName(
    socialDepartmentDestination(department).instagramUsername,
  )
}

export function isExpectedXProfile(
  department: ProjectDepartment,
  username: string,
): boolean {
  return normalizedAccountName(username) === normalizedAccountName(
    socialDepartmentDestination(department).xHandle,
  )
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
