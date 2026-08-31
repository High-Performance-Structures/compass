export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import { getProjectContractPacketWorkspace } from "@/app/actions/contract-packets"
import { ProjectContractPacketPreview } from "@/components/projects/project-contract-packet-preview"

export default async function ProjectContractPacketPrintPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ packetId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const id = decodeProjectRouteId(rawProjectId)
  const workspace = await getProjectContractPacketWorkspace(id, query.packetId)
  const packet = workspace.activePacket

  if (!packet || (query.packetId && packet.id !== query.packetId)) {
    return <main className="p-8">Contract packet not found.</main>
  }

  return (
    <ProjectContractPacketPreview
      projectId={id}
      packetId={packet.id}
      packetNumber={packet.packetNumber}
      versionNumber={packet.versionNumber}
    />
  )
}
