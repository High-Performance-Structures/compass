export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import { IconAddressBook, IconGitMerge, IconShieldCheck } from "@tabler/icons-react"
import { redirect } from "next/navigation"

import {
  getProjectContactMatchReview,
  type ProjectContactMatchReview,
} from "@/app/actions/project-contacts"
import { ProjectContactMatchReviewPanel } from "@/components/projects/project-contact-match-review"
import { Badge } from "@/components/ui/badge"
import { getCurrentUser } from "@/lib/auth"
import { isDeveloperModeEnabled } from "@/lib/developer-mode-server"
import { canManageProjectRegistry } from "@/lib/permissions"
import { PageHeader } from "@/components/page-header"

export default async function ProjectContactMatchReviewPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  const currentUser = await getCurrentUser()
  const developerModeEnabled = await isDeveloperModeEnabled(
    canManageProjectRegistry(currentUser)
  )
  if (!developerModeEnabled) redirect(`/dashboard/projects/${id}/contacts`)

  let review: ProjectContactMatchReview | null = null
  let reviewError: string | null = null

  try {
    review = await getProjectContactMatchReview(id)
  } catch (error) {
    reviewError =
      error instanceof Error ? error.message : "Unknown contact review error"
    console.warn("Project contact match review unavailable", error)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <PageHeader
        back={{ href: `/dashboard/projects/${id}/contacts`, label: "Project contacts" }}
        icon={<IconGitMerge className="size-5 text-primary" />}
        title="Contact Match Review"
        actions={
          <>
            <Badge variant="outline">
              <IconAddressBook className="mr-1 size-3" />
              Source reconciliation
            </Badge>
            <Badge variant="secondary">
              <IconShieldCheck className="mr-1 size-3" />
              Admin review
            </Badge>
          </>
        }
      />

      {review ? (
        <ProjectContactMatchReviewPanel review={review} />
      ) : (
        <section className="rounded-lg border p-6">
          <p className="text-sm text-muted-foreground">
            Contact match review is unavailable for this project.
          </p>
          {reviewError && (
            <p className="mt-2 text-xs text-muted-foreground">{reviewError}</p>
          )}
        </section>
      )}
    </div>
  )
}
