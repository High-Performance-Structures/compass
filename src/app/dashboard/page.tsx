import { getDashboardOverview } from "@/app/actions/dashboard-overview"
import { getCurrentUserPresence } from "@/app/actions/presence"
import { DashboardLaunchpad } from "@/components/dashboard/dashboard-launchpad"
import { getCurrentUser, toSidebarUser } from "@/lib/auth"

export default async function Page() {
  const [overview, currentUser, presenceResult] = await Promise.all([
    getDashboardOverview(),
    getCurrentUser(),
    getCurrentUserPresence(),
  ])
  const sidebarUser = currentUser ? toSidebarUser(currentUser) : null
  const initialDeskStatusMessage = presenceResult.success
    ? presenceResult.data?.statusMessage ?? null
    : null

  return (
    <DashboardLaunchpad
      overview={overview}
      user={sidebarUser}
      initialDeskStatusMessage={initialDeskStatusMessage}
    />
  )
}
