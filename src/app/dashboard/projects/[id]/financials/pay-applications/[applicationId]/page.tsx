export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import Link from "next/link"
import { notFound } from "next/navigation"
import { IconArrowLeft, IconFileDollar } from "@tabler/icons-react"

import { getProjectOwnerPayApplicationDraft } from "@/app/actions/project-financial-workflows"
import { ProjectOwnerPayApplicationEditor } from "@/components/projects/project-owner-pay-application-editor"

export default async function ProjectPayApplicationPage({
  params,
}: {
  readonly params: Promise<{ id: string; applicationId: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId, applicationId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  const application = await getProjectOwnerPayApplicationDraft(id, applicationId)
  if (!application) notFound()

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mb-5">
        <Link href={`/dashboard/projects/${id}/financials`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <IconArrowLeft className="size-4" />Project financials
        </Link>
        <div className="mt-3 flex items-center gap-2">
          <IconFileDollar className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">G702 / G703 Pay Application</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter current work, stored materials, and retainage against the locked contract budget.
        </p>
      </div>
      <ProjectOwnerPayApplicationEditor projectId={id} application={application} />
    </div>
  )
}
