import type * as React from "react"
import { redirect } from "next/navigation"

import { getDashboardOverview } from "@/app/actions/dashboard-overview"
import { getProjects } from "@/app/actions/projects"
import {
  getCurrentUserPresence,
  getOrganizationTeamAvailability,
} from "@/app/actions/presence"
import { DashboardLaunchpad } from "@/components/dashboard/dashboard-launchpad"
import { getCurrentUser, toSidebarUser } from "@/lib/auth"

export default async function Page(): Promise<React.ReactElement> {
  const currentUser = await getCurrentUser()
  if (
    currentUser &&
    ["client", "owner", "subcontractor", "supplier"].includes(
      currentUser.role
    )
  ) {
    const assignedProjects = await getProjects()
    const firstProject = assignedProjects[0]
    if (firstProject) {
      const audience =
        currentUser.role === "client" || currentUser.role === "owner"
          ? "owner"
          : "sub-vendor"
      redirect(
        `/preview/projects/${encodeURIComponent(firstProject.id)}/${audience}`
      )
    }
  }

  const [
    overview,
    presenceResult,
    teamAvailabilityResult,
  ] = await Promise.all([
    getDashboardOverview(),
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
