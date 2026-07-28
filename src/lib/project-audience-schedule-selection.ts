type ScheduleSelectionItem = {
  readonly id: string
  readonly startDate: string
  readonly endDate: string
  readonly status: string
  readonly percentComplete: number
}

export function selectUpcomingScheduleItems<
  ScheduleItem extends ScheduleSelectionItem,
>(
  items: readonly ScheduleItem[],
  today: string,
  limit = 3
): readonly ScheduleItem[] {
  return [...items]
    .filter(
      (item) =>
        item.endDate >= today &&
        item.percentComplete < 100 &&
        item.status.toLowerCase() !== "complete"
    )
    .sort(
      (left, right) =>
        left.startDate.localeCompare(right.startDate) ||
        left.endDate.localeCompare(right.endDate) ||
        left.id.localeCompare(right.id)
    )
    .slice(0, limit)
}
