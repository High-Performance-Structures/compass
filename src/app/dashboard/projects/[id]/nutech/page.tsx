export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import { IconTool } from "@tabler/icons-react"

import { getProjectNuTechOrderWorkspace } from "@/app/actions/nutech-orders"
import { ContextualHelpBeacon } from "@/components/help/contextual-help-beacon"
import { getProjectBracingRentals } from "@/app/actions/nutech-bracing"
import { NuTechBracingRentals } from "@/components/nutech/nutech-bracing-rentals"
import { getNuTechManufacturerName } from "@/app/actions/nutech-airlite-po"
import { PageHeader } from "@/components/page-header"
import { NuTechOrderWorkspace } from "@/components/nutech/nutech-order-workspace"
import { NuTechOrderSwitcher } from "@/components/nutech/nutech-order-switcher"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"

export default async function ProjectNuTechOrderPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{ readonly order?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const id = decodeProjectRouteId(rawProjectId)
  const [workspace, bracing, manufacturerName] = await Promise.all([
    getProjectNuTechOrderWorkspace(id, query.order ?? null),
    getProjectBracingRentals(id),
    getNuTechManufacturerName(),
  ])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <PageHeader
        back={{ href: `/dashboard/projects/${id}`, label: "Project" }}
        icon={<IconTool className="size-5 text-brand-nutech-gold-foreground" />}
        title="Nu-Tech Order Process"
        eyebrow={[workspace.projectNumber, workspace.projectName, workspace.clientName]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <ContextualHelpBeacon topicId="nutech.orders.stepper" />
            <ProjectContextSwitcher
              currentProjectId={id}
              targetSection="nutech"
              placeholder="Switch Nu-Tech project..."
              className="w-full sm:w-[280px]"
            />
          </>
        }
      />
      <NuTechOrderSwitcher
        projectId={id}
        orders={workspace.orders}
        activeOrderId={workspace.order?.id ?? null}
        canEdit={workspace.canEdit}
      />
      {/* Keyed by order so switching orders resets the form. */}
      <NuTechOrderWorkspace key={workspace.order?.id ?? "new"} workspace={workspace} manufacturerName={manufacturerName} />
      {bracing.success ? (
        <div className="mt-8">
          <NuTechBracingRentals data={bracing.data} />
        </div>
      ) : null}
    </div>
  )
}
