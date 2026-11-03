"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  IconPlus,
  IconCalendar,
  IconList,
  IconTimeline,
  IconChevronRight,
} from "@tabler/icons-react"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import type { ProjectListItem } from "@/app/actions/projects"
import type {
  ScheduleProjectData,
  ScheduleScope,
} from "@/lib/schedule/project-scope"
import type { OwnerScheduleView } from "@/lib/schedule/owner-visibility"
import { ScheduleScopeSwitcher } from "../schedule-scope-switcher"
import { OwnerScheduleVisibilityControl } from "../owner-schedule-visibility-control"
import type { View } from "./schedule-view-rules"

const VIEW_OPTIONS = [
  { value: "calendar" as const, icon: IconCalendar, label: "Calendar" },
  { value: "list" as const, icon: IconList, label: "List" },
  { value: "gantt" as const, icon: IconTimeline, label: "Gantt" },
]

/** Breadcrumb, project or scope switcher, view picker and New item. */
export function ScheduleHeaderToolbar({
  projectId,
  projectName,
  globalMode,
  scope,
  allProjects,
  scheduleProjects,
  ownerScheduleView,
  view,
  setView,
  setTaskFormOpen,
}: {
  readonly projectId: string | null
  readonly projectName: string
  readonly globalMode: boolean
  readonly scope: ScheduleScope | undefined
  readonly allProjects: readonly ProjectListItem[]
  readonly scheduleProjects: readonly ScheduleProjectData[]
  readonly ownerScheduleView: OwnerScheduleView
  readonly view: View
  readonly setView: (view: View) => void
  readonly setTaskFormOpen: (open: boolean) => void
}) {
  return (
    <div
      className="mb-1 flex h-8 w-max min-w-full shrink-0 flex-nowrap items-center gap-1"
      data-schedule-controls
      data-schedule-toolbar
    >
      <nav className="flex shrink-0 items-center gap-1.5 text-sm">
        {/* The project switcher already names the project; repeat it in the
            breadcrumb only when there is room. */}
        <Link
          href={
            globalMode || !projectId
              ? "/dashboard/schedule"
              : `/dashboard/projects/${projectId}`
          }
          className={cn(
            "text-muted-foreground hover:text-foreground truncate transition-colors",
            !globalMode && projectId && "hidden 2xl:inline"
          )}
        >
          {globalMode ? "Scheduling" : projectName}
        </Link>
        <IconChevronRight
          className={cn(
            "size-3.5 text-muted-foreground/60 shrink-0",
            !globalMode && projectId && "hidden 2xl:block"
          )}
        />
        <span className="font-medium">
          {globalMode ? "Project schedules" : "Schedule"}
        </span>
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {globalMode && scope ? (
          <>
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link href="/dashboard/schedule">Work calendar</Link>
            </Button>
            <ScheduleScopeSwitcher
              projects={allProjects}
              scheduleProjects={scheduleProjects}
              scope={scope}
            />
          </>
        ) : (
          <>
            <ProjectQuickSwitcher
              projects={allProjects}
              currentProjectId={projectId}
              targetSection="schedule"
              placeholder="Switch schedule project..."
              className="h-8 w-full sm:w-[240px]"
            />
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link
                href="/dashboard/schedule?mode=projects&scope=all&view=gantt"
                title="All project schedules"
              >
                All schedules
              </Link>
            </Button>
          </>
        )}

        {projectId && (
          <OwnerScheduleVisibilityControl
            projectId={projectId}
            initialValue={ownerScheduleView}
          />
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Schedule view"
              className="h-8 shrink-0 px-2 text-xs"
              size="sm"
              variant="outline"
            >
              {(() => {
                const activeView = VIEW_OPTIONS.find(
                  (option) => option.value === view
                )
                const ActiveIcon = activeView?.icon ?? IconCalendar
                return (
                  <>
                    <ActiveIcon className="size-3.5" />
                    <span className="ml-1.5">{activeView?.label}</span>
                  </>
                )
              })()}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={view}
              onValueChange={(value) => {
                const option = VIEW_OPTIONS.find((candidate) => candidate.value === value)
                if (option) setView(option.value)
              }}
            >
              {VIEW_OPTIONS.map(({ value, icon: Icon, label }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  <Icon className="mr-2 size-4" />
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          onClick={() => setTaskFormOpen(true)}
          className="h-8"
          aria-label="New Schedule Item"
          disabled={!projectId}
          title={
            projectId
              ? "Create a schedule item"
              : "Choose one project before creating a schedule item"
          }
        >
          <IconPlus className="size-3.5" />
          <span className="ml-1.5 hidden 2xl:inline">New Schedule Item</span>
          <span className="ml-1.5 hidden sm:inline 2xl:hidden">New item</span>
        </Button>
      </div>
    </div>
  )
}
