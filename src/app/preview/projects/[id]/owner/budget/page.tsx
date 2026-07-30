export const dynamic = "force-dynamic"

import type * as React from "react"
import { notFound } from "next/navigation"
import { IconFileDollar, IconLock } from "@tabler/icons-react"

import {
  getProjectBudgetSummary,
  type ProjectBudgetSummary,
} from "@/app/actions/project-budget"
import {
  getProjectAudiencePreview,
  type ProjectAudiencePreview as ProjectAudiencePreviewData,
} from "@/app/actions/project-audience-preview"
import {
  ProjectBudgetG703Table,
  ProjectBudgetPanel,
} from "@/components/projects/project-budget-panel"
import { ProjectAudiencePreviewShell } from "@/components/projects/project-audience-preview-shell"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

export default async function OwnerBudgetPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  let preview: ProjectAudiencePreviewData
  let budget: ProjectBudgetSummary

  try {
    preview = await getProjectAudiencePreview(id, "owner")
    budget = await getProjectBudgetSummary(id, "owner")
  } catch (error) {
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    notFound()
  }

  return (
    <ProjectAudiencePreviewShell
      audience="owner"
      projectId={preview.project.id}
      projectName={preview.project.name}
      projectNumber={preview.project.projectNumber}
      projectOptions={preview.projectOptions}
      viewer={preview.viewer}
      viewerIsInternal={preview.viewerIsInternal}
      activeSection="budget"
    >
      <main className="min-h-screen bg-muted/20 px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
            <div>
              <div className="flex items-center gap-2">
                <IconFileDollar className="size-5 text-primary" />
                <h1 className="text-2xl font-semibold tracking-tight">
                  Budget / G703
                </h1>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Your approved Schedule of Values and current payment progress.
              </p>
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <IconLock className="size-4" />
              Read-only owner view
            </p>
          </div>

          <div className="mt-5">
            <ProjectBudgetPanel
              projectId={id}
              summary={budget}
              detailHref={null}
            />
          </div>

          {budget.allLines.length > 0 && (
            <section className="mt-6">
              <div className="mb-3">
                <h2 className="text-sm font-semibold">
                  G703 Schedule of Values
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Only lines approved for owner visibility are included.
                </p>
              </div>
              <ProjectBudgetG703Table
                summary={budget}
                showVisibility={false}
              />
            </section>
          )}
        </div>
      </main>
    </ProjectAudiencePreviewShell>
  )
}
