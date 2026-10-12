export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import { IconFileDescription } from "@tabler/icons-react"

import { getProjectContractPacketWorkspace } from "@/app/actions/contract-packets"
import { PageHeader } from "@/components/page-header"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { ProjectContractPacketWorkspacePanel } from "@/components/projects/project-contract-packet-workspace"

export default async function ProjectContractsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ packetId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const id = decodeProjectRouteId(rawProjectId)
  const workspace = await getProjectContractPacketWorkspace(id, query.packetId)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <PageHeader
        back={{ href: `/dashboard/projects/${id}/estimate`, label: "Estimate" }}
        icon={<IconFileDescription className="size-5 text-primary" />}
        title="Contract packet"
        actions={
          <>
            <ProjectContextSwitcher currentProjectId={id} targetSection="contracts" placeholder="Switch contract project..." className="w-full sm:w-[280px]" />
          </>
        }
      />
      <ProjectContractPacketWorkspacePanel
        key={workspace.activePacket
          ? `${workspace.activePacket.id}:${workspace.activePacket.updatedAt}`
          : "new-contract-packet"}
        projectId={id}
        workspace={workspace}
      />
    </div>
  )
}
