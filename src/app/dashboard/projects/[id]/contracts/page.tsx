export const dynamic = "force-dynamic"

import Link from "next/link"
import { IconArrowLeft, IconFileDescription } from "@tabler/icons-react"

import { getProjectContractPacketWorkspace } from "@/app/actions/contract-packets"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { ProjectContractPacketWorkspacePanel } from "@/components/projects/project-contract-packet-workspace"

export default async function ProjectContractsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ packetId?: string }>
}): Promise<React.ReactElement> {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const workspace = await getProjectContractPacketWorkspace(id, query.packetId)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/dashboard/projects/${id}/estimate`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <IconArrowLeft className="size-4" />Estimate
          </Link>
          <div className="mt-3 flex items-center gap-2">
            <IconFileDescription className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Contract packet</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Assemble versioned contract documents, the exact CA22 estimate, required signers, and later-stage closeout forms.
          </p>
        </div>
        <ProjectContextSwitcher currentProjectId={id} targetSection="contracts" placeholder="Switch contract project..." className="w-full sm:w-[280px]" />
      </div>
      <ProjectContractPacketWorkspacePanel projectId={id} workspace={workspace} />
    </div>
  )
}
