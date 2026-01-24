"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScheduleToolbar } from "./schedule-toolbar"
import { ScheduleListView } from "./schedule-list-view"
import { ScheduleGanttView } from "./schedule-gantt-view"
import { ScheduleCalendarView } from "./schedule-calendar-view"
import { WorkdayExceptionsView } from "./workday-exceptions-view"
import { ScheduleBaselineView } from "./schedule-baseline-view"
import { TaskFormDialog } from "./task-form-dialog"
import type {
  ScheduleData,
  ScheduleBaselineData,
} from "@/lib/schedule/types"

type TopTab = "schedule" | "baseline" | "exceptions"
type ScheduleSubTab = "calendar" | "list" | "gantt"

interface ScheduleViewProps {
  projectId: string
  projectName: string
  initialData: ScheduleData
  baselines: ScheduleBaselineData[]
}

export function ScheduleView({
  projectId,
  projectName,
  initialData,
  baselines,
}: ScheduleViewProps) {
  const [topTab, setTopTab] = useState<TopTab>("schedule")
  const [subTab, setSubTab] = useState<ScheduleSubTab>("list")
  const [taskFormOpen, setTaskFormOpen] = useState(false)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <h1 className="text-lg font-semibold truncate">
          {projectName} - Schedule
        </h1>
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
          <ScheduleToolbar onNewItem={() => setTaskFormOpen(true)} />

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

            <TabsContent value="calendar" className="mt-2 flex flex-col flex-1 min-h-0">
              <ScheduleCalendarView
                projectId={projectId}
                tasks={initialData.tasks}
                exceptions={initialData.exceptions}
              />
            </TabsContent>

            <TabsContent value="list" className="mt-2 flex flex-col flex-1 min-h-0">
              <ScheduleListView
                projectId={projectId}
                tasks={initialData.tasks}
                dependencies={initialData.dependencies}
              />
            </TabsContent>

            <TabsContent value="gantt" className="mt-2 flex flex-col flex-1 min-h-0">
              <ScheduleGanttView
                projectId={projectId}
                tasks={initialData.tasks}
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
