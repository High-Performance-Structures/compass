export const dynamic = "force-dynamic"

import { getWorkCalendar } from "@/app/actions/work-calendar"
import { WorkCalendar } from "@/components/schedule/work-calendar"

export default async function SchedulePage(): Promise<React.ReactElement> {
  const data = await getWorkCalendar()

  return <WorkCalendar data={data} />
}
