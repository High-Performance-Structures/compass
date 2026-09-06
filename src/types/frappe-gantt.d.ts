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
    view_modes?: readonly GanttViewMode[]
    column_width?: number
    readonly?: boolean
    popup?: false
    today_button?: boolean
    infinite_padding?: boolean
    holidays?: Readonly<Record<string, "weekend">>
    is_weekend?: (date: Date) => boolean
    on_date_change?: (
      task: { id: string },
      start: Date,
      end: Date
    ) => void
    on_progress_change?: (
      task: { id: string },
      progress: number
    ) => void
  }

  interface GanttViewMode {
    readonly name: string
    readonly padding?: string | readonly [string, string]
    readonly step?: string
    readonly date_format?: string
    readonly column_width?: number
    readonly lower_text?:
      | string
      | ((date: Date, previousDate: Date | null, language: string) => string)
    readonly upper_text?:
      | string
      | ((date: Date, previousDate: Date | null, language: string) => string)
    readonly upper_text_frequency?: number
    readonly thick_line?: (date: Date) => boolean
    readonly snap_at?: string
  }

  export default class Gantt {
    constructor(
      element: HTMLElement,
      tasks: GanttTask[],
      options?: GanttOptions
    )
    change_view_mode(viewMode?: string, maintainPosition?: boolean): void
    readonly gantt_start: Date
    readonly config: {
      readonly column_width: number
      readonly step: number
      readonly unit: string
    }
  }
}
