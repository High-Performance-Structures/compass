import type * as React from "react"
import { redirect } from "next/navigation"

import { getCherishPulseTeamStream } from "@/app/actions/cherish-pulse"
import { getDashboardOverview } from "@/app/actions/dashboard-overview"
import { getProjects } from "@/app/actions/projects"
import {
  getCurrentUserPresence,
  getOrganizationTeamAvailability,
} from "@/app/actions/presence"
import { getWorkCalendar } from "@/app/actions/work-calendar"
import { DashboardLaunchpad } from "@/components/dashboard/dashboard-launchpad"
import type { DashboardOfficeEvent } from "@/components/dashboard/dashboard-launchpad"
import { getCurrentUser, toSidebarUser } from "@/lib/auth"
import {
  canManageProjectRegistry,
} from "@/lib/permissions"
import { toFieldCherishRecognitions } from "@/lib/field/cherish-recognition"

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
    workCalendar,
    cherishResult,
  ] = await Promise.all([
    getDashboardOverview(),
    getCurrentUserPresence(),
    getOrganizationTeamAvailability(),
    getWorkCalendar(undefined, { eventsOnly: true }).catch(() => null),
    getCherishPulseTeamStream(),
  ])
  const sidebarUser = currentUser ? toSidebarUser(currentUser) : null
  const initialDeskStatusMessage = presenceResult.success
    ? presenceResult.data?.statusMessage ?? null
    : null
  const initialTeamAvailability = teamAvailabilityResult.success
    ? teamAvailabilityResult.data
    : []
  const officeCalendarEvents: readonly DashboardOfficeEvent[] =
    workCalendar?.entries.flatMap((entry) =>
      entry.kind === "event"
        ? [{
            id: entry.id,
            projectId: entry.projectId,
            projectLabel: entry.projectLabel,
            title: entry.title,
            startDate: entry.startDate,
            endDate: entry.endDate,
            href: entry.href,
            allDay: entry.eventDetails.allDay,
            startTime: entry.eventDetails.startTime,
          }]
        : []
    ) ?? []

  return (
    <DashboardLaunchpad
      overview={overview}
      user={sidebarUser}
      initialDeskStatusMessage={initialDeskStatusMessage}
      initialTeamAvailability={initialTeamAvailability}
      officeCalendarEvents={officeCalendarEvents}
      officeProjectId={workCalendar?.defaultProjectId ?? null}
      canManageOfficeMaintenance={canManageProjectRegistry(currentUser)}
      cherishRecognitions={
        cherishResult.success
          ? toFieldCherishRecognitions(cherishResult.data)
          : []
      }
    />
  )
}
