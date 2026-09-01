export const dynamic = "force-dynamic"

import Link from "next/link"
import { IconFolderOpen, IconFiles } from "@tabler/icons-react"

import { getProjectDocumentWorkspace } from "@/app/actions/project-documents"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { ProjectDocumentsWorkspacePanel } from "@/components/projects/project-documents-workspace"
import { Button } from "@/components/ui/button"
import { requireProjectRouteId } from "@/lib/project-route-id"

export default async function ProjectDocumentsPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = await requireProjectRouteId(rawProjectId)
  const workspace = await getProjectDocumentWorkspace(id)
  const allProjectFoldersHref = workspace.project.driveFolderId
    ? `/dashboard/files/folder/${workspace.project.driveFolderId}`
    : "/dashboard/files?view=projects"

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <IconFiles className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Plans &amp; Documents</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Publish the coordinated construction set for {workspace.project.projectNumber ?? workspace.project.name}.
            Every published plan is visible to owners, assigned subcontractors, and internal staff.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button variant="outline" asChild>
            <Link href={allProjectFoldersHref}>
              <IconFolderOpen className="size-4" />All project folders
            </Link>
          </Button>
          <ProjectContextSwitcher
            currentProjectId={id}
            targetSection="documents"
            placeholder="Switch document project..."
            className="w-full sm:w-[280px]"
          />
        </div>
      </div>
      <ProjectDocumentsWorkspacePanel workspace={workspace} />
    </div>
  )
}
