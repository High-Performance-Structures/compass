import { resolvedProjectDepartment } from "@/lib/project-branding"
import { validatePublicProjectIdentity } from "@/lib/social/privacy"
import type { SocialAccountSummary } from "@/lib/social/types"

type SocialProjectIdentity = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly department: string | null
  readonly publicTitle: string | null
  readonly publicLocationCity: string | null
  readonly clientName: string | null
}

export function socialReadinessErrors(project: SocialProjectIdentity): readonly string[] {
  const errors = !project.publicTitle || !project.publicLocationCity
    ? ["Add a privacy-safe public title and town/city before creating a post."]
    : [...validatePublicProjectIdentity({
        publicTitle: project.publicTitle,
        locationCity: project.publicLocationCity,
        internalProjectName: project.name,
        clientName: project.clientName,
      })]
  if (!resolvedProjectDepartment({
    department: project.department,
    projectId: project.id,
    projectNumber: project.projectNumber,
  })) {
    errors.push("Choose the project department before creating or publishing social posts.")
  }
  return errors
}

// Preserve portfolio ordering, but never prefer missing setup to a ready project.
export function selectSocialReminderProject<T extends SocialProjectIdentity>(
  activeProjects: readonly T[],
): T | null {
  return activeProjects.find((project) => socialReadinessErrors(project).length === 0)
    ?? activeProjects[0]
    ?? null
}

export function socialPublishingIssue(
  account: Pick<SocialAccountSummary, "platform" | "lastError">,
): string | null {
  if (!account.lastError) return null
  if (account.platform === "x" && /credits depleted/i.test(account.lastError)) {
    return "The last publishing attempt failed because X API credits were depleted. An administrator must review the X developer account’s billing before retrying."
  }
  if (account.platform === "facebook" && /does not have the capability/i.test(account.lastError)) {
    return "Meta rejected the last publishing action. Check the app’s publishing access and the post’s Facebook album settings before retrying."
  }
  return "The last publishing attempt failed. Review the destination result in the project’s post history before retrying."
}
