export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import { IconTool } from "@tabler/icons-react"

import { getProjectNuTechOrderWorkspace } from "@/app/actions/nutech-orders"
import { PageHeader } from "@/components/page-header"
import { NuTechOrderWorkspace } from "@/components/nutech/nutech-order-workspace"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"

export default async function ProjectNuTechOrderPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  const workspace = await getProjectNuTechOrderWorkspace(id)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <PageHeader
        back={{ href: `/dashboard/projects/${id}`, label: "Project" }}
        icon={<IconTool className="size-5 text-brand-nutech-gold-foreground" />}
        title="Nu-Tech Order Process"
        description={
          <>
            {workspace.projectNumber ? `${workspace.projectNumber} · ` : ""}
            {workspace.projectName}
            {workspace.clientName ? ` · ${workspace.clientName}` : ""}
            {workspace.address ? ` · ${workspace.address}` : ""}
          </>
        }
        actions={
          <ProjectContextSwitcher
            currentProjectId={id}
            targetSection="nutech"
            placeholder="Switch Nu-Tech project..."
            className="w-full sm:w-[280px]"
          />
        }
      />
      <NuTechOrderWorkspace workspace={workspace} />
    </div>
  )
}
