"use client"

import { useState, useCallback, useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ContextualHelpBeacon } from "@/components/help/contextual-help-beacon"
import {
  IconCalendarPlus,
  IconPlus,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react"
import { WorkdayExceptionFormDialog } from "./workday-exception-form-dialog"
import {
  createWorkdayException,
  deleteWorkdayException,
} from "@/app/actions/workday-exceptions"
import type { WorkdayExceptionData } from "@/lib/schedule/types"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { addDays, format, isWeekend, parseISO } from "date-fns"
import { resolveScheduleShiftReason } from "@/lib/schedule/shift-tracking"
import { formatDate } from "@/lib/format"

interface WorkdayExceptionsViewProps {
  projectId: string
  exceptions: WorkdayExceptionData[]
  /** False until the schedule is first published; drafts need no shift reason. */
  shiftReasonRequired?: boolean
}

/** "Oct 30, 2026"; an unreadable value is shown as stored, as before. */
function dateLabel(value: string): string {
  return formatDate(value, "medium", value)
}

function calcDuration(start: string, end: string): number {
  const s = parseISO(start)
  const e = parseISO(end)
  const diff = Math.ceil(
    (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)
  )
  return diff + 1
}

const categoryLabels: Record<string, string> = {
  national_holiday: "National Holiday",
  state_holiday: "State Holiday",
  vacation_day: "Vacation Day",
  company_holiday: "Company Holiday",
  weather_day: "Weather Day",
  extra_workday: "Extra Workday",
}

function effectLabel(exception: WorkdayExceptionData): string {
  return exception.type === "working" ? "Working" : "Non-working"
}

function categoryLabel(exception: WorkdayExceptionData): string {
  return categoryLabels[exception.category] ?? exception.category
}

function recurrenceLabel(exception: WorkdayExceptionData): string {
  return exception.recurrence.replace("_", " ")
}

/** Whether an exception matches the search box (title, dates' text, effect, category, recurrence, notes). */
function exceptionMatchesSearch(exception: WorkdayExceptionData, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [
    exception.title,
    dateLabel(exception.startDate),
    dateLabel(exception.endDate),
    effectLabel(exception),
    categoryLabel(exception),
    recurrenceLabel(exception),
    exception.notes ?? "",
  ].some((value) => value.toLowerCase().includes(needle))
}

/** The workday exceptions sheet's columns ("schedule.workday-exceptions"). */
export function workdayExceptionColumns({
  onOpen,
  onDelete,
}: {
  readonly onOpen: (exception: WorkdayExceptionData) => void
  readonly onDelete: (exception: WorkdayExceptionData) => void
}): ColumnDef<WorkdayExceptionData>[] {
  return [
    {
      accessorKey: "title",
      header: "Title",
      size: 160,
      cell: ({ row }) => (
        <button
          type="button"
          className="text-left text-sm font-medium hover:underline"
          onClick={() => onOpen(row.original)}
        >
          {row.original.title}
        </button>
      ),
    },
    {
      accessorKey: "startDate",
      header: "Start",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{dateLabel(row.original.startDate)}</span>
      ),
    },
    {
      accessorKey: "endDate",
      header: "End",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{dateLabel(row.original.endDate)}</span>
      ),
    },
    {
      id: "duration",
      accessorFn: (exception) => calcDuration(exception.startDate, exception.endDate),
      header: "Duration",
      cell: ({ row }) => (
        <span className="text-xs">{calcDuration(row.original.startDate, row.original.endDate)} days</span>
      ),
    },
    {
      id: "effect",
      accessorFn: effectLabel,
      header: "Effect",
      cell: ({ row }) => <span className="text-xs">{effectLabel(row.original)}</span>,
    },
    {
      id: "category",
      accessorFn: categoryLabel,
      header: "Category",
      cell: ({ row }) => <span className="text-xs">{categoryLabel(row.original)}</span>,
    },
    {
      id: "recurrence",
      accessorFn: recurrenceLabel,
      header: "Recurrence",
      cell: ({ row }) => <span className="text-xs capitalize">{recurrenceLabel(row.original)}</span>,
    },
    {
      id: "notes",
      accessorFn: (exception) => exception.notes || undefined,
      header: "Notes",
      cell: ({ row }) => (
        <span className="block max-w-[120px] truncate text-xs text-muted-foreground">{row.original.notes || "-"}</span>
      ),
    },
    {
      id: "actions",
      size: 80,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`Edit ${row.original.title}`}
            onClick={() => onOpen(row.original)}
          >
            <IconPencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`Delete ${row.original.title}`}
            onClick={() => onDelete(row.original)}
          >
            <IconTrash className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ]
}

function nextWeekendDate(): string {
  const today = new Date()
  const daysUntilSaturday = (6 - today.getDay() + 7) % 7
  return format(addDays(today, daysUntilSaturday), "yyyy-MM-dd")
}

export function WorkdayExceptionsView({
  projectId,
  exceptions,
  shiftReasonRequired = true,
}: WorkdayExceptionsViewProps) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editingException, setEditingException] =
    useState<WorkdayExceptionData | null>(null)
  const [weekendDate, setWeekendDate] = useState(nextWeekendDate)
  const [weekendSaving, setWeekendSaving] = useState(false)
  const [query, setQuery] = useState("")

  const weekendOverride = useMemo(
    () =>
      exceptions.find(
        (exception) =>
          exception.type === "working" &&
          exception.recurrence === "one_time" &&
          exception.startDate === weekendDate &&
          exception.endDate === weekendDate
      ),
    [exceptions, weekendDate]
  )

  const handleDelete = useCallback(
    async (id: string) => {
      const exception = exceptions.find((candidate) => candidate.id === id)
      const title = exception?.title ?? "this workday exception"
      if (!shiftReasonRequired) {
        if (!window.confirm(`Delete “${title}”?`)) return
      }
      const input = shiftReasonRequired
        ? window.prompt(`Why is “${title}” being deleted?`)
        : ""
      if (input === null) return
      const shiftReasonResult = resolveScheduleShiftReason(
        shiftReasonRequired,
        input
      )
      if (shiftReasonResult !== null && !shiftReasonResult.success) {
        toast.error(shiftReasonResult.error)
        return
      }
      const result = await deleteWorkdayException(
        id,
        shiftReasonResult?.reason ?? ""
      )
      if (result.success) {
        router.refresh()
      } else {
        toast.error(result.error)
      }
    },
    [exceptions, router, shiftReasonRequired]
  )

  const handleWeekendToggle = useCallback(async () => {
    if (!isWeekend(parseISO(weekendDate))) {
      toast.error("Choose a Saturday or Sunday for a weekend override")
      return
    }
    const input = shiftReasonRequired
      ? window.prompt(
          weekendOverride
            ? "Why is this weekend being restored as non-working?"
            : "Why is this weekend being made a workday?"
        )
      : ""
    if (input === null) return
    const shiftReasonResult = resolveScheduleShiftReason(
      shiftReasonRequired,
      input
    )
    if (shiftReasonResult !== null && !shiftReasonResult.success) {
      toast.error(shiftReasonResult.error)
      return
    }

    setWeekendSaving(true)
    const result = weekendOverride
      ? await deleteWorkdayException(
          weekendOverride.id,
          shiftReasonResult?.reason ?? ""
        )
      : await createWorkdayException(projectId, {
          title: `Weekend workday — ${format(
            parseISO(weekendDate),
            "MMM d, yyyy"
          )}`,
          startDate: weekendDate,
          endDate: weekendDate,
          type: "working",
          category: "extra_workday",
          recurrence: "one_time",
          shiftReason: shiftReasonResult?.reason ?? "",
        })
    setWeekendSaving(false)

    if (result.success) {
      toast.success(
        weekendOverride
          ? "Weekend restored as non-working"
          : "Weekend marked as a workday"
      )
      router.refresh()
    } else {
      toast.error(result.error)
    }
  }, [projectId, router, shiftReasonRequired, weekendDate, weekendOverride])

  const openException = useCallback((exception: WorkdayExceptionData) => {
    setEditingException(exception)
    setFormOpen(true)
  }, [])

  const columns = useMemo(
    () => workdayExceptionColumns({ onOpen: openException, onDelete: (exception) => void handleDelete(exception.id) }),
    [handleDelete, openException]
  )

  const visibleExceptions = useMemo(
    () => exceptions.filter((exception) => exceptionMatchesSearch(exception, query)),
    [exceptions, query]
  )

  const table = useRecordTable({
    data: visibleExceptions,
    columns,
    getRowId: (exception) => exception.id,
    resetKey: query,
    sheetId: "schedule.workday-exceptions",
  })

  return (
    <div>
      <div className="mb-4 rounded-md border bg-muted/20 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Quick weekend override</p>
            <p className="text-xs text-muted-foreground">
              Pick a Saturday or Sunday, then toggle whether crews can work.
            </p>
          </div>
          <Input
            type="date"
            value={weekendDate}
            onChange={(event) => setWeekendDate(event.target.value)}
            className="h-9 sm:w-[165px]"
          />
          <Button
            type="button"
            size="sm"
            variant={weekendOverride ? "outline" : "default"}
            disabled={weekendSaving}
            onClick={handleWeekendToggle}
          >
            <IconCalendarPlus className="mr-1 size-4" />
            {weekendSaving
              ? "Saving..."
              : weekendOverride
                ? "Make non-working"
                : "Make workday"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="min-w-0 break-words text-lg font-medium">Workday Exceptions</h2>
          <ContextualHelpBeacon topicId="schedule.workday-exceptions" />
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditingException(null)
            setFormOpen(true)
          }}
          className="whitespace-nowrap"
        >
          <IconPlus className="size-4 mr-1" />
          <span className="hidden sm:inline">Workday Exception</span>
          <span className="sm:hidden">New Exception</span>
        </Button>
      </div>

      {exceptions.length > 0 ? (
        <RecordSearchInput
          value={query}
          onChange={setQuery}
          label="Search workday exceptions"
          placeholder="Search title, category, recurrence or notes…"
          className="mb-3 sm:max-w-sm"
        />
      ) : null}

      <RecordTable
        table={table}
        itemLabel="workday exceptions"
        emptyMessage={exceptions.length === 0 ? "No workday exceptions" : "No workday exceptions match this search."}
        rowIdPrefix="workday-exception"
        onRowOpen={openException}
      />

      <WorkdayExceptionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={projectId}
        editingException={editingException}
        shiftReasonRequired={shiftReasonRequired}
      />
    </div>
  )
}
