export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETE" | "BLOCKED"

export type DependencyType = "FS" | "SS" | "FF" | "SF"

export type ConstructionPhase =
  | "preconstruction"
  | "sitework"
  | "foundation"
  | "framing"
  | "roofing"
  | "electrical"
  | "plumbing"
  | "hvac"
  | "insulation"
  | "drywall"
  | "finish"
  | "landscaping"
  | "closeout"

export type ExceptionCategory =
  | "national_holiday"
  | "state_holiday"
  | "vacation_day"
  | "company_holiday"
  | "weather_day"

export type ExceptionRecurrence = "one_time" | "yearly"

export interface ScheduleTaskData {
  id: string
  projectId: string
  title: string
  startDate: string
  workdays: number
  endDateCalculated: string
  phase: string
  displayColor: string | null
  status: TaskStatus
  isCriticalPath: boolean
  isMilestone: boolean
  percentComplete: number
  assignedTo: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface TaskDependencyData {
  id: string
  predecessorId: string
  successorId: string
  type: DependencyType
  lagDays: number
}

export interface WorkdayExceptionData {
  id: string
  projectId: string
  title: string
  startDate: string
  endDate: string
  type: string
  category: ExceptionCategory
  recurrence: ExceptionRecurrence
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface ScheduleBaselineData {
  id: string
  projectId: string
  name: string
  snapshotData: string
  createdAt: string
}

export interface ScheduleData {
  tasks: ScheduleTaskData[]
  dependencies: TaskDependencyData[]
  exceptions: WorkdayExceptionData[]
}

export interface TaskFilters {
  readonly status: readonly TaskStatus[]
  readonly phase: readonly string[]
  readonly assignedTo: string
  readonly search: string
}

export const EMPTY_FILTERS: TaskFilters = {
  status: [],
  phase: [],
  assignedTo: "",
  search: "",
}

export const STATUS_OPTIONS: readonly { readonly value: TaskStatus; readonly label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETE", label: "Complete" },
  { value: "BLOCKED", label: "Blocked" },
] as const

export const PHASE_OPTIONS: readonly { readonly value: ConstructionPhase; readonly label: string }[] = [
  { value: "preconstruction", label: "Preconstruction" },
  { value: "sitework", label: "Sitework" },
  { value: "foundation", label: "Foundation" },
  { value: "framing", label: "Framing" },
  { value: "roofing", label: "Roofing" },
  { value: "electrical", label: "Electrical" },
  { value: "plumbing", label: "Plumbing" },
  { value: "hvac", label: "HVAC" },
  { value: "insulation", label: "Insulation" },
  { value: "drywall", label: "Drywall" },
  { value: "finish", label: "Finish" },
  { value: "landscaping", label: "Landscaping" },
  { value: "closeout", label: "Closeout" },
] as const
