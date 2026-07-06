export const dynamic = "force-dynamic"

import Link from "next/link"
import { IconArrowLeft, IconReceipt } from "@tabler/icons-react"

import {
  getProjectVendorBillSubmissionContext,
  type ProjectVendorBillSubmissionContext,
} from "@/app/actions/project-vendor-bill-submissions"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { ProjectContextWatermarkShell } from "@/components/projects/project-context-watermark-shell"
import { ProjectVendorBillSubmissionsWorkspace } from "@/components/projects/project-vendor-bill-submissions-workspace"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"

export default async function ProjectBillSubmissionsPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  let context: ProjectVendorBillSubmissionContext

  try {
    context = await getProjectVendorBillSubmissionContext(id)
  } catch (error) {
    redirectIfFeaturePermissionDenied(error)
    throw error
  }

  return (
    <ProjectContextWatermarkShell>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              href={`/dashboard/projects/${id}`}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <IconArrowLeft className="size-4" />
              Project
            </Link>
            <div className="mt-3 flex items-center gap-2">
              <IconReceipt className="size-5 text-primary" />
              <h1 className="text-2xl font-semibold tracking-tight">
                Bill Submissions
              </h1>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Intake for subcontractor and supplier bills before internal review
              and Sage sync.
            </p>
          </div>
          <ProjectContextSwitcher
            currentProjectId={id}
            targetSection="bill-submissions"
            placeholder="Switch bill project..."
            className="w-full sm:w-[280px]"
          />
        </div>

        <ProjectVendorBillSubmissionsWorkspace projectId={id} context={context} />
      </div>
    </ProjectContextWatermarkShell>
  )
}
