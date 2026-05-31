import { getDashboardOverview } from "@/app/actions/dashboard-overview"
import { OperationalDashboard } from "@/components/dashboard/operational-dashboard"

export default async function Page() {
  const overview = await getDashboardOverview()

  return <OperationalDashboard overview={overview} />
}
