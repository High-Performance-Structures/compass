export const dynamic = "force-dynamic"

import Link from "next/link"
import { IconFolderOpen, IconFiles } from "@tabler/icons-react"

import { getProjectDocumentWorkspace } from "@/app/actions/project-documents"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { ProjectDocumentsWorkspacePanel } from "@/components/projects/project-documents-workspace"
import { Button } from "@/components/ui/button"
import { requireProjectRouteId } from "@/lib/project-route-id"
import { PageHeader } from "@/components/page-header"

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
      <PageHeader
        icon={<IconFiles className="size-5 text-primary" />}
        title="Plans & Documents"
        description={
          <>
            Publish the coordinated construction set for {workspace.project.projectNumber ?? workspace.project.name}.
            Every published plan is visible to owners, assigned subcontractors, and internal staff.
          </>
        }
        actions={
          <>
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
          </>
        }
      />
      <ProjectDocumentsWorkspacePanel workspace={workspace} />
    </div>
  )
}
