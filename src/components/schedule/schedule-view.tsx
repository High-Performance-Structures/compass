"use client"

import { useState, useMemo } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useIsMobile } from "@/hooks/use-mobile"
import { ScheduleToolbar, type TaskFilters } from "./schedule-toolbar"
import { ProjectSwitcher } from "./project-switcher"
import { ScheduleListView } from "./schedule-list-view"
import { ScheduleGanttView } from "./schedule-gantt-view"
import { ScheduleCalendarView } from "./schedule-calendar-view"
import { ScheduleMobileView } from "./schedule-mobile-view"
import { WorkdayExceptionsView } from "./workday-exceptions-view"
import { ScheduleBaselineView } from "./schedule-baseline-view"
import { TaskFormDialog } from "./task-form-dialog"
import type {
  ScheduleData,
  ScheduleBaselineData,
} from "@/lib/schedule/types"

type TopTab = "schedule" | "baseline" | "exceptions"
type ScheduleSubTab = "calendar" | "list" | "gantt"

const DEFAULT_FILTERS: TaskFilters = {
  status: [],
  phase: [],
  assignedTo: "",
  search: "",
}

interface ScheduleViewProps {
  projectId: string
  projectName: string
  initialData: ScheduleData
  baselines: ScheduleBaselineData[]
  allProjects?: { id: string; name: string }[]
}

export function ScheduleView({
  projectId,
  projectName,
  initialData,
  baselines,
  allProjects = [],
}: ScheduleViewProps) {
  const isMobile = useIsMobile()
  const [topTab, setTopTab] = useState<TopTab>("schedule")
  const [subTab, setSubTab] = useState<ScheduleSubTab>("calendar")
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS)

  const filteredTasks = useMemo(() => {
    let tasks = initialData.tasks

    if (filters.status.length > 0) {
      tasks = tasks.filter((t) => filters.status.includes(t.status))
    }

    if (filters.phase.length > 0) {
      tasks = tasks.filter((t) => filters.phase.includes(t.phase as never))
    }

    if (filters.assignedTo) {
      const search = filters.assignedTo.toLowerCase()
      tasks = tasks.filter(
        (t) => t.assignedTo?.toLowerCase().includes(search)
      )
    }

    if (filters.search) {
      const search = filters.search.toLowerCase()
      tasks = tasks.filter((t) => t.title.toLowerCase().includes(search))
    }

    return tasks
  }, [initialData.tasks, filters])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <div className="flex items-center gap-3">
          <ProjectSwitcher
            projects={allProjects}
            currentProjectId={projectId}
            currentProjectName={projectName}
          />
          <span className="text-muted-foreground">- Schedule</span>
        </div>
        <Tabs
          value={topTab}
          onValueChange={(v) => setTopTab(v as TopTab)}
        >
          <TabsList>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
            <TabsTrigger value="baseline">Baseline</TabsTrigger>
            <TabsTrigger value="exceptions">
              <span className="hidden sm:inline">Workday </span>Exceptions
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Tabs
        value={topTab}
        onValueChange={(v) => setTopTab(v as TopTab)}
        className="flex flex-col flex-1 min-h-0"
      >
        <TabsContent value="schedule" className="mt-0 flex flex-col flex-1 min-h-0">
          <ScheduleToolbar
            onNewItem={() => setTaskFormOpen(true)}
            filters={filters}
            onFiltersChange={setFilters}
            projectName={projectName}
            tasksCount={filteredTasks.length}
            tasks={filteredTasks}
          />

          <Tabs
            value={subTab}
            onValueChange={(v) => setSubTab(v as ScheduleSubTab)}
            className="flex flex-col flex-1 min-h-0"
          >
            <TabsList className="bg-transparent border-b rounded-none h-auto p-0 gap-4">
              <TabsTrigger
                value="calendar"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none pb-2"
              >
                Calendar
              </TabsTrigger>
              <TabsTrigger
                value="list"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none pb-2"
              >
                List
              </TabsTrigger>
              <TabsTrigger
                value="gantt"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none pb-2"
              >
                Gantt
              </TabsTrigger>
            </TabsList>

            <TabsContent value="calendar" className="mt-2 flex flex-col flex-1 min-h-0" data-schedule-content>
              {isMobile ? (
                <ScheduleMobileView
                  tasks={filteredTasks}
                  exceptions={initialData.exceptions}
                />
              ) : (
                <ScheduleCalendarView
                  projectId={projectId}
                  tasks={filteredTasks}
                  exceptions={initialData.exceptions}
                />
              )}
            </TabsContent>

            <TabsContent value="list" className="mt-2 flex flex-col flex-1 min-h-0" data-schedule-content>
              <ScheduleListView
                projectId={projectId}
                tasks={filteredTasks}
                dependencies={initialData.dependencies}
              />
            </TabsContent>

            <TabsContent value="gantt" className="mt-2 flex flex-col flex-1 min-h-0" data-schedule-content>
              <ScheduleGanttView
                projectId={projectId}
                tasks={filteredTasks}
                dependencies={initialData.dependencies}
              />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="baseline" className="mt-2">
          <ScheduleBaselineView
            projectId={projectId}
            baselines={baselines}
            currentTasks={initialData.tasks}
          />
        </TabsContent>

        <TabsContent value="exceptions" className="mt-2">
          <WorkdayExceptionsView
            projectId={projectId}
            exceptions={initialData.exceptions}
          />
        </TabsContent>
      </Tabs>

      <TaskFormDialog
        open={taskFormOpen}
        onOpenChange={setTaskFormOpen}
        projectId={projectId}
        editingTask={null}
      />
    </div>
  )
}
