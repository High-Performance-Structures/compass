export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"
import { IconClipboardList } from "@tabler/icons-react"

import { getDutyLogWorkspace } from "@/app/actions/internal-duties"
import { ContextualHelpBeacon } from "@/components/help/contextual-help-beacon"
import { PageHeader } from "@/components/page-header"
import { DutyLogWorkspaceView } from "@/components/projects/duty-log-workspace"
import { ProjectContextWatermarkShell } from "@/components/projects/project-context-watermark-shell"
import { decodeProjectRouteId } from "@/lib/project-route-id"

export default async function ProjectDutyLogPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ readonly month?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const id = decodeProjectRouteId(rawProjectId)
  const workspace = await getDutyLogWorkspace(id, query.month)
  if (!workspace) notFound()
  return (
    <ProjectContextWatermarkShell>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <PageHeader
          back={{ href: `/dashboard/projects/${id}`, label: "Project" }}
          icon={<IconClipboardList className="size-5 text-primary" />}
          eyebrow={workspace.project.label}
          title="Duty Log"
          actions={<ContextualHelpBeacon topicId="internal.workspaces.duty-log" />}
        />
        <DutyLogWorkspaceView workspace={workspace} />
      </div>
    </ProjectContextWatermarkShell>
  )
}
