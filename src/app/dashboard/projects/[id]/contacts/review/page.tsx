export const dynamic = "force-dynamic"

import {
  IconArrowLeft,
  IconAddressBook,
  IconGitMerge,
  IconShieldCheck,
} from "@tabler/icons-react"
import Link from "next/link"
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

export default async function ProjectContactMatchReviewPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
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
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/dashboard/projects/${id}/contacts`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconArrowLeft className="size-4" />
            Project contacts
          </Link>
          <div className="mt-3 flex items-center gap-2">
            <IconGitMerge className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Contact Match Review
            </h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Match imported names to trusted contacts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            <IconAddressBook className="mr-1 size-3" />
            Source reconciliation
          </Badge>
          <Badge variant="secondary">
            <IconShieldCheck className="mr-1 size-3" />
            Admin review
          </Badge>
        </div>
      </div>

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
