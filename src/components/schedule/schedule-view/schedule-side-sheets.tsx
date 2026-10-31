"use client"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import type {
  ScheduleData,
  ScheduleBaselineData,
} from "@/lib/schedule/types"
import { WorkdayExceptionsView } from "../workday-exceptions-view"
import { ScheduleBaselineView } from "../schedule-baseline-view"

/** Baselines and workday-exception sheets. */
export function ScheduleSideSheets({
  projectId,
  baselines,
  initialData,
  shiftReasonRequired,
  baselinesOpen,
  setBaselinesOpen,
  exceptionsOpen,
  setExceptionsOpen,
}: {
  readonly projectId: string | null
  readonly baselines: ScheduleBaselineData[]
  readonly initialData: ScheduleData
  readonly shiftReasonRequired: boolean
  readonly baselinesOpen: boolean
  readonly setBaselinesOpen: (open: boolean) => void
  readonly exceptionsOpen: boolean
  readonly setExceptionsOpen: (open: boolean) => void
}) {
  return (
    <>
    {/* Baselines sheet */}
    <Sheet open={baselinesOpen} onOpenChange={setBaselinesOpen}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-3xl xl:max-w-5xl"
      >
        <SheetHeader>
          <SheetTitle>Baselines</SheetTitle>
          <SheetDescription>
            Save and compare schedule snapshots.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {projectId ? (
            <ScheduleBaselineView
              projectId={projectId}
              baselines={baselines}
              currentTasks={initialData.tasks}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Choose one project to manage its baselines.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>

    {/* Exceptions sheet */}
    <Sheet open={exceptionsOpen} onOpenChange={setExceptionsOpen}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Workday Exceptions</SheetTitle>
          <SheetDescription>
            Holidays, shutdowns, and weekend working overrides.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {projectId ? (
            <WorkdayExceptionsView
              projectId={projectId}
              exceptions={initialData.exceptions}
              shiftReasonRequired={shiftReasonRequired}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Choose one project to manage its workday exceptions.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
    </>
  )
}
