export function bindGanttTodayButton(
  root: Pick<ParentNode, "querySelector">,
  onTodayClick: () => void
): boolean {
  const button = root.querySelector<HTMLButtonElement>(".today-button")
  if (!button) return false
  button.onclick = onTodayClick
  return true
}
