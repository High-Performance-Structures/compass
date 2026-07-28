import { getDashboardOverview } from "@/app/actions/dashboard-overview"
import {
  getCurrentUserPresence,
  getOrganizationTeamAvailability,
} from "@/app/actions/presence"
import { DashboardLaunchpad } from "@/components/dashboard/dashboard-launchpad"
import { getCurrentUser, toSidebarUser } from "@/lib/auth"

export default async function Page() {
  const [
    overview,
    currentUser,
    presenceResult,
    teamAvailabilityResult,
  ] = await Promise.all([
    getDashboardOverview(),
    getCurrentUser(),
    getCurrentUserPresence(),
    getOrganizationTeamAvailability(),
  ])
  const sidebarUser = currentUser ? toSidebarUser(currentUser) : null
  const initialDeskStatusMessage = presenceResult.success
    ? presenceResult.data?.statusMessage ?? null
    : null
  const initialTeamAvailability = teamAvailabilityResult.success
    ? teamAvailabilityResult.data
    : []

  return (
    <DashboardLaunchpad
      overview={overview}
      user={sidebarUser}
      initialDeskStatusMessage={initialDeskStatusMessage}
      initialTeamAvailability={initialTeamAvailability}
    />
  )
}
