export const dynamic = "force-dynamic"

import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { requireProjectRouteId } from "@/lib/project-route-id"

import { getProjectOwnerPayApplicationReport } from "@/app/actions/project-financial-workflows"
import { PayApplicationClientReport } from "@/components/projects/pay-application-client-report"
import { projectBrandFor } from "@/lib/project-branding"

export default async function ProjectPayApplicationPrintPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ applicationId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const id = await requireProjectRouteId(rawProjectId)
  const report = query.applicationId ? await getProjectOwnerPayApplicationReport(id, query.applicationId) : null
  if (!report) {
    return <main className="p-8">Pay application not found.</main>
  }
  const brand = projectBrandFor({
    profiles: await currentDepartmentProfiles(),
    department: report.project.department,
    projectId: id,
    projectNumber: report.project.projectNumber,
  })
  return <PayApplicationClientReport projectId={id} report={report} brand={brand} showActions />
}
