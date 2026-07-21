declare module "frappe-gantt" {
  interface GanttTask {
    id: string
    name: string
    start: string
    end: string
    progress: number
    dependencies?: string
    custom_class?: string
  }

  interface GanttOptions {
    view_mode?: string
    column_width?: number
    infinite_padding?: boolean
    bar_height?: number
    padding?: number
    today_button?: boolean
    scroll_to?: string
    on_date_change?: (
      task: { id: string },
      start: Date,
      end: Date
    ) => void
    on_progress_change?: (
      task: { id: string },
      progress: number
    ) => void
    on_click?: (task: { id: string }) => void
  }

  export default class Gantt {
    gantt_start: Date
    config: {
      unit: string
      step: number
      column_width: number
    }
    constructor(
      element: HTMLElement,
      tasks: GanttTask[],
      options?: GanttOptions
    )
    scroll_current(): void
  }
}
