export const dynamic = "force-dynamic"

import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { requireProjectRouteId } from "@/lib/project-route-id"
import { redirect } from "next/navigation"

import { getProjectEstimateWorkspace } from "@/app/actions/project-estimates"
import { EstimateClientReport } from "@/components/projects/estimate-client-report"
import { acceptedEstimateDocumentUrl } from "@/lib/estimates/accepted-document"
import { projectBrandFor, projectLegalEntityName } from "@/lib/project-branding"

export default async function ProjectEstimatePrintPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ estimateId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const id = await requireProjectRouteId(rawProjectId)
  const workspace = await getProjectEstimateWorkspace(id, query.estimateId)
  const estimate = workspace.activeEstimate
  const brand = projectBrandFor({ profiles: await currentDepartmentProfiles(),
    projectId: id,
    projectNumber: workspace.projectNumber,
  })
  const legalEntityName = projectLegalEntityName(brand.department, await currentDepartmentProfiles())

  if (!estimate) {
    return <main className="p-8">Estimate not found.</main>
  }
  const acceptedDocumentUrl = acceptedEstimateDocumentUrl(estimate)
  if (acceptedDocumentUrl) redirect(acceptedDocumentUrl)

  return (
    <EstimateClientReport
      id={id}
      workspace={workspace}
      estimate={estimate}
      brand={brand}
      legalEntityName={legalEntityName}
      showActions
    />
  )
}
