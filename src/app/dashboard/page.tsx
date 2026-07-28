import { getDashboardOverview } from "@/app/actions/dashboard-overview"
import { DashboardLaunchpad } from "@/components/dashboard/dashboard-launchpad"
import { getCurrentUser, toSidebarUser } from "@/lib/auth"

export default async function Page() {
  const [overview, currentUser] = await Promise.all([
    getDashboardOverview(),
    getCurrentUser(),
  ])
  const sidebarUser = currentUser ? toSidebarUser(currentUser) : null

  return <DashboardLaunchpad overview={overview} user={sidebarUser} />
}
