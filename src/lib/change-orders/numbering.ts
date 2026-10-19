/** The next change-order number on a job: <project number>-CO-001 and up. */
export function changeOrderNumber(projectNumber: string | null, count: number): string {
  const prefix = projectNumber?.trim() || "PROJECT"
  return `${prefix}-CO-${String(count + 1).padStart(3, "0")}`
}
