export const dynamic = "force-dynamic"

import { getProjectEstimateVersionComparison } from "@/app/actions/project-estimates"
import { ProjectEstimateComparisonControls } from "@/components/projects/project-estimate-comparison-controls"
import { ProjectEstimateVersionComparisonDocument } from "@/components/projects/project-estimate-version-comparison"

export default async function ProjectEstimateComparisonPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{
    baseEstimateId?: string
    revisedEstimateId?: string
  }>
}): Promise<React.ReactElement> {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const data = await getProjectEstimateVersionComparison(
    id,
    query.baseEstimateId,
    query.revisedEstimateId
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      {data.baseEstimate && data.revisedEstimate && (
        <div className="mb-5">
          <ProjectEstimateComparisonControls
            projectId={id}
            estimates={data.estimates}
            baseEstimate={data.baseEstimate}
            revisedEstimate={data.revisedEstimate}
          />
        </div>
      )}
      <ProjectEstimateVersionComparisonDocument data={data} />
    </div>
  )
}
