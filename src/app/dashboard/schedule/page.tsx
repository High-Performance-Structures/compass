export const dynamic = "force-dynamic"

import { getWorkCalendar } from "@/app/actions/work-calendar"
import {
  WorkCalendar,
  type WorkCalendarKindFilter,
} from "@/components/schedule/work-calendar"

function kindFilter(
  value: string | readonly string[] | undefined
): WorkCalendarKindFilter {
  const selected = typeof value === "string" ? value : value?.[0]

  switch (selected) {
    case "schedule":
    case "task":
    case "rfi":
    case "purchase_order":
      return selected
    default:
      return "all"
  }
}

export default async function SchedulePage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly kind?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const query = await searchParams
  const data = await getWorkCalendar()

  return <WorkCalendar data={data} initialKind={kindFilter(query.kind)} />
}
