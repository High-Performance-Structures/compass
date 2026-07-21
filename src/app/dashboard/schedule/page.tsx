export const dynamic = "force-dynamic"

import { getWorkCalendar } from "@/app/actions/work-calendar"
import { getScheduleProjectOptions } from "@/app/actions/schedule"
import { WorkCalendar } from "@/components/schedule/work-calendar"

export default async function SchedulePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly focus?: string }>
}): Promise<React.ReactElement> {
  const { focus } = await searchParams
  const [data, projects] = await Promise.all([
    getWorkCalendar(),
    getScheduleProjectOptions(),
  ])

  return (
    <WorkCalendar
      data={data}
      projects={projects}
      initialKind={focus === "tasks" ? "task" : "all"}
    />
  )
}
