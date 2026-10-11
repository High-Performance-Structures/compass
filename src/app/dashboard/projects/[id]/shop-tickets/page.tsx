export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"
import { IconReceipt } from "@tabler/icons-react"

import { getShopTicketWorkspace } from "@/app/actions/shop-tickets"
import { PageHeader } from "@/components/page-header"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { ProjectContextWatermarkShell } from "@/components/projects/project-context-watermark-shell"
import { ShopTicketsWorkspace } from "@/components/projects/shop-tickets-workspace"
import { decodeProjectRouteId } from "@/lib/project-route-id"

export default async function ProjectShopTicketsPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  const workspace = await getShopTicketWorkspace(id)
  if (!workspace) notFound()
  return (
    <ProjectContextWatermarkShell>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <PageHeader
          back={{ href: `/dashboard/projects/${id}/financials`, label: "Financials" }}
          icon={<IconReceipt className="size-5 text-primary" />}
          eyebrow={[workspace.project.projectNumber, workspace.project.name].filter(Boolean).join(" · ")}
          title="Shop Tickets"
          actions={
            <ProjectContextSwitcher
              currentProjectId={id}
              targetSection="shop-tickets"
              placeholder="Switch project..."
              className="w-full sm:w-[280px]"
            />
          }
        />
        <ShopTicketsWorkspace projectId={id} workspace={workspace} />
      </div>
    </ProjectContextWatermarkShell>
  )
}
