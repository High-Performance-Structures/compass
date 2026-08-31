export const dynamic = "force-dynamic"

import { requireProjectRouteId } from "@/lib/project-route-id"
import { getProjectEstimateVersionComparison } from "@/app/actions/project-estimates"
import { ProjectEstimateReportActions } from "@/components/projects/project-estimate-report-actions"
import { ProjectEstimateVersionComparisonDocument } from "@/components/projects/project-estimate-version-comparison"

export default async function ProjectEstimateComparisonPrintPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{
    baseEstimateId?: string
    revisedEstimateId?: string
  }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const id = await requireProjectRouteId(rawProjectId)
  const data = await getProjectEstimateVersionComparison(
    id,
    query.baseEstimateId,
    query.revisedEstimateId
  )
  const baseEstimate = data.baseEstimate
  const revisedEstimate = data.revisedEstimate

  if (!baseEstimate || !revisedEstimate || !data.comparison) {
    return <main className="p-8">Two estimate versions are required.</main>
  }

  return (
    <>
      <style>{`
        @page { size: letter landscape; margin: 0.35in; }
        @media print {
          body { background: white !important; }
          .estimate-report-actions { display: none !important; }
          .estimate-comparison-document { margin: 0 !important; max-width: none !important; }
        }
      `}</style>
      <title>
        {data.projectName} Estimate Versions {baseEstimate.versionNumber} and {revisedEstimate.versionNumber}
      </title>
      <ProjectEstimateReportActions
        title={`${data.projectName} estimate version comparison`}
        estimateNumber={`${baseEstimate.estimateNumber} v${baseEstimate.versionNumber}–v${revisedEstimate.versionNumber}`}
      />
      <main className="mx-auto max-w-[11in] bg-white p-5 text-black print:max-w-none print:p-0">
        <ProjectEstimateVersionComparisonDocument data={data} />
      </main>
    </>
  )
}
