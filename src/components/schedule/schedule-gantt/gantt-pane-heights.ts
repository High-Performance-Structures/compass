/**
 * Scroll sync is pixel-for-pixel, so both panes must be able to scroll the
 * same distance. The list ends with an Add row the chart has no row for.
 * Frappe positions its SVG absolutely, so padding cannot extend the chart's
 * scroll area; an invisible spacer as tall as the list does. Heights are read
 * from the list table and the SVG, never from scrollHeight, so the spacer
 * cannot feed back into its own measurement. Returns a cleanup.
 */
export function matchGanttPaneHeights(
  taskList: HTMLElement,
  ganttContainer: HTMLElement
): () => void {
  const spacer = document.createElement("div")
  spacer.setAttribute("aria-hidden", "true")
  spacer.dataset.ganttScrollSpacer = ""
  spacer.style.cssText =
    "position:absolute;top:0;left:0;width:1px;pointer-events:none;visibility:hidden"
  ganttContainer.appendChild(spacer)

  const listContent = taskList.firstElementChild
  const apply = (): void => {
    const svg = ganttContainer.querySelector("svg")
    const listHeight = listContent?.getBoundingClientRect().height ?? 0
    const chartHeight = svg?.getBoundingClientRect().height ?? 0
    spacer.style.height = `${Math.max(listHeight, chartHeight)}px`
    taskList.style.paddingBottom = `${Math.max(0, chartHeight - listHeight)}px`
  }
  apply()
  const observer = new ResizeObserver(apply)
  if (listContent) observer.observe(listContent)
  const svg = ganttContainer.querySelector("svg")
  if (svg) observer.observe(svg)
  return () => {
    observer.disconnect()
    spacer.remove()
    taskList.style.paddingBottom = ""
  }
}
