import { notFound } from "next/navigation"
import {
  getCustomDashboardById,
  executeDashboardQueries,
} from "@/app/actions/dashboards"
import { SavedDashboardView } from "@/components/saved-dashboard-view"

interface Props {
  readonly params: Promise<{ readonly id: string }>
}

export default async function SavedDashboardPage({
  params,
}: Props) {
  const { id } = await params

  const result = await getCustomDashboardById(id)
  if (!result.success) notFound()

  const dashboard = result.data
  const spec = JSON.parse(dashboard.specData)

  let dataContext: Record<string, unknown> = {}
  if (dashboard.queries) {
    const queryResult = await executeDashboardQueries(
      dashboard.queries,
    )
    if (queryResult.success) {
      dataContext = queryResult.data
    }
  }

  return (
    <SavedDashboardView
      dashboard={{
        id: dashboard.id,
        name: dashboard.name,
        description: dashboard.description,
      }}
      spec={spec}
      dataContext={dataContext}
    />
  )
}
