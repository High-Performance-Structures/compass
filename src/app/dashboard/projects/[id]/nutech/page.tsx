export const dynamic = "force-dynamic"

import Link from "next/link"
import { IconArrowLeft, IconTool } from "@tabler/icons-react"

import { getProjectNuTechOrderWorkspace } from "@/app/actions/nutech-orders"
import { NuTechOrderWorkspace } from "@/components/nutech/nutech-order-workspace"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"

export default async function ProjectNuTechOrderPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  const workspace = await getProjectNuTechOrderWorkspace(id)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/dashboard/projects/${id}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <IconArrowLeft className="size-4" />
            Project
          </Link>
          <div className="mt-3 flex items-center gap-2">
            <IconTool className="size-5 text-brand-nutech-gold-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Nu-Tech Order Process
            </h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {workspace.projectNumber ? `${workspace.projectNumber} · ` : ""}
            {workspace.projectName}
            {workspace.clientName ? ` · ${workspace.clientName}` : ""}
          </p>
          {workspace.address && (
            <p className="mt-1 text-sm text-muted-foreground">
              {workspace.address}
            </p>
          )}
        </div>
        <ProjectContextSwitcher
          currentProjectId={id}
          targetSection="nutech"
          placeholder="Switch Nu-Tech project..."
          className="w-full sm:w-[280px]"
        />
      </div>
      <NuTechOrderWorkspace workspace={workspace} />
    </div>
  )
}
