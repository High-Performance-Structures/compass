export const dynamic = "force-dynamic"

import { getWorkCalendar } from "@/app/actions/work-calendar"
import {
  WorkCalendar,
  type WorkCalendarKindFilter,
  type WorkCalendarView,
} from "@/components/schedule/work-calendar"

function kindFilter(
  value: string | readonly string[] | undefined
): WorkCalendarKindFilter {
  const selected = typeof value === "string" ? value : value?.[0]

  switch (selected) {
    case "schedule":
    case "event":
    case "task":
    case "rfi":
    case "purchase_order":
      return selected
    default:
      return "all"
  }
}

function calendarView(
  value: string | readonly string[] | undefined
): WorkCalendarView {
  const selected = typeof value === "string" ? value : value?.[0]

  switch (selected) {
    case "today":
    case "week":
    case "month":
    case "list":
      return selected
    default:
      return "week"
  }
}

export default async function SchedulePage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly kind?: string | readonly string[]
    readonly item?: string | readonly string[]
    readonly view?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const query = await searchParams
  const data = await getWorkCalendar()

  const initialItemId =
    typeof query.item === "string" ? query.item : query.item?.[0] ?? null

  return (
    <WorkCalendar
      data={data}
      initialKind={kindFilter(query.kind)}
      initialItemId={initialItemId}
      initialView={calendarView(query.view)}
    />
  )
}
